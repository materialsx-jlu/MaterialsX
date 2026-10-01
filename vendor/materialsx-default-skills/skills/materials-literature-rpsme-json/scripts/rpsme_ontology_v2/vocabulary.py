"""Frozen names and relation constraints for the RPSME exchange contract."""

PACKAGE_VERSION = "rpsme-patent-package-v2"
SCHEMA_VERSION = "rpsme-ontology-1.2"
CONTRACT_SCHEMA_VERSION = "rpsme-ontology-1.3"
OPPORTUNITY_SCHEMA_VERSION = "rpsme-ontology-1.4"
PERSISTENCE_SCHEMA_VERSION = SCHEMA_VERSION
SUPPORTED_SCHEMA_VERSIONS = {
    "rpsme-ontology-1.0", "rpsme-ontology-1.1", SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION, OPPORTUNITY_SCHEMA_VERSION,
}
DOCUMENT_SET_SCHEMA_VERSIONS = {SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION, OPPORTUNITY_SCHEMA_VERSION}
BUNDLE_VERSION = "rpsme-bundle-1.0"
EXPERIMENT_CONTRACT = "rpsme-experiment-contract-v2"
PROMPT_VERSION = "rpsme-patent-v11-evidence-flow"

VALUE_STATUSES = {
    "reported", "inherited", "calculated", "digitized", "predicted", "inferred", "pending",
}
ENTITY_KINDS = {
    "material_class", "chemical", "substance", "commercial_product", "purchased_batch",
}

ENTITY_COLLECTIONS = (
    "document_elements", "experiment_runs", "experiment_changes", "materials", "material_aliases",
    "recipes", "ingredient_usages", "process_routes", "process_steps", "material_states", "process_feeds",
    "specimens", "tests", "property_observations", "characterization_instruments", "instrument_mentions",
    "characterization_events", "characterization_measurements", "structure_observations",
    "mechanism_hypotheses", "simulation_studies", "simulation_runs", "simulation_parameters",
    "simulation_results", "asset_references", "media_artifacts", "comparisons",
)

# Added as a backward-compatible evidence-chain extension. Packages created
# before the extension may omit these arrays; new adapters always emit them,
# including explicit empty arrays when the patent reports no characterization.
OPTIONAL_ENTITY_COLLECTIONS = {
    "characterization_instruments", "characterization_events", "characterization_measurements", "media_artifacts", "process_feeds", "simulation_results",
    "instrument_mentions", "simulation_runs", "simulation_parameters", "asset_references",
}

COLLECTION_ENTITY_TYPES = {
    "document_elements": "document_element", "experiment_runs": "experiment_run",
    "experiment_changes": "experiment_change", "materials": "material",
    "material_aliases": "material_alias", "recipes": "recipe",
    "ingredient_usages": "ingredient_usage", "process_feeds": "process_feed", "process_routes": "process_route",
    "process_steps": "process_step", "material_states": "material_state",
    "specimens": "specimen", "tests": "test",
    "property_observations": "property_observation", "structure_observations": "structure_observation",
    "characterization_instruments": "characterization_instrument",
    "characterization_events": "characterization_event", "media_artifacts": "media_artifact",
    "characterization_measurements": "characterization_measurement",
    "mechanism_hypotheses": "mechanism_hypothesis", "simulation_studies": "simulation_study",
    "simulation_results": "simulation_result",
    "comparisons": "comparison",
    "instrument_mentions": "instrument_mention",
    "simulation_runs": "simulation_run",
    "simulation_parameters": "simulation_parameter",
    "asset_references": "asset_reference",
}

# Authoritative endpoint matrix. A new relation requires a versioned contract change.
RELATION_ENDPOINTS = {
    "REPORTS": {("source_document", "experiment_record")},
    "HAS_RECIPE": {("experiment_record", "recipe")},
    "HAS_USAGE": {("recipe", "ingredient_usage")},
    "USES_MATERIAL": {("ingredient_usage", "material"), ("process_feed", "material")},
    "INTRODUCED_AT": {("ingredient_usage", "process_step")},
    "FEEDS": {("process_feed", "process_step")},
    "HAS_ROUTE": {("experiment_record", "process_route")},
    "HAS_STEP": {("process_route", "process_step")},
    "CONSUMES": {("process_step", "material_state")},
    "PRODUCES": {("process_step", "material_state")},
    "SOURCE_OF": {("material_state", "specimen")},
    "HAS_SPECIMEN": {("experiment_record", "specimen")},
    "TESTED_BY": {("specimen", "test"), ("material_state", "test")},
    "YIELDS": {("test", "property_observation")},
    "HAS_CHARACTERIZATION": {("experiment_record", "characterization_event")},
    "USES_INSTRUMENT": {
        ("characterization_event", "characterization_instrument"),
        ("characterization_event", "instrument_mention"),
    },
    "RESOLVES_TO": {("instrument_mention", "characterization_instrument")},
    "CHARACTERIZES": {
        ("characterization_event", "specimen"), ("characterization_event", "material_state"),
        ("characterization_event", "material"),
        ("structure_observation", "specimen"), ("structure_observation", "material_state"),
        ("structure_observation", "material"),
    },
    "GENERATES": {
        ("characterization_event", "media_artifact"),
        ("simulation_study", "media_artifact"),
        ("simulation_run", "media_artifact"),
    },
    "YIELDS_STRUCTURE": {("characterization_event", "structure_observation")},
    "YIELDS_MEASUREMENT": {("characterization_event", "characterization_measurement")},
    "YIELDS_SIMULATION_RESULT": {
        ("simulation_study", "simulation_result"),
        ("simulation_run", "simulation_result"),
    },
    "DERIVED_FROM": {("structure_observation", "media_artifact")},
    "HAS_MECHANISM": {("experiment_record", "mechanism_hypothesis")},
    "HAS_SIMULATION": {("experiment_record", "simulation_study")},
    "HAS_RUN": {("simulation_study", "simulation_run")},
    "HAS_PARAMETER": {("simulation_run", "simulation_parameter")},
    "HAS_ASSET": {
        ("media_artifact", "asset_reference"),
        ("simulation_run", "asset_reference"),
    },
    "INPUT_OF": {("asset_reference", "simulation_run")},
    "OUTPUT_OF": {("asset_reference", "simulation_run")},
    "REPRODUCES": {("simulation_run", "simulation_run")},
    "MODELS": {
        ("simulation_study", "material"), ("simulation_study", "material_state"),
        ("simulation_study", "specimen"), ("simulation_study", "property_observation"),
    },
    "SUPPORTS": {
        ("structure_observation", "mechanism_hypothesis"),
        ("simulation_study", "mechanism_hypothesis"),
        ("simulation_result", "mechanism_hypothesis"),
        ("property_observation", "mechanism_hypothesis"),
    },
    "REFUTES": {
        ("structure_observation", "mechanism_hypothesis"),
        ("simulation_study", "mechanism_hypothesis"),
        ("simulation_result", "mechanism_hypothesis"),
        ("property_observation", "mechanism_hypothesis"),
    },
    "HAS_COMPARISON": {("experiment_record", "comparison")},
    "COMPARES_TO": {("comparison", "experiment_record")},
    "HAS_CHANGE": {("comparison", "experiment_change")},
    "ALIASES": {("material_alias", "material")},
    "POSSIBLE_MATCH": {("material", "material")},
}
RELATION_TYPES = set(RELATION_ENDPOINTS)

