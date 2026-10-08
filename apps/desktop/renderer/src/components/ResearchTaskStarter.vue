<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  ArrowRight, Atom, BookOpenText, ChartNoAxesCombined, ClipboardCheck,
  Database, FilePenLine, FlaskConical, HelpCircle, Lightbulb, Microscope,
  PenLine, ScanSearch, SearchCheck, Shapes, Sparkles,
} from '@lucide/vue';
import type { SkillSummary } from '../../../../../packages/contracts/src/desktop.js';

type Tone = 'blue' | 'cyan' | 'slate';
interface Task {
  title: string;
  detail: string;
  icon: Component;
  tone: Tone;
  skill: string;
  prompt: string;
  needs?: string;
}
interface Group { id: string; label: string; hint: string; tasks: Task[] }
const props = defineProps<{ skills: SkillSummary[] }>();
const emit = defineEmits<{ select: [prompt: string] }>();
const active = ref('beginner');

const groups: Group[] = [
  { id: 'beginner', label: '刚开始研究', hint: '从问题、文献和已有数据入手；不需要先学会写提示词。', tasks: [
    { title: '帮我明确研究问题', detail: '把模糊想法整理成目标、约束和下一步', icon: Lightbulb, tone: 'blue', skill: 'idea-evaluator',
      prompt: '我刚开始做材料研究。请先用通俗语言问我材料体系、想解决的问题、目标性能和已有条件；再帮我写出一个可检验的研究问题，并列出最先要核实的三件事。' },
    { title: '从哪里查论文', detail: '确定关键词、检索范围和可信来源', icon: ScanSearch, tone: 'cyan', skill: 'paper-lookup',
      prompt: '我想开始查材料领域论文。请先帮我明确主题和关键词，优先检索可核验的公开论文，区分摘要与已读全文，并告诉我下一步该读哪几篇及原因。' },
    { title: '带我读一篇论文', detail: '解释方法、结果和证据，不跳过局限', icon: BookOpenText, tone: 'slate', skill: 'materials-literature-rpsme-json', needs: '需要论文 PDF',
      prompt: '我会提供一篇材料论文 PDF。请先确认文件，再按研究问题、材料与工艺、实验方法、主要结果和局限带我阅读；关键数据保留页码和原文证据，不要猜测图表中看不清的数值。' },
    { title: '看懂实验表格', detail: '先核对单位、缺失值、重复样和异常值', icon: ChartNoAxesCombined, tone: 'blue', skill: 'exploratory-data-analysis', needs: '需要实验数据',
      prompt: '我会提供实验表格。请先说明需要什么列和单位，再检查缺失值、异常值、独立重复与测试条件；用易懂的语言解释能得出的结论和暂时不能得出的结论。' },
    { title: '设计第一个对照实验', detail: '确定变量、对照组、重复和评价指标', icon: FlaskConical, tone: 'cyan', skill: 'experimental-design',
      prompt: '我是材料实验初学者。请先问我可用材料、设备、时间和目标指标，然后设计一个范围小、可执行的对照实验，写清变量、对照、独立重复、记录表和安全前提；不要假装实验已完成。' },
    { title: '检查一个研究结论', detail: '辨别证据、推断和还缺少的验证', icon: SearchCheck, tone: 'slate', skill: 'scientific-critical-thinking',
      prompt: '请用初学者能理解的方式评估我提供的材料研究结论。区分已观察事实、推断和假设，指出可能的混杂因素与最小验证实验；没有资料时先问我要来源。' },
  ] },
  { id: 'discovery', label: '选题与文献', hint: '找资料、比较观点，再决定值得研究什么。', tasks: [
    { title: '评估研究想法', detail: '比较新颖性、可行性和关键风险', icon: Lightbulb, tone: 'blue', skill: 'idea-evaluator',
      prompt: '评估我的材料研究想法。先询问材料体系、目标性能、已有工作和可用条件，再分析新颖性、可行性与下一步验证。' },
    { title: '深度文献调研', detail: '整理证据、争议和研究空白', icon: ScanSearch, tone: 'cyan', skill: 'deep-research',
      prompt: '围绕我的材料研究问题开展文献调研，检索并核验来源，按研究路线整理主要结果、争议和仍缺少的证据。' },
    { title: '寻找可检验假设', detail: '提出竞争性解释和反证实验', icon: Sparkles, tone: 'slate', skill: 'hypothesis-generation',
      prompt: '根据我提供的材料研究现象和已有证据，提出多个可检验的竞争性假设。逐条列出预测、替代解释、反证条件和最小验证实验。' },
    { title: '制定研究计划', detail: '拆解目标、资料、步骤和阶段产物', icon: ClipboardCheck, tone: 'blue', skill: 'vibe-research-workflow',
      prompt: '将我的材料研究目标拆成可执行计划，列出已有证据、待补数据、实验或计算步骤、风险和阶段验收标准。' },
    { title: '核对论文引用', detail: '检查 DOI、年份和引用是否支持论点', icon: BookOpenText, tone: 'cyan', skill: 'citation-management',
      prompt: '核对我提供的论文引用与 DOI，检查书目信息和所支持的主张；无法核实的引用请单独列出，不要补造文献。', needs: '需要文献或 DOI' },
  ] },
  { id: 'data', label: '材料数据', hint: '把论文、项目和 MOOS 数据整理成可追溯的研究输入。', tasks: [
    { title: '提取论文实验数据', detail: '保留配方、工艺、性能和证据页码', icon: BookOpenText, tone: 'cyan', skill: 'materials-literature-rpsme-json',
      prompt: '从我提供的材料论文中提取配方、工艺、结构和性能数据，保留原文证据与页码，标出缺失和不确定信息。', needs: '需要论文 PDF' },
    { title: '梳理工艺—结构—性能', detail: '区分报告结果和候选因果关系', icon: Shapes, tone: 'blue', skill: 'materials-xyz-extraction',
      prompt: '从我提供的材料论文或实验记录提取工艺 X、微观结构 Y 和性能 Z，保留全部实验组、单位、证据位置与缺项；仅把 X→Y→Z 作为待验证关系。', needs: '需要论文或实验记录' },
    { title: '比较已有材料数据', detail: '优先使用当前项目，再检索 MOOS', icon: Database, tone: 'slate', skill: 'materials-research-workbench',
      prompt: '先查看当前项目中已选资料，再检索 MOOS 的相关材料实验或配方。保留原始单位、测试条件、审核状态和证据；只比较条件相容的记录，输出可核对的表格。', needs: '需要项目或 MOOS 数据' },
    { title: '探索实验数据', detail: '检查分布、缺失、异常和数据泄漏', icon: ChartNoAxesCombined, tone: 'cyan', skill: 'exploratory-data-analysis',
      prompt: '对我提供的材料实验数据做探索性分析。先核对字段、单位、样本来源和重复结构，再查看缺失值、分布与异常点，说明数据限制并给出下一步清洗建议。', needs: '需要实验数据' },
    { title: '核对单位与误差', detail: '避免量纲不一致和过度精确', icon: SearchCheck, tone: 'blue', skill: 'uncertainty-and-units',
      prompt: '检查我提供的材料数据或计算结果的单位、量纲、有效数字和测量不确定性。保留原始数值，说明每一步转换和不能传播误差的原因。', needs: '需要数值或表格' },
  ] },
  { id: 'experiment', label: '实验与分析', hint: '设计可靠对照，分析真实结果，再决定下一轮。', tasks: [
    { title: '设计对照实验', detail: '明确变量、对照、随机化与重复', icon: FlaskConical, tone: 'blue', skill: 'experimental-design',
      prompt: '为我的材料研究设计对照实验，明确变量、对照组、独立重复、随机化、评价指标和判定标准；先核实设备、成本与时间条件。' },
    { title: '分析实验结果', detail: '选择合适统计方法并报告不确定性', icon: ChartNoAxesCombined, tone: 'cyan', skill: 'statistical-analysis',
      prompt: '分析我提供的材料实验结果。先检查单位、样本量、独立重复和适用假设，再选择统计方法，报告效应量、不确定性、诊断结果和结论边界。', needs: '需要实验数据' },
    { title: '分析拉伸测试', detail: '核对原始曲线、试样与计算口径', icon: Microscope, tone: 'slate', skill: 'materials-tensile-analysis',
      prompt: '分析我提供的材料拉伸测试数据。先确认试样尺寸、应变来源、测试条件与原始曲线，再计算适用指标并标注异常和不能判定的部分。', needs: '需要拉伸数据' },
    { title: '安排下一轮实验', detail: '结合已有反馈生成候选与执行顺序', icon: ClipboardCheck, tone: 'blue', skill: 'materials-next-experiment',
      prompt: '根据当前项目中已保存的研究条件和真实实验反馈，安排下一轮材料实验。先检查对照、独立制备、变量范围、时间和成本；缺关键条件时列出待补清单。', needs: '需要已保存研究条件' },
    { title: '验证一种分析方法', detail: '检查准确度、精密度和适用范围', icon: SearchCheck, tone: 'cyan', skill: 'analytical-method-validation',
      prompt: '为我使用的材料分析或测试方法制定验证方案。请先询问仪器、样品、指标和用途，再列出准确度、精密度、检出/定量范围与记录要求；区分计划和已完成验证。' },
  ] },
  { id: 'simulation', label: '结构与模拟', hint: '先检查结构与模型适用范围，再进行探索性计算。', tasks: [
    { title: '检查原子结构', detail: '查看元素、晶胞、边界和明显问题', icon: Atom, tone: 'blue', skill: 'materials-atomic-structure-inspect',
      prompt: '检查我导入的原子结构：元素、原子数、晶胞、周期边界、近邻距离和潜在阻断项。请先说明需要的结构文件，不要把结构检查说成模拟结果。', needs: '需要结构文件' },
    { title: '选择机器学习势', detail: '核对元素、体系、任务和模型限制', icon: Sparkles, tone: 'cyan', skill: 'materials-mlip-selection',
      prompt: '根据我提供的结构和研究问题，在已安装模型中选择适用的机器学习势。先检查元素、周期性、电荷、自旋、目标任务与模型适用域；不适用时说明原因，不自动声称精度可靠。', needs: '需要结构与任务' },
    { title: '做一次单点试算', detail: '输出能量和受力，保留计算回执', icon: Atom, tone: 'slate', skill: 'materials-mlip-singlepoint',
      prompt: '对当前已导入的兼容结构做一次受控单点试算。先检查模型适用范围和运行环境，执行后输出真实能量、原子受力、单位、模型版本与计算回执。', needs: '需要兼容结构与模型' },
    { title: '探索结构弛豫', detail: '比较前后结构、受力和收敛状态', icon: Microscope, tone: 'blue', skill: 'materials-mlip-relaxation',
      prompt: '对当前已导入的兼容结构进行受限结构弛豫。先说明固定/可变晶胞、步数和收敛标准，运行后给出前后结构、能量、最大受力及真实收敛状态。', needs: '需要兼容结构与模型' },
  ] },
  { id: 'writing', label: '论文与成果', hint: '在证据充分的范围内组织图表、稿件与审稿回复。', tasks: [
    { title: '梳理论文结构', detail: '组织问题、方法、结果和贡献', icon: Shapes, tone: 'slate', skill: 'tech-paper-template',
      prompt: '根据我已有的材料研究证据，梳理论文的问题、方法、结果和贡献，指出论证链中缺少的数据。', needs: '需要研究资料' },
    { title: '起草论文引言', detail: '交代背景、缺口与研究目标', icon: PenLine, tone: 'cyan', skill: 'intro-drafter',
      prompt: '根据我提供的研究背景和已核实文献，起草材料论文引言；未核实的引用不要写入正文。', needs: '需要背景与文献' },
    { title: '撰写论文草稿', detail: '基于现有证据起草正文', icon: FilePenLine, tone: 'blue', skill: 'paper-writer',
      prompt: '根据我提供的已核实材料起草论文内容。事实和引用必须可追溯；证据不足的位置明确标记，不要编造结果。', needs: '需要研究资料' },
    { title: '设计科研图表', detail: '确定每张图的结论、数据与形式', icon: Microscope, tone: 'cyan', skill: 'figure-designer',
      prompt: '根据我的研究目标和现有数据设计论文图表方案。说明每张图表达的结论、所需数据、推荐形式与误导性呈现风险。', needs: '需要结果或数据' },
    { title: '审查投稿稿件', detail: '按证据、方法和图表逐项检查', icon: ClipboardCheck, tone: 'slate', skill: 'pre-submission-reviewer',
      prompt: '以审稿视角检查我的材料论文草稿，逐条指出证据不足、实验设计、图表和行文问题，并给出修改优先级。', needs: '需要稿件' },
    { title: '准备审稿回复', detail: '区分已修改、待补实验和无法支持的主张', icon: Sparkles, tone: 'blue', skill: 'rebuttal-guidance',
      prompt: '根据审稿意见和我的现有实验数据，逐条制定回复方案，区分已完成的修改、待补实验和不能支持的主张。', needs: '需要审稿意见' },
  ] },
];

