// Public synthetic test inputs shared by product and native diagnostics, never user research data.
export const rootflowSource = { kind: "synthetic-test-data", basis: "wet mass in grams", components: [
  { name: "waterborne binder", amountG: 40, solidFraction: 0.5 },
  { name: "pigment", amountG: 20, solidFraction: 1 },
  { name: "filler", amountG: 10, solidFraction: 1 },
  { name: "added water", amountG: 30, solidFraction: 0 },
] };
export const rootflowSourceText = JSON.stringify(rootflowSource, null, 2);
export const repairPrompt = "运行项目中的 python3 check_recipe.py。如果失败，请读取真实错误，自行修正脚本的数据字段问题，再运行验证，直到生成 repaired.json。保留 source.json 中的原始合成数据，结果应含 totalWetMassG、solidMassG 和 scientificStatus=needs_review。请报告发生的问题、修正和实际文件；这是普通质量记账测试，不是材料模拟。";
export const brokenRecipeScript = `import json
from pathlib import Path
data=json.loads(Path('source.json').read_text())
components=data['components']
wet=sum(x['amount_grams'] for x in components)
solid=sum(x['amount_grams']*x['solidFraction'] for x in components)
Path('repaired.json').write_text(json.dumps({'totalWetMassG':wet,'solidMassG':solid,'scientificStatus':'needs_review'}))
print('Wrote repaired.json')
`;
