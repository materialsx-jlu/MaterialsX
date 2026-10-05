/** Small host checks for explicit missing input. This is not a scientific rule engine. */
export function explicitResearchGaps(text: string): string[] {
  const gaps: string[] = [];
  if (
    /wt\s*%/i.test(text) &&
    /vol\s*%/i.test(text) &&
    /比较|换算|等同|compare|convert|equat/i.test(text) &&
    !/(?:密度|densit\w*)\s*[:=]\s*\d/i.test(text)
  )
    gaps.push(
      "质量分数和体积分数不能直接比较。需取得各组分密度，或明确仅讨论两种定义。 / Mass and volume fractions need component densities for conversion.",
    );
  if (
    /(?:必需|必要|必须).{0,24}(?:文件|数据).{0,12}(?:缺失|缺少)|required.{0,30}(?:file|json|data).{0,20}(?:absent|missing)/i.test(
      text,
    )
  )
    gaps.push(
      "用户声明必需文件或数据缺失，需要补充输入或核对真实产物。 / The request explicitly reports missing required data or artifacts.",
    );
  return gaps;
}
