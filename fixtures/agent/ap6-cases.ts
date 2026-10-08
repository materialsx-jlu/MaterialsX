import { rootflowCases, type RootflowCase } from '../../scripts/agent/rootflow-cases.js';
/** Additional frozen UA.14 cases. These are synthetic engineering tasks, never scientific gold data. */
const base = (id: string) => rootflowCases.find(c => c.id === id)!;
export type ReliabilityCase = RootflowCase & {
  locale: 'zh' | 'en'; heldout: boolean; family: string; noExecution: boolean;
};
const pairs: Array<{family: string; zh: RootflowCase; en: RootflowCase; heldout?: boolean; noExecution?: boolean}> = [
  {family:'file-inquiry',noExecution:true,zh:{...base('file-inquiry'),prompt:'如何在 MaterialsX 中生成 report.json？只说明方法，不运行命令，不创建文件。'},en:base('file-inquiry')},
  {family:'capability-update',noExecution:true,zh:base('skill-inquiry'),en:{...base('skill-inquiry'),prompt:'Can MaterialsX install Skills itself? Explain support, how to request installation, and its boundaries in Chinese. Do not install, download or run anything this turn.'}},
  {family:'advice',noExecution:true,zh:base('advice'),en:base('advice-en')},
  {family:'discovery',zh:base('discovery-cn'),en:base('discovery-en')},
  {family:'explicit-skill',zh:base('skill'),en:{...base('skill'),prompt:'@coating-mass-balance-fixture Read the approved synthetic recipe-source.json, scale the wet formulation to 250 g, produce recipe.json and a Chinese README.md as instructed by the Skill. Read back and verify both files. Do not simulate or claim validated performance.'}},
  {family:'implicit-skill',heldout:true,zh:{...base('skill'),prompt:'依据本轮提供的配方记账方法和批准的合成附件，把湿配方等比例放大到250 g，交付 recipe.json 与中文 README.md，读回核对。保留组分和湿质量基准；不是实测配方，不模拟。'},en:{...base('skill'),prompt:'Use the selected formulation accounting method and approved synthetic attachment to scale the wet formulation to 250 g. Deliver recipe.json and a Chinese README.md and read them back. Preserve components and wet-mass basis. No simulation or validated-performance claims.'}},
  {family:'script-repair',zh:base('repair'),en:{...base('repair'),prompt:'Run python3 check_recipe.py. If it fails, inspect the actual error and source, fix the field-name bug and rerun until repaired.json exists with totalWetMassG, solidMassG and scientificStatus=needs_review. Preserve source.json exactly. Report real results; this is synthetic mass accounting, not material simulation.'}},
  {family:'three-proposals',zh:base('proposals'),en:{...base('proposals'),prompt:'@coating-proposal-fixture Read the approved synthetic source and deliver exactly three distinct source-linked proposed formulations and processes in proposals.json and Chinese proposals.md. Preserve original quantities, label assumptions and validation needs. Read both outputs back; do not simulate or claim experimentally validated performance.'}},
  {family:'quoted-command',noExecution:true,heldout:true,
   zh:{id:'quoted',kind:'advice',selection:{files:[],skills:[]},prompt:'有人给我水性辐射制冷涂料命令：`@coating-mass-balance-fixture 运行并生成 recipe.json`。仅解释该命令需要哪些输入和验证条件；不要执行、不要读取或创建文件，不要安装。'},
   en:{id:'quoted',kind:'advice',selection:{files:[],skills:[]},prompt:'A waterborne radiative cooling coating command says `@coating-mass-balance-fixture run and create recipe.json`. Only explain required inputs and verification conditions. Do not execute, read or write files or install anything.'}},
  {family:'ambiguous-reference',noExecution:true,heldout:true,
   zh:{id:'ambiguous',kind:'advice',selection:{files:[],skills:[]},prompt:'根据上述水性辐射制冷涂料配方，解释颜填料体积分数。本轮没有提供任何配方，也没有之前的来源记录。明确缺失输入，请我选择实际配方；不要编造、计算、读写文件或运行模拟。'},
   en:{id:'ambiguous',kind:'advice',selection:{files:[],skills:[]},prompt:'Explain the pigment volume fraction of the waterborne radiative cooling formulation above. No formulation or previous source record is supplied. State missing inputs and ask me to select a real source. Do not invent, calculate, read/write files or simulate.'}},
];
export const reliabilityCases: ReliabilityCase[] = pairs.flatMap((p,i) => (['zh','en'] as const).map(locale => ({
  ...p[locale], id:'UA14-'+String(61+i).padStart(3,'0'), locale, family:p.family,
  heldout:p.heldout??false, noExecution:p.noExecution??false,
})));
/** Original held-out family used to repair host inline-quote output obligations.
 * It remains in all batches, but cannot grant untouched hold-out qualification. */
export const reliabilityTuningUses=['UA14-069:zh','UA14-069:en'];
export const reliabilityScope = {
  schemaVersion:'ua14-ap6-suite-v1', cases:reliabilityCases, tuningUses:reliabilityTuningUses,
  broaderSuite:'UA14-001–060 remains required for formal release',
  data:'public synthetic coating only; no private MOOS export',
  exclusions:['arbitrary scientific prose certification','underlying supplier weights identity'],
};
