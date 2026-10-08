/** Opt-in is scoped to the saved request, never inferred from a search failure. */
export function unreviewedSourceRequested(request: string): boolean {
  const pending = '(?:待审核|待复核|未审核|未复核)(?:来源|记录|数据|配方)?';
  if (new RegExp('(?:不允许|禁止|不要|不使用|排除|不得)[^。；;\\n]{0,16}' + pending).test(request)) return false;
  if (/\b(?:exclude|do not include|don't include|no)\s+(?:unreviewed|pending[- ]review)|仅(?:使用|读取|查询)?已审核|only (?:use )?(?:reviewed|verified)/i.test(request)) return false;
  return new RegExp('(?:包含|允许(?:本次)?(?:使用|读取|查询)?|使用|读取)\\s*' + pending).test(request)
    || /include[- ]unreviewed/i.test(request);
}
