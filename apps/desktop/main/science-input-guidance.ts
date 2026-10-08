import type { ScientificScope } from '../../../packages/contracts/src/potential-physics.js';
import type { AnalysisScope } from '../../../packages/contracts/src/potential-workflow.js';
/** A copied automatic-analysis example is not an atomic structure or a download scope. */
export function scienceInputGuidance(request:string,science?:ScientificScope,analysis?:AnalysisScope):string|null {
  const automatic=/auto_plan|auto_run|自动.{0,24}(?:选择|匹配|调用)|(?:automatic|automatically).{0,30}(?:select|choose|use)/i.test(request);
  const execute=/执行|运行|弛豫|单点计算|进行.{0,12}(?:分析|模拟)|\b(?:run|execute|relax|calculate|analy[sz]e)\b/i.test(request);
  const atomic=/机器学习势|原子|晶胞|晶体|分子|materials_science|potential|atomic|crystal|molecul/i.test(request);
  if(!automatic||!execute||!atomic||science&&analysis&&science.structureId===analysis.structureId&&science.projectId===analysis.projectId&&science.conversationId===analysis.conversationId&&science.permission===analysis.permission)return null;
  return /[\u3400-\u9fff]/.test(request)
    ? '需要先选择本轮分析的原子结构。\n\n打开 **模型目录 → 机器学习势 → 模型下载与自动分析**，选择已导入结构，设置计算任务和步数，再点击 **授权对话助手分析**。系统会把结构和任务范围带入提问。\n\n也可以点击硅晶体示例的 **在对话中试用**：它会准备内置 8 原子硅结构和最多 3 步固定晶胞弛豫，然后填入输入框供你发送。\n\n本轮尚未运行计算，也未下载模型。'
    : 'Choose the atomic structure for this analysis first.\n\nOpen **Model directory → ML potentials → Downloads & automatic analysis**, select an imported structure, set the calculation and step limit, then click **Authorize chat analysis**.\n\nAlternatively, click **Try in chat** for the silicon example to prepare the bundled 8-atom structure and up to 3 fixed-cell relaxation steps. Send the prepared prompt.\n\nNo calculation or model download has started.';
}