const ready = computed(() => new Set(props.skills.filter(skill => skill.enabled).map(skill => skill.name)));
const shown = computed<Group>(() => groups.find(group => group.id === active.value) ?? groups[0]!);
function choose(task: Task) {
  emit('select', ready.value.has(task.skill) ? `@${task.skill} ${task.prompt}` : task.prompt);
}
</script>

<template>
  <div class="research-starters">
    <div class="starter-guide">
      <span class="guide-icon"><HelpCircle :size="19" /></span>
      <div><strong>第一次使用？从一个问题开始</strong>
        <p>选择任务后，先在输入框补上你的材料、目标或文件。发送前可以修改；结果中的数据与引用仍需核对。</p></div>
    </div>
    <div class="starter-section-head"><div><h3>按研究阶段选择</h3><p>{{ shown.hint }}</p></div>
      <span>{{ shown.tasks.length }} 个常用任务</span></div>
    <div class="starter-filters" role="tablist" aria-label="研究任务分类">
      <button v-for="group in groups" :key="group.id" type="button" role="tab"
        :aria-selected="active === group.id" :class="{ active: active === group.id }"
        @click="active = group.id">{{ group.label }}</button>
    </div>
    <div class="research-starter-grid" role="tabpanel">
      <button v-for="task in shown.tasks" :key="task.title" type="button"
        :class="['research-starter-card', `tone-${task.tone}`]"
        :data-skill="task.skill" @click="choose(task)">
        <span class="research-starter-icon"><component :is="task.icon" :size="18" /></span>
        <span class="research-starter-copy"><strong>{{ task.title }}</strong><small>{{ task.detail }}</small>
          <span v-if="task.needs || !ready.has(task.skill)" class="task-note">{{ ready.has(task.skill) ? task.needs : 'Skill 未启用 · 将作为普通请求填写' }}</span></span>
        <ArrowRight :size="15" class="research-starter-arrow" />
      </button>
    </div>
    <p class="starter-footnote">点击任务仅填写输入框，不会自动发送或运行工具。你也可以直接描述自己的问题。</p>
  </div>
