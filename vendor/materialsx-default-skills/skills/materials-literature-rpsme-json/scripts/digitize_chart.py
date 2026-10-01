#!/usr/bin/env python3
"""Calibrated axis-aligned linear/log raster digitizer. Outputs candidates only."""
import argparse
import itertools
import math
from pathlib import Path
from PIL import Image
from p1_common import finite, load, save, sha_file
from quality_review import digest


def validate_axis(axis, size):
    if axis.get("scale") not in ("linear", "log10") or not axis.get("label") or not isinstance(axis.get("unit"), str):
        raise ValueError("Axis requires label, unit (possibly empty) and linear/log10 scale")
    anchors = axis.get("anchors", [])
    if len(anchors) != 2:
        raise ValueError("Exactly two visually identified calibration anchors per axis")
    for a in anchors:
        p = finite(a["pixel"], "anchor pixel", 0)
        v = finite(a["value"], "anchor value")
        pe, ve = finite(a.get("pixel_error", .5), "pixel error", 0), finite(a.get("value_error", 0), "value error", 0)
        if p >= size or (axis["scale"] == "log10" and v-ve <= 0):
            raise ValueError("Anchor outside image or nonpositive log calibration")
    a, b = anchors
    if abs(b["pixel"]-a["pixel"]) <= a.get("pixel_error", .5)+b.get("pixel_error", .5):
        raise ValueError("Calibration anchor uncertainty overlaps")
    if abs(a["value"]-b["value"]) <= a.get("value_error", 0)+b.get("value_error", 0):
        raise ValueError("Calibration values must differ with non-overlapping uncertainty")


def transform(pixel, p0, p1, v0, v1, scale):
    if p0 == p1:
        raise ValueError("Degenerate calibration")
    if scale == "log10":
        v0, v1 = math.log10(v0), math.log10(v1)
    value = v0 + (pixel-p0)/(p1-p0)*(v1-v0)
    return 10**value if scale == "log10" else value


def calibrate(pixel, error, axis, extrapolate=False):
    a, b = axis["anchors"]
    if not extrapolate and not min(a["pixel"], b["pixel"]) <= pixel <= max(a["pixel"], b["pixel"]):
        raise ValueError("Point outside calibration interval; explicit allow_extrapolation required")
    nominal = transform(pixel, a["pixel"], b["pixel"], a["value"], b["value"], axis["scale"])
    intervals = [(pixel-error, pixel+error)]
    intervals += [(r["pixel"]-r.get("pixel_error", .5), r["pixel"]+r.get("pixel_error", .5)) for r in (a, b)]
    intervals += [(r["value"]-r.get("value_error", 0), r["value"]+r.get("value_error", 0)) for r in (a, b)]
    values = [transform(*corner, axis["scale"]) for corner in itertools.product(*intervals)]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Nonfinite calibrated value")
    return {"value": nominal, "unit": axis["unit"], "lower": min(values), "upper": max(values),
            "uncertainty_kind": "bounded_pixel_and_calibration_error_not_statistical_CI"}


def trace_color(image, series, roi):
    rgb = series.get("rgb")
    if not isinstance(rgb, list) or len(rgb) != 3 or any(type(v) is not int or not 0 <= v <= 255 for v in rgb):
        raise ValueError("Color trace requires explicit RGB")
    tol = finite(series.get("color_tolerance", 20), "color tolerance", 0)
    if tol > 100:
        raise ValueError("Color tolerance too broad")
    step = series.get("x_step", 1)
    if type(step) is not int or not 1 <= step <= image.width:
        raise ValueError("x_step must be a positive integer")
    points, ambiguous = [], []
    pixels = image.load()
    for x in range(roi[0], roi[2], step):
        ys = [y for y in range(roi[1], roi[3]) if sum((pixels[x, y][i]-rgb[i])**2 for i in range(3)) <= tol**2]
        if not ys:
            continue
        if any(b-a > 1 for a, b in zip(ys, ys[1:])):
            ambiguous.append(x); continue
        points.append({"x": x, "y": (ys[0]+ys[-1])/2,
                       "pixel_error_x": .5, "pixel_error_y": max(.5, (ys[-1]-ys[0]+1)/2)})
    return points, ambiguous


