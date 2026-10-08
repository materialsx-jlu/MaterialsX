/** Advice is a response request, not permission to manufacture a computational workflow. */
function activeOperations(text:string):string {
  return text.replace(/(?:不(?:要|必|需(?:要)?|创建)?|无需|禁止|不要|不能)(?:\s|再|去|进行|创建|输出|虚构|编造|假设)*(?:执行|运行|计算|模拟|仿真|生成|导出|保存|下载|安装|上传|调用|实测|论文来源|文件)(?:执行|运行|计算|模拟|仿真|生成|实测)*(?:数据|性能|结果|文件|报告|来源)?/g, '')
    .replace(/\b(?:do not|don't|without|no need to|never)\s+(?:create|run|execute|calculate|simulate|generate|export|save|download|install|upload|invent|fabricate)(?:\s+(?:files?|simulations?|calculations?|measured (?:data|performance)|references?))?/gi, '');
}
export function advisoryQuestion(request: string): boolean {
  const text = request.trim(), actions = activeOperations(text);
  const question = /^(?:请问[，,\s]*)?(?:如何|怎么|怎样|应如何|该如何|how\s+(?:can|do|should|would)\b|how\s+to\b)/i.test(text);
  if (!question) return false;
  // Explicit operations, selected evidence, numerical criteria, and workflow skills
  // keep ordinary model context and host gates, even inside a question. This helper only adds advice copy.
  if (/(?:@|\/skill:)\S+|\.pdf\b|\.csv\b|\.json\b|\.cif\b|https?:\/\/|(?:\/Users\/|[A-Z]:\\)/i.test(text)) return false;
  if (/\d|执行|运行|计算|模拟|仿真|生成|导出|保存|下载|安装|上传|调用|比较|对比|优化|拟合|统计|分析|实测|已有数据|选定|实验设计|设计实验|下一轮|贝叶斯|主动学习|检索|搜索|查找|查询|复现|完整流程|全流程/i.test(actions)) return false;
  if (/\b(?:run|execute|calculat\w*|simulat\w*|generat\w*|export|save|download|install|upload|compare|optimi[sz]\w*|fit|statistics|analy[sz]\w*|selected|measured|search|find|retrieve|reproduce|workflow)\b|experimental design|design (?:an? )?experiment/i.test(actions)) return false;
  return true;
}

/** Shared response scope for both engines; the saved user request and grant are unchanged. */
export function advisoryContent(request: string): string {
  if (recipeProposalFollowup(request)) return request + `

[MaterialsX 配方建议 / Recipe proposal]\nRequested named proposals: ${requestedRecipeCount(request)}. Record each through recipe_proposal; do not stop after one when several were requested.
先用 research_data {"action":"read_current_recipes"} 读取本轮冻结的来源配方。用户用中文提问时，recipe_proposal 的 name、reason 和 gaps 使用中文；preparation/checks 选择接口声明的选项 ID，程序自动展示中文说明。材料名称和单位可保留英文。不得重新搜索代替读取上述来源；若没有来源，明确说明并请求补充。原文用量、工艺和页码是来源事实；建议新增或调整的用量、步骤是待实验验证的假设，两者分开列出。来源缺项保留缺项，不得把一个配方的数值冒充另一个配方的原文值。给出可操作的初步配方、工艺、调整理由、待确认条件与验证方法；不要声称已优化、已执行实验或达到具体性能。没有要求文件、模拟或实验设计时，用 recipe_proposal 记录建议后在聊天中交付，无须额外文件。
Read frozen previous recipes with research_data {"action":"read_current_recipes"}. Separate original facts with evidence pages from proposed changes and assumptions. Preserve gaps and review labels. Do not invent evidence, measurements or completed experiments. After reading sources, call recipe_proposal with name, changes (one-based component, amount, original unit, reason), preparation/checks enum IDs from current guidance, and gaps. Do not write free-text steps or undocumented equipment/numeric conditions into those option arrays. The host renders source/proposed amounts separately. This is a bounded proposal in chat, not permission to execute a simulation or create an unrelated statistical workflow.`;
  if (!advisoryQuestion(request)) return request;
  return request + `\n\n[MaterialsX 咨询回答范围 / Advisory scope]
这是设计咨询，优先给出约 600–900 字的清晰建议，避免重复声明或冗长开场。请先说明目标功能的物理机制和待确认的应用场景，再给出一般设计思路、候选材料和验证步骤。当前没有实验数据，不能调用统计方法来假装完成设计；无须生成文件或寻找无关项目文件。
没有实际检索或读取到的来源，不得列为参考文献；不得编造书名、论文、DOI、证据或性能数据。明确区分设计假设与实测结论，不承诺具体降温、性能提升或最优配方。必要条件可在回答末尾询问，不要阻止给出有边界的初步建议。
This is design advice, not a request for measured results or files. Explain the physical mechanism and missing use conditions, then outline candidate choices and verification. Never invent references, recipe certainty, numerical performance or executed calculations. Clearly label assumptions and unverified suggestions.`;
}

/** Bounded MOOS recipe retrieval uses the existing tool loop, not an invented research method. */
export function moosRecipeLookup(request:string){
  return /\bMOOS\b/i.test(request)&&/配方|recipe/i.test(request)&&/搜索|查找|获取|查询|读取|search|find|retrieve|read/i.test(request)&&!/设计|优化|比较|对比|拟合|模拟|分析|design|optimi[sz]|compar|simulat|analy[sz]/i.test(request);
}

/** Requested number of source-grounded recipe candidates, not permission to invent data. */
export function requestedRecipeCount(request:string):number {
  const matches=[...request.matchAll(/(?<![\d.-])(\d+|[一二两三四五六七八九十]+)\s*(?:个|套|种|条)?\s*(?:(?:不同的?|新的?|初步的?|建议的?|可行的?)\s*)?(?:实验)?(?:配方|方案|建议)|\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:distinct|different|initial|preliminary|new|experimental|recipe|formulation)\s+)*(?:recipes?|formulations?|proposals?|suggestions?|options?)\b/gi)]
    .filter(m=>!/(?:不要|不用|不需|不是|not|no|don't|do not)(?:\s*(?:给|提供|生成|give|provide|generate))?\s*$/i.test(request.slice(0,m.index)));
  const match=matches.at(-1);if(!match)return 1;
  const raw=(match[1]??match[2]!).toLowerCase(),digits:Record<string,number>={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const n=/^\d+$/.test(raw)?Number(raw):raw.includes('十')?(raw.split('十')[0]?digits[raw.split('十')[0]!]!:1)*10+(digits[raw.split('十')[1]!]??0):digits[raw]!;
  return Number.isSafeInteger(n)&&n>0?n:1;
}

/** Bind source-grounded chat proposals, not a general task router or execution permission. */
export function recipeProposalFollowup(request:string):boolean {
  const text=request.split('\nFollow the authoritative MaterialsX')[0]!;
  return /配方|recipes?|formulation/i.test(text)&&
    /基于(?:上述|以上|这些|前述)|根据(?:上述|以上|这些|前述)|based on (?:the )?(?:above|previous|these)/i.test(text)&&
    /建议|推荐|propos|suggest|recommend/i.test(text)&&
    requestedRecipeCount(text)<=5&&
    !/(?:@|\/skill:)|执行|运行|计算|模拟|仿真|拟合|统计|实验设计|设计实验|下一轮|贝叶斯|主动学习|保存|导出|报告|文件|CSV|SVG|JSON|PDF|搜索|检索|下载|安装|\b(?:run|execute|simulat\w*|calculat\w*|fit|DOE|export|save|report|file|search)\b|experimental design/i.test(activeOperations(text));
}
