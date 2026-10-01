"""Create the pinned MaterialsX research-model directory without downloading weights.

The source registries are benchmarks, not measurements of worldwide usage.
Run this script only when intentionally refreshing the bundled directory.
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DISCOVERY_SHA = "71633e8bdfdfd41d56d64b1d777e5686d9eda3ec"
MATBENCH_SHA = "936176db18ca4cd7b38cbd957c017a5bac770c6b"
DISCOVERY_RAW = f"https://raw.githubusercontent.com/janosh/matbench-discovery/{DISCOVERY_SHA}"
MATBENCH_API = f"https://api.github.com/repos/materialsproject/matbench/contents/benchmarks?ref={MATBENCH_SHA}"


def get(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "MaterialsX model catalog sync"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def yaml_scalar(source: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*(.+?)\s*$", source, re.MULTILINE)
    return match.group(1).strip("\"'") if match else ""


def category_copy(category: str, name: str, benchmark: str) -> tuple[str, str, list[dict[str, str]]]:
    if category == "atomistic":
        return (
            f"{name} 是 {benchmark} 收录的原子尺度模型，可用于评估材料结构相关的能量、力或应力；实际输出取决于该版本的权重和运行环境。",
            f"{name} is an atomistic model listed by {benchmark} for structure-related energy, force, or stress evaluation; supported outputs depend on its checkpoint and runtime.",
            [
                {"zh": f"核查 {name} 的权重与许可，并制定用 CIF 结构计算能量的可复现流程。", "en": f"Check the checkpoint and license for {name}, then plan a reproducible energy calculation from a CIF structure."},
                {"zh": f"比较 {name} 与 CHGNet 在同一晶体结构上的适用范围、输入和验证指标。", "en": f"Compare the scope, inputs, and validation metrics of {name} and CHGNet on the same crystal structure."},
            ],
        )
    if category == "materials-property":
        return (
            f"{name} 是 {benchmark} 收录的材料性质或稳定性预测方案；目录条目不代表预训练权重已公开。",
            f"{name} is a materials-property or stability prediction submission in {benchmark}; this directory entry does not imply public pretrained weights.",
            [
                {"zh": f"说明如何复现 {name} 的材料性质评测，包括输入特征、数据划分和指标。", "en": f"Explain how to reproduce the {name} materials-property benchmark, including features, splits, and metrics."},
                {"zh": f"评估 {name} 是否适合我的材料数据集，并列出运行前缺少的依赖与权重。", "en": f"Assess whether {name} fits my materials dataset and list the missing dependencies and weights before running it."},
            ],
        )
    if category == "materials-chat":
        return (
            f"{name} 是面向材料研究的生成式语言模型；需单独取得兼容权重和推理服务后才能用于对话。",
            f"{name} is a generative language model for materials research; compatible weights and an inference service are required before chat use.",
            [
                {"zh": f"用 {name} 总结一篇材料论文的研究问题、实验方法和主要证据，并标注不确定之处。", "en": f"Use {name} to summarize a materials paper's question, methods, and evidence, marking uncertainty."},
                {"zh": f"让 {name} 比较两种复合材料工艺路线，并列出需要实验验证的假设。", "en": f"Ask {name} to compare two composite-processing routes and identify hypotheses requiring experiments."},
            ],
        )
    if category == "materials-cif-generation":
        return (
            f"{name} 是针对晶体结构 CIF 生成任务训练的材料语言模型；生成结果仍需检查化学式、晶胞和对称性。",
            f"{name} is a materials language model trained for CIF crystal-structure generation; generated formulas, cells, and symmetry still require validation.",
            [
                {"zh": f"说明如何使用 {name} 生成候选 CIF，并用 pymatgen 检查结构有效性。", "en": f"Explain how to generate a candidate CIF with {name} and validate it with pymatgen."},
                {"zh": f"设计 {name} 生成晶体结构后的去重、稳定性筛选和人工复核流程。", "en": f"Plan deduplication, stability screening, and human review after crystal generation with {name}."},
            ],
        )
    if category == "materials-language-base":
        return (
            f"{name} 是材料领域继续预训练的基础语言模型；不是已适配 MaterialsX 工具调用的指令模型。",
            f"{name} is a materials-domain continued-pretraining base model, not an instruction model adapted to MaterialsX tool calls.",
            [
                {"zh": f"评估将 {name} 微调为材料文献问答模型需要的数据、许可和验证集。", "en": f"Assess the data, license, and validation set needed to fine-tune {name} for materials-paper QA."},
                {"zh": f"比较 {name} 基座版与对应 chat 版在材料术语理解和指令遵循方面的差异。", "en": f"Compare the base {name} with its chat variant for materials terminology and instruction following."},
            ],
        )
    return (
        f"{name} 是材料文献领域的文本编码模型，适合检索或下游信息抽取；它不是对话模型。",
        f"{name} is a materials-literature text encoder for retrieval or downstream information extraction; it is not a chat model.",
        [
            {"zh": f"用 {name} 设计材料论文段落的检索或实体抽取流程，并说明是否需要微调。", "en": f"Design a passage-retrieval or entity-extraction workflow with {name}, including any fine-tuning need."},
            {"zh": f"比较 {name} 与通用文本编码器在电池材料术语上的覆盖范围。", "en": f"Compare the coverage of battery-materials terminology in {name} and a general text encoder."},
        ],
    )


def entry(id: str, name: str, category: str, benchmark: str, source_url: str, *, checkpoint_url: str = "", license_name: str = "源站核查") -> dict:
    zh, en, examples = category_copy(category, name, benchmark)
    return {
        "id": id,
        "name": name,
        "category": category,
        "benchmark": benchmark,
        "sourceUrl": source_url,
        "checkpointUrl": checkpoint_url or None,
        "license": license_name,
        "descriptionZh": zh,
        "descriptionEn": en,
        "examples": examples,
    }


def discovery_entries() -> list[dict]:
    source = get(f"{DISCOVERY_RAW}/matbench_discovery/enums.py")
    members = source.split("# BEGIN GENERATED MODEL MEMBERS", 1)[1].split("# END GENERATED MODEL MEMBERS", 1)[0]
    paths = re.findall(r'^\s*\w+\s*= auto\(\), "([^"]+)"', members, re.MULTILINE)
    result = []
    for path in paths:
        model = get(f"{DISCOVERY_RAW}/models/{path}")
        name = yaml_scalar(model, "model_name") or Path(path).stem
        key = yaml_scalar(model, "model_key") or Path(path).stem
        targets = yaml_scalar(model, "targets")
        category = "atomistic" if any(symbol in targets for symbol in ("F", "S")) else "materials-property"
        source_url = f"https://github.com/janosh/matbench-discovery/blob/{DISCOVERY_SHA}/models/{path}"
        checkpoint_license = re.search(r"^  checkpoint:\s*(.+?)\s*$", model, re.MULTILINE)
        result.append(entry(
            f"discovery/{key}", name, category, "Matbench Discovery", source_url,
            checkpoint_url=yaml_scalar(model, "checkpoint_url"),
            license_name=checkpoint_license.group(1).strip("\"'") if checkpoint_license else "源站核查",
        ))
    return result


def matbench_entries() -> list[dict]:
    directories = json.loads(get(MATBENCH_API))
    names = sorted(item["name"] for item in directories if item["type"] == "dir" and item["name"] != "matbench_v0.1_dummy")
    return [entry(
        f"matbench/{name}", name.removeprefix("matbench_v0.1_").replace("_", " "),
        "materials-property", "Matbench v0.1",
        f"https://github.com/materialsproject/matbench/tree/{MATBENCH_SHA}/benchmarks/{name}",
    ) for name in names]


def language_entries() -> list[dict]:
    names = ["llamat-2-chat", "llamat-3-chat", "llamat-2-cif", "llamat-3-cif", "llamat-2", "llamat-3"]
    items = [entry(
        f"hf/m3rg-iitd/{name}", f"LLaMat {name.removeprefix('llamat-')}",
        "materials-chat" if name.endswith("-chat") else "materials-cif-generation" if name.endswith("-cif") else "materials-language-base",
        "LLaMat", f"https://huggingface.co/m3rg-iitd/{name}",
    ) for name in names]
    items.append(entry("hf/m3rg-iitd/matscibert", "MatSciBERT", "materials-text", "MatSciBERT", "https://huggingface.co/m3rg-iitd/matscibert"))
    items.append(entry("hf/batterydata/batterybert-uncased", "BatteryBERT uncased", "materials-text", "BatteryBERT", "https://huggingface.co/batterydata/batterybert-uncased", license_name="Apache-2.0"))
    return items


def main() -> None:
    models = discovery_entries() + matbench_entries() + language_entries()
    assert len(models) == 100, f"Expected 100 source entries, got {len(models)}"
    assert len({model["id"] for model in models}) == 100
    catalog = {
        "schemaVersion": 1,
        "methodologyZh": "100 个可核实的材料模型与评测条目，来自 Matbench Discovery、Matbench 和原作者模型页；不代表全网使用量排名，也不代表权重已安装。",
        "methodologyEn": "100 verifiable materials-model and benchmark entries from Matbench Discovery, Matbench, and author model pages; this is not a worldwide usage ranking or a list of installed weights.",
        "sources": [
            f"https://github.com/janosh/matbench-discovery/tree/{DISCOVERY_SHA}/models",
            f"https://github.com/materialsproject/matbench/tree/{MATBENCH_SHA}/benchmarks",
            "https://huggingface.co/collections/m3rg-iitd/llamat",
            "https://huggingface.co/m3rg-iitd/matscibert",
            "https://huggingface.co/batterydata/batterybert-uncased",
        ],
        "models": models,
    }
    output = ROOT / "models" / "catalog.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(models)} entries to {output}")


if __name__ == "__main__":
    main()