def digitize(image_path, spec):
    actual_hash = sha_file(image_path)
    if spec.get("image_sha256") != actual_hash:
        raise ValueError("Image hash must match the visually calibrated source")
    loc = spec.get("source", {})
    if not loc.get("document_id") or type(loc.get("pdf_page")) is not int or loc["pdf_page"] < 1 or not loc.get("figure"):
        raise ValueError("Require main/SI document, PDF page and figure locator")
    if spec.get("axis_geometry") != "axis_aligned":
        raise ValueError("Only axis-aligned plots supported; no silent rotation/perspective correction")
    with Image.open(image_path) as im:
        image = im.convert("RGB")
    axes = spec["axes"]
    validate_axis(axes["x"], image.width); validate_axis(axes["y"], image.height)
    roi = spec.get("plot_bbox")
    if not isinstance(roi, list) or len(roi) != 4 or any(type(x) is not int for x in roi) or not (0 <= roi[0] < roi[2] <= image.width and 0 <= roi[1] < roi[3] <= image.height):
        raise ValueError("plot_bbox must be [left,top,right,bottom] within image (exclusive end)")
    output, ids = [], set()
    if not spec.get("series"):
        raise ValueError("No explicit series/sample mapping")
    for series in spec["series"]:
        sid = series.get("series_id")
        if not sid or sid in ids or not series.get("sample_id") or not series.get("legend_evidence"):
            raise ValueError("Unique series_id, sample_id and legend evidence required; never infer sample from color alone")
        ids.add(sid)
        if series.get("mode") == "color_trace":
            points, ambiguous = trace_color(image, series, roi)
        elif series.get("mode") == "selected_pixels":
            points, ambiguous = series.get("points", []), []
        else:
            raise ValueError("Series mode must be selected_pixels or color_trace")
        values = []
        for point in points:
            x, y = finite(point["x"], "x"), finite(point["y"], "y")
            if not (roi[0] <= x < roi[2] and roi[1] <= y < roi[3]):
                raise ValueError("Selected point outside plot")
            row = {"pixel": [x, y], "value_status": "digitized"}
            for name, p in (("x", x), ("y", y)):
                error = finite(point.get(f"pixel_error_{name}", .5), "point error", 0)
                row[name] = calibrate(p, error, axes[name], spec.get("allow_extrapolation") is True)
            if "error_bar_y_pixels" in point:
                ends = point["error_bar_y_pixels"]
                if len(ends) != 2 or not series.get("error_bar_meaning"):
                    raise ValueError("Explicit error-bar endpoints and source meaning required")
                ends = [finite(e, "error bar", roi[1]) for e in ends]
                if max(ends) >= roi[3] or not min(ends) <= y <= max(ends):
                    raise ValueError("Error bar must bound the point inside plot")
                mapped = [calibrate(e, .5, axes["y"], spec.get("allow_extrapolation") is True)["value"] for e in ends]
                row["reported_error_bar_digitized"] = {"lower": min(mapped), "upper": max(mapped), "meaning": series["error_bar_meaning"]}
            values.append(row)
        output.append({"series_id": sid, "sample_id": series["sample_id"], "legend_evidence": series["legend_evidence"],
                       "method": series["mode"], "points": values, "ambiguous_columns_skipped": ambiguous,
                       "status": "needs_visual_review" if values else "no_points_detected"})
    return {"format": "rpsme-chart-digitization-v1", "image_sha256": actual_hash, "spec_sha256": digest(spec),
            "source": loc, "calibration": axes, "plot_bbox": roi, "series": output,
            "value_status": "digitized", "origin_type": "derived_from_source_image",
            "scientific_verified": False, "status": "candidate_not_ontology_fact",
            "limitations": "No automatic legend/axis recognition, overlapping-curve recovery or experimental uncertainty inference. Color traces may include same-color artifacts; visual review required."}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("image", type=Path); p.add_argument("--spec", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    try:
        save(a.output, digitize(a.image, load(a.spec)), (a.image, a.spec))
        print(str(a.output))
    except (ValueError, KeyError, TypeError, OSError, OverflowError) as exc:
        p.error(str(exc))


if __name__ == "__main__":
    main()