</template>

<style scoped>
.research-starters{display:grid;gap:0;margin-top:25px;min-width:0}.starter-guide{display:flex;align-items:flex-start;gap:12px;padding:15px 17px;border:1px solid var(--line);border-radius:12px;background:var(--catalog-surface)}.guide-icon{display:grid;flex:none;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--accent-bg);color:var(--accent)}.starter-guide strong{display:block;margin:1px 0 3px;font-size:13px;font-weight:650}.starter-guide p{margin:0;color:var(--muted);font-size:11px;line-height:1.65}.starter-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:15px;margin:23px 0 11px}.starter-section-head h3{margin:0 0 3px;font-size:14px}.starter-section-head p{margin:0;color:var(--muted);font-size:11px;line-height:1.5}.starter-section-head>span{flex:none;color:var(--dim);font-size:10px}.starter-filters{display:flex;gap:6px;overflow-x:auto;padding:0 0 11px;border-bottom:1px solid var(--line);scrollbar-width:thin}.starter-filters button{flex:none;min-height:32px;padding:6px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);font:inherit;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}.starter-filters button:hover{background:var(--panel-2);color:var(--text)}.starter-filters button.active{border-color:var(--line);background:var(--panel-2);color:var(--text)}.starter-filters button:focus-visible,.research-starter-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.research-starter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:13px}.research-starter-card{--tone:var(--accent);--tone-bg:var(--accent-bg);display:flex;align-items:flex-start;gap:11px;min-width:0;min-height:88px;padding:13px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);color:var(--text);cursor:pointer;text-align:left;transition:border-color .15s,background .15s}.research-starter-card.tone-cyan{--tone:var(--accent);--tone-bg:var(--panel-3)}.research-starter-card.tone-slate{--tone:var(--muted);--tone-bg:var(--panel-2)}.research-starter-card:hover{border-color:var(--tone);background:var(--tone-bg)}.research-starter-icon{display:grid;flex:none;place-items:center;width:31px;height:31px;border-radius:8px;background:var(--tone-bg);color:var(--tone)}.research-starter-copy{display:grid;gap:3px;min-width:0}.research-starter-copy strong{font-size:12px;font-weight:650;line-height:1.45}.research-starter-copy small{color:var(--muted);font-size:10px;line-height:1.5}.task-note{margin-top:3px;color:var(--dim);font-size:10px;line-height:1.4}.research-starter-arrow{flex:none;margin-left:auto;color:var(--dim);opacity:.65}.research-starter-card:hover .research-starter-arrow{color:var(--tone);opacity:1}.starter-footnote{margin:12px 0 0;color:var(--dim);font-size:10px;line-height:1.6}
@media(max-width:620px){.research-starter-grid{grid-template-columns:1fr}.starter-section-head>span{display:none}.starter-guide{padding:13px}.research-starter-card{min-height:75px}}@media(prefers-reduced-motion:reduce){.research-starter-card{transition:none}}
</style>
