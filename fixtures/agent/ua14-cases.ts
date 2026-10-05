import {
  qualificationCase,
  type QualificationCase,
} from "../../packages/contracts/src/qualification.js";
/** Frozen authored synthetic test families; no real experimental measurements or scientific certification. */
const families = [
  "file-edit",
  "summary",
  "fit",
  "comparison",
  "incompatible",
  "missing",
] as const;
const prompts = {
  "file-edit": {
    zh: "显示 probe.txt，实际读取后将其中 before 改为 after，保持其他内容不变，再读取验证。只修改这个文件。",
    en: "Show probe.txt: actually read it, replace before with after while preserving everything else, then read it again to verify. Modify only this file.",
  },
  summary: {
    zh: "显示已选项目合成测试样品的强度观测值平均数。先用 research_quality 检查证据，再筛选适用的原值描述统计方法并实际生成 JSON 和报告。保留全部三个样品、原单位和原条件；不拟合，不推断真实实验准确性。",
    en: "Show the mean strength of the selected synthetic project samples. Check evidence with research_quality, assess an eligible descriptive-summary method and actually generate JSON and a report. Keep all three samples, original units and conditions. Do not fit or claim real experimental accuracy.",
  },
  fit: {
    zh: "显示已选合成样品中 loading 与 strength 的线性拟合。先检查证据，再筛选适用的线性拟合方法，实际生成 JSON 和报告。保留三个样品和原单位；拟合不代表预测验证，不做单位换算。",
    en: "Show a linear fit of loading versus strength for the selected synthetic samples. Check evidence, assess an eligible linear-fit method and actually generate JSON and a report. Keep all three samples and original units. A fit is not predictive validation. Do not convert units.",
  },
  comparison: {
    zh: "显示已选三个合成样品的强度原值比较，实际生成 CSV、SVG 和报告。使用原条件、原单位和真实证据，不进行拟合或模拟，不将这些合成数据称为实测数据。",
    en: "Show the original strength comparison for the three selected synthetic samples. Actually generate CSV, SVG and a report using original units, conditions and actual evidence. Do not fit or simulate, or call these synthetic values experimental measurements.",
  },
  incompatible: {
    zh: "显示已选样品的强度是否可合并计算平均数。必须先检查全部来源的单位和测试条件；不一致时停止统计并给出有证据的缺项报告，不做换算，不丢弃样品，不编造结果。",
    en: "Show whether the selected strengths can be pooled for a mean. Check units and test conditions of every source first. If incompatible, stop statistics and produce an evidence-linked quality report. Do not convert, discard samples or fabricate a result.",
  },
  missing: {
    zh: "显示尚未提供配方、测量数据和测试条件的材料强度平均数。缺少必需输入时列出需要补充的信息并停止计算，不编造数值或运行模拟。",
    en: "Show the mean strength of a material whose recipe, measurements and test conditions have not been supplied. List missing required inputs and stop calculation. Do not fabricate values or run a simulation.",
  },
};
export const qualificationCases: QualificationCase[] = families.flatMap(
  (family, group) =>
    Array.from({ length: 10 }, (_, seed) =>
      qualificationCase.parse({
        id: "UA14-" + String(group * 10 + seed + 1).padStart(3, "0"),
        family,
        seed,
        prompt: Object.fromEntries(
          Object.entries(prompts[family]).map(([locale, text]) => [
            locale,
            text +
              (locale === "zh"
                ? ` 合成批次 S${seed}；禁止联网；限时90秒。`
                : ` Synthetic batch S${seed}; offline only; time limit 90 seconds.`),
          ]),
        ),
        expected: {
          mean: 5 + seed,
          slope: 2 + seed / 10,
          intercept: 3 + seed - seed / 10,
          unit: "MPa",
        },
        absoluteTolerance: 1e-10,
        scientificStatus: "synthetic-engineering-only",
      }),
    ),
);
