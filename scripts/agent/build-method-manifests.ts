import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {z} from 'zod';
import {methodInput,methodAnalysisSchema} from '../../packages/contracts/src/research-methods.js';
import {methodPackageSchema} from '../../packages/contracts/src/method-packages.js';
import {hash,canonical} from '../../packages/atomistic/src/discovery-io.js';
const bi=(zh:string,en:string)=>({zh,en}),license='https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications';
const assets=[
  {id:'source-summary',backend:'summary-v1',methodId:'descriptive-summary',name:bi('原值描述统计','Source-value summary'),file:'PiDigits.dat',refId:'nist-pidigits',
    url:'https://www.itl.nist.gov/div898/strd/univ/data/PiDigits.dat',expected:{mean:4.5348,sampleSd:2.86733906028871},
    scope:bi('相同属性、原单位和测试条件的选定观测；最多 300 条。','Selected matching-property, original-unit, same-condition observations; up to 300 rows.'),
    referenceScope:bi('PiDigits 5000 个构造数值的均值与样本标准差；仅检验数值算法。','Mean and sample SD of 5000 constructed PiDigits values; numerical algorithm only.'),
    example:bi('@materials-method-packages 汇总已选来源的均值；未确认独立制样时不要计算标准误，输出 JSON 和报告。','@materials-method-packages Summarize selected values; no standard error without confirmed independent specimens. Write JSON and a report.')},
  {id:'source-linear-fit',backend:'ols-v1',methodId:'linear-fit',name:bi('单变量线性拟合','Single-predictor linear fit'),file:'Norris.dat',refId:'nist-norris',
    url:'https://www.itl.nist.gov/div898/strd/lls/data/LINKS/DATA/Norris.dat',expected:{intercept:-0.262323073774029,slope:1.00211681802045,residualSd:0.884796396144373,rSquared:0.999993745883712},
    scope:bi('3–300 对有证据的观测，X 非常量；保持原单位、材料基准和测试条件。','3–300 evidence-linked pairs with nonconstant X; preserve original units, material basis and conditions.'),
    referenceScope:bi('NIST Norris 的 36 对臭氧仪校准值及四项认证回归统计量；不证明材料模型有效。','36 NIST Norris ozone-monitor calibration pairs and four certified regression statistics; not material-model validity.'),
    example:bi('@materials-method-packages 对已选成对观测进行线性拟合，报告斜率、残差和输入范围，不作范围外预测。','@materials-method-packages Fit selected paired observations; report slope, residuals and training domain without extrapolation.')},
];
const manifests=assets.map(a=>methodPackageSchema.parse({schemaVersion:'ua10-method-v1',id:a.id,version:'1.0.1',name:a.name,
  description:bi('使用现有研究工具分析来源观测，保存方法版本和参考复现回执。','Analyze source observations using existing research tools; retain method version and reference receipt.'),
  scope:[a.scope],limitations:[bi('结论需要科研人员复核。参考复现不代表材料领域验证。','Scientific interpretation requires review. Reference reproduction is not material-domain validation.')],
  sources:[{kind:'data',url:a.url,citation:'NIST/ITL Statistical Reference Datasets, '+a.file+' (accessed 2026-10-06)',revision:hash(readFileSync('methods/references/'+a.file))},
    {kind:'code',url:'https://github.com/materialsx-jlu/MaterialsX',citation:'MaterialsX experiments/math.mjs; independent implementation, not NIST software',revision:hash(readFileSync('experiments/math.mjs'))},
    {kind:'documentation',url:'https://www.itl.nist.gov/div898/strd/general/dataarchive.html',citation:'NIST StRD reference datasets',revision:'accessed-2026-10-06'}],
  licenses:[{component:'paper',status:'not-applicable',identifier:'No paper content bundled',basis:'Reference links only; no paper text copied',url:null},
    {component:'code',status:'reviewed',identifier:'AGPL-3.0',basis:'Team-owned canonical numerical implementation; LICENSE',url:'https://github.com/materialsx-jlu/MaterialsX'},
    {component:'data',status:'reviewed',identifier:'NIST non-SRD data notice',basis:'NIST employee datasets; attribution and AS IS notice preserved in methods/references/NOTICE.txt; numerical benchmark only',url:license},
    {component:'weights',status:'not-applicable',identifier:'No trained weights',basis:'Fixed CPU float64 algorithm; no trained model',url:null}],
  execution:{backend:a.backend,tool:'research_method_run',methodId:a.methodId,inputSchema:hash(canonical(z.toJSONSchema(methodInput,{io:'input'}))),outputSchema:hash(canonical(z.toJSONSchema(methodAnalysisSchema))),
    inputContract:'methods/contracts/research-method-input.schema.json',outputContract:'methods/contracts/research-method-output.schema.json',files:[{path:'experiments/math.mjs',sha256:hash(readFileSync('experiments/math.mjs'))}],dependencyLock:hash(readFileSync('package-lock.json')),runtime:'bundled-node',precision:'float64',maxSamples:300,network:false,gpu:false,memoryMiB:64},
  reference:{id:a.refId,file:a.file,sha256:hash(readFileSync('methods/references/'+a.file)),source:a.url,expected:a.expected,absoluteTolerance:1e-10,relativeTolerance:1e-12,scope:a.referenceScope},
  skill:{name:'materials-method-packages',instructions:bi('先搜索方法包，再读取选定数据和证据，运行 research_methods 筛选及 research_method_run。不得直接执行候选包代码或把复现通过当作领域验证。','Search packages, read selected observations and evidence, assess with research_methods, then run research_method_run. Never execute candidate code or treat reference reproduction as domain validation.'),examples:[a.example]},
}));
writeFileSync('methods/catalog.json',JSON.stringify(manifests,null,2)+'\n');
mkdirSync('methods/contracts',{recursive:true});
writeFileSync('methods/contracts/research-method-input.schema.json',JSON.stringify(z.toJSONSchema(methodInput,{io:'input'}),null,2)+'\n');
writeFileSync('methods/contracts/research-method-output.schema.json',JSON.stringify(z.toJSONSchema(methodAnalysisSchema),null,2)+'\n');
console.log('Pinned '+manifests.length+' application methods; explicit version/source review required for future changes.');