UNIT_DIMENSIONS = {
    "": "dimensionless", "%": "fraction", "wt%": "fraction", "vol%": "fraction",
    "percentage_point": "fraction", "parts_by_mass": "mass_ratio", "reported_percent": "fraction",
    "g": "mass", "kg": "mass", "mg": "mass", "g/mol": "molar_mass",
    "mL": "volume", "L": "volume", "L/m²": "volume_per_area",
    "MPa": "pressure", "GPa": "pressure", "Pa": "pressure",
    "mPa·s": "dynamic_viscosity", "Pa·s": "dynamic_viscosity",
    "°C": "temperature", "K": "temperature", "s": "time", "min": "time", "h": "time",
    "mm": "length", "µm": "length", "nm": "length", "m²": "area", "g/m²": "areal_mass",
    "kJ/m²": "energy_per_area", "KJ/m²": "energy_per_area", "mm/min": "speed",
    "rpm": "rotational_speed", "cycles": "count", "classification": "classification",
    "eV": "energy", "Ry": "energy", "Å": "length", "V": "voltage",
    "mA/cm²": "current_density", "mA/cm2": "current_density", "Ω/sq": "sheet_resistance",
    "degrees": "angle", "°": "angle", "ps": "time", "fs": "time",
}
UNKNOWN_TOKENS = {"NR", "NOT_REPORTED", "PENDING", "NA"}


# Reference capability describes the technique class, never the actual device
# used in an experiment. Reported manufacturer/model/acquisition parameters stay
# on the instrument/event entities and require source evidence.
CHARACTERIZATION_TECHNIQUES = {
    "SEM": {
        "display_name_zh": "扫描电子显微镜", "instrument_type": "electron_microscope",
        "nominal_resolution": {"value": 1, "unit": "nm", "qualifier": "approximately", "resolution_axis": "lateral"},
        "image_types": ["surface_morphology", "fractography", "elemental_mapping"],
        "notes_zh": "元素分布图通常需要联用 EDS/EDX 探测器；典型分辨率不是本次实验设备的实测值。",
    },
    "TEM": {
        "display_name_zh": "透射电子显微镜", "instrument_type": "electron_microscope",
        "nominal_resolution": {"max": 0.1, "unit": "nm", "qualifier": "less_than", "resolution_axis": "lateral"},
        "image_types": ["transmission_image", "hrtem_lattice_fringe", "electron_diffraction_pattern"],
        "notes_zh": "能否达到原子分辨率取决于仪器、样品制备和成像模式。",
    },
    "AFM": {
        "display_name_zh": "原子力显微镜", "instrument_type": "scanning_probe_microscope",
        "nominal_resolution": {"value": 0.1, "unit": "nm", "qualifier": "approximately", "resolution_axis": "vertical"},
        "image_types": ["quantitative_height_map", "surface_topography", "force_or_adhesion_map"],
        "notes_zh": "约 0.1 nm 通常指垂直分辨率；横向分辨率受探针尖端和扫描条件影响。",
    },
    "OM": {
        "display_name_zh": "光学显微镜（金相显微镜）", "instrument_type": "optical_microscope",
        "nominal_resolution": {"value": 200, "unit": "nm", "qualifier": "approximately", "resolution_axis": "lateral"},
        "image_types": ["grain_morphology", "microstructure", "polarized_or_color_optical_image"],
        "notes_zh": "约 200 nm 是可见光衍射极限量级，不代表具体物镜与系统的标定分辨率。",
    },
}


def entity_type_for_collection(collection: str) -> str:
    return COLLECTION_ENTITY_TYPES[collection]
