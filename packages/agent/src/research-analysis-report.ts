import type {MethodAnalysis,MethodAssessment} from '../../contracts/src/research-methods.js';
import type {QualityReport} from '../../contracts/src/scientific-quality.js';
const cell=(v:unknown)=>String(v??'未确认 / Not confirmed').replaceAll('|','\\|').replace(/[\r\n]/g,' ');
const table=(headers:string[],rows:unknown[][])=>'| '+headers.join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |\n'+rows.map(r=>'| '+r.map(cell).join(' | ')+' |').join('\n')+'\n';
const sourceTable=(inputs:Array<{id:string;sha256:string;version:string}>)=>table(['输入 / Input','版本 / Version','SHA256'],inputs.map(s=>[s.id,s.version,s.sha256]));
/** Conversation result from the fixed backend, never a model's reconstruction of its numbers. */
export function analysisSummary(record:MethodAnalysis,locale:'zh'|'en'){
  if(record.status==='stale'||!record.artifacts.length)return '';
  const zh=locale==='zh',r=record.result,unit=r.unit??r.yUnit??'';
  const metrics=record.methodId==='descriptive-summary'?[[zh?'均值':'Mean',r.mean,unit],[zh?'观测数':'Source rows',r.reportedRows,''],[zh?'最小值':'Minimum',r.min,unit],[zh?'最大值':'Maximum',r.max,unit]]:
    [[zh?'斜率':'Slope',r.slope,r.slopeUnit],[zh?'截距':'Intercept',r.intercept,unit],[zh?'训练拟合 R²':'Training R²',r.rSquared,'']];
  const points=Array.isArray(r.points)?r.points.slice(0,12):[];
  return '\n\n'+(zh?'实际计算结果（固定分析工具）':'Actual computation (fixed analysis tool)')+'\n\n'+
    table(zh?['指标','数值','原单位']:['Metric','Value','Original unit'],metrics)+'\n'+
    table(zh?['样本','原值','原单位','来源观测']:['Sample','Source value','Original unit','Observation'],points.map(p=>[p.id,p.y,p.unit,p.yRef]))+'\n'+
    (zh?'完整原值和来源哈希见分析文件；科学结论待复核。':'Complete values and source hashes are in the analysis files; scientific conclusions require review.');
}
export function qualityMarkdown(report:QualityReport){
  const counts=['pass','warning','blocked'].map(status=>report.checks.filter(c=>c.status===status).length);
  return '# 科学检查 / Scientific checks\n\n'+
    '已核对 '+counts[0]+' 项 · 待复核 '+counts[1]+' 项 · 阻断 '+counts[2]+' 项\n\n'+
    '状态 / Status: '+report.decision+' · needs_review\n\n'+
    '字段和证据回链用于检查来源完整性，不代表自然语言结论、因果关系或材料性能已经验证。\n'+
    'Field and evidence links check provenance, not scientific or causal validity.\n\n'+
    '## 逐项核对 / Itemized checks\n\n'+table(['检查 / Check','结果 / Status','来源字段 / Source fields','依据 / Detail'],
      report.checks.map(c=>[c.code,c.status,c.refs.join(', '),c.detail]))+
    '\n## 来源版本 / Source versions\n\n'+sourceTable(report.inputs)+
    '\n完整结论及回执见同目录 result.json。 / Full claims and receipts are in result.json.\n';
}
export function analysisMarkdown(record:MethodAnalysis,assessment:MethodAssessment){
  const r=record.result,unit=String(r.unit??r.yUnit??''),rows:unknown[][]=[];
  const title=record.methodId==='descriptive-summary'?'原值统计 / Descriptive summary':
    record.methodId==='linear-fit'?'线性拟合 / Linear fit':'分组留出验证 / Grouped holdout validation';
  if(record.methodId==='descriptive-summary'){
    rows.push(['来源观测数 / Source rows',r.reportedRows,''],['原值均值 / Mean',r.mean,unit],['最小值 / Minimum',r.min,unit],['最大值 / Maximum',r.max,unit],
      ['已声明独立重复数 / Declared independent replicates',r.independentReplicates,''],
      ['样本标准差 / Sample SD',r.sampleSd??'未计算 / Not computed',unit],
      ['均值标准误 / SEM',r.standardError??'未计算 / Not computed',unit]);
  }else{
    rows.push(['斜率 / Slope',r.slope,r.slopeUnit],['截距 / Intercept',r.intercept,unit],['训练拟合 R² / Training R²',r.rSquared,''],
      ['训练残差标准差 / Training residual SD',r.residualSd,unit]);
  }
  let body='# '+title+'\n\n科学结论待复核。此分析不提供因果、材料本构或生产用途的认证。\n'+
    'Scientific conclusions require review. This analysis does not certify causal effects, material laws or production use.\n\n'+
    '## 研究问题 / Research question\n\n'+assessment.request.question+'\n\n'+
    '## 选择依据 / Selection reason\n\n'+record.reason+'\n\n'+
    '## 结果 / Results\n\n'+table(['指标 / Metric','数值 / Value','原单位 / Original unit'],rows);
  if(record.methodPackage)body+='\n## 方法版本 / Method version\n\n'+cell(record.methodPackage.id)+' · '+cell(record.methodPackage.version)+'\n\nSHA256: '+cell(record.methodPackage.sha256)+'\n\n参考回执 / Reference receipt: '+cell(record.referenceReceipt)+'\n\n参考复现只检验指定数值案例，不代表材料领域验证。 / Reference reproduction checks the specified numerical case, not material-domain validity.\n';
  if(record.methodId!=='descriptive-summary'){
    const domain=r.trainingDomain as {min:number;max:number};
    body+='\n训练输入范围 / Training input range: '+cell(domain.min)+' — '+cell(domain.max)+' '+cell(r.xUnit)+'\n\n'+
      '斜率不自动称为模量；训练拟合 R² 不等于预测准确性。未输出置信区间或预测区间。\n'+
      'Slope is not automatically a modulus. Training R² is not predictive accuracy. No confidence or prediction interval is supplied.\n';
  }
  if(Array.isArray(r.validation)){
    body+='\n## 留出结果与基线 / Holdout results and baseline\n\n'+table(
      ['分组 / Split','观测数 / Rows','线性 MAE','线性 RMSE','基线 MAE','基线 RMSE','外推点 / Extrapolated rows'],
      r.validation.map((g:any)=>[g.split,g.linear.rows,g.linear.mae,g.linear.rmse,g.baseline.mae,g.baseline.rmse,g.predictions.filter((p:any)=>p.extrapolation).length]))+
      '\n误差单位 / Error unit: '+unit+'\n\n基线仅使用训练集目标均值。验证集和测试集均未参与拟合；外推点需单独复核。\n'+
      'The baseline uses only the training target mean. Validation/test were not used to fit. Review extrapolated points separately.\n';
  }
  const points=r.points as Array<{id:string;x:number|null;y:number;xUnit:string|null;unit:string;yRef:string;split?:string}>;
  body+='\n## 选定原值 / Selected original values\n\n'+table(['样本 / Sample','X','Y','分组 / Split','来源观测 / Observation'],
    points.slice(0,40).map(p=>[p.id,p.x===null?'—':cell(p.x)+' '+cell(p.xUnit),cell(p.y)+' '+p.unit,p.split??'—',p.yRef]))+
    '\n显示 '+Math.min(40,points.length)+' / '+points.length+' 条。全部原值、预测、来源哈希和冻结参数保存在 result.json。\n'+
    'Complete values, predictions, source hashes and frozen parameters are in result.json.\n\n'+
    '## 使用限制 / Limitations\n\n'+record.limitations.map(s=>'- '+s).join('\n')+
    '\n\n## 来源版本 / Source versions\n\n'+sourceTable(assessment.inputHashes)+
    '\nScientific status: needs_review · productionApproved=false\n';
  return body;
}
