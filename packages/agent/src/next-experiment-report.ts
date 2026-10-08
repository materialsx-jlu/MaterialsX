import type {ResearchStudy,NextExperimentDesign} from '../../contracts/src/next-experiment.js';
const csv=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
export function nextExperimentCsv(d:NextExperimentDesign,study:ResearchStudy,schedule:boolean){const keys=study.input.factors.map(f=>f.key),head=schedule?['id','pointId','role','block','replicate','order',...keys,'costCny','minutes']:['id',...keys,'costCny','minutes','prediction','sd','score'];
  const rows=schedule?d.result.schedule:d.result.points;return [head,...rows.map(r=>head.map(k=>k in r?(r as unknown as Record<string,unknown>)[k]:r.factors[k]))].map(row=>row.map(csv).join(',')).join('\n')+'\n';}
export function nextExperimentMarkdown(d:NextExperimentDesign,study:ResearchStudy){const s=study.input,r=d.result;
  return '# 下一轮实验 / Next experiments\n\n'+s.question+'\n\n'+s.materialSystem+' · '+s.response.property+' ('+s.response.unit+') · '+s.response.direction+'\n\n'+
    '状态 / Status: '+r.status+' · 方案 / Method: '+d.request.method+' · seed='+d.request.seed+'\n\n'+
    '## 假设与否定条件 / Hypotheses and falsification\n\n'+s.hypotheses.map(h=>'- '+h.statement+'\n  - 替代解释 / Alternative: '+h.alternative+'\n  - 否定条件 / Falsification: '+h.falsification).join('\n')+'\n\n'+
    '## 执行条件 / Experimental conditions\n\n'+s.experimentalUnit+'\n\n'+s.measurementConditions+'\n\n'+s.manufacturabilityNotes+'\n\n'+
    '独立制备重复 / Independent preparations: '+s.replicates+' per point/block; blocks: '+s.blocks.join(', ')+'\n\n'+
    '估算 / Estimated: '+r.estimatedCostCny.toFixed(2)+' CNY; '+r.estimatedMinutes+' min. '+s.costBasis+'\n\n'+
    '## 候选 / Candidates\n\n| ID | Factors | CNY | Prediction | SD |\n|---|---|---:|---:|---:|\n'+r.points.map(p=>'| '+[p.id,JSON.stringify(p.factors),p.costCny,p.prediction??'—',p.sd??'—'].join(' | ')+' |').join('\n')+'\n\n'+
    '## 验证与基线 / Validation and baselines\n\n'+JSON.stringify(r.optimization,null,2)+'\n\n'+r.baselines.map(b=>'- '+b.method+': '+b.points+'; acquisition/cost='+String(b.meanAcquisitionPerCost)+'; '+b.meaning).join('\n')+'\n\n'+
    '## 待处理 / Actions\n\n'+r.reasons.map(s=>'- '+s).join('\n')+'\n\n'+r.limitations.map(s=>'- '+s).join('\n')+'\n\n'+
    '## 证据与复算 / Evidence and replay\n\nStudy: '+study.id+' / '+study.sha256+'\n\nFeedback: '+d.feedbackHashes.map(h=>h.id+' / '+h.sha256).join('; ')+'\n\n'+
    '来源 / Sources: '+d.sourceHashes.map(h=>h.id+' / '+h.sha256).join('; ')+'\n\n运行 / Run: `node replay.mjs`\n\n'+
    '此文件是实验方案，未执行实体实验。科学结论、可加工性和预测不确定性仍需复核。\nThis is a plan, not an executed physical experiment. Scientific conclusions, manufacturability and predictive uncertainty require review.\n';}
