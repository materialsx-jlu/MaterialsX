import type {analyzeTensile} from '../../../experiments/tensile.mjs';
type Result=ReturnType<typeof analyzeTensile>;
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function tensileMarkdown(result:Result){
  const safe=(s:string)=>s.replaceAll('|','/').replaceAll('\n',' ');
  return ['# 应力—应变分析 / Engineering tensile analysis','',
    '科学状态 / Scientific status: **needs_review**. Production approved: **false**.','',
    '| 试样 / Specimen | 拟合斜率 / Slope (MPa) | 杨氏模量 / Young’s modulus (MPa) | 拟合 R² | 观测峰值 / Observed peak (MPa) |',
    '|---|---:|---:|---:|---:|',...result.curves.map(c=>`| ${safe(c.specimenId)} | ${c.fit.slopeMPa} | ${c.fit.youngsModulusMPa??'未赋值 / Not assigned'} | ${c.fit.rSquared??'N/A'} | ${c.observedPeakStressMPa} |`),
    '', '## 重复试验 / Replicates',`Independent specimens: ${result.statistics.fitSlopeMPa.independentReplicates??'not declared'}.`,
    `Mean fitted slope: ${result.statistics.fitSlopeMPa.mean} MPa; sample SD: ${result.statistics.fitSlopeMPa.sampleSd??'not available'}; SEM: ${result.statistics.fitSlopeMPa.standardError??'not available'}.`,
    '同一试样的曲线点不是独立重复；未声明重复时不生成误差条。 / Curve points are not replicate specimens; no inferred error bars.',
    '',...result.curves.flatMap(c=>[`## ${safe(c.specimenId)}`,`条件 / Conditions: ${safe(c.conditions)}`,
      `应变来源 / Strain source: ${c.strainSource}; area: ${c.areaMm2} mm²; gauge: ${c.gaugeLengthMm??'N/A'} mm.`,
      `拟合区间 / Fit interval: ${c.fitRange.join('–')} (dimensionless); ${c.fit.rows} rows.`,
      `数据身份 / Acquisition: ${c.acquisition}; digitization uncertainty: ${safe(c.digitizationUncertainty??'N/A')}.`,
      ...c.exclusions.map(e=>`- Excluded original row ${e.row}: ${safe(e.reason)}`),...c.warnings.map(w=>'- '+w),'']),
    '## 适用范围 / Limits',...result.limitations.map(l=>'- '+l),'',
    '原始文件保留。input.json 保存解析后的原值、行号与参数；环境及文件散列记录在 environment.json。 / Original files are preserved; input.json retains parsed original values, row IDs and parameters.',
    '复算 / Replay: `node replay.mjs` (Node.js 22+). Writes replay-result.json; compare it to result.json.result.',''].join('\n');
}
export function tensileCsv(result:Result){
  const quoted=(s:string)=>'"'+(/^[=+\-@\t\r]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';
  return 'specimen,original_row,strain_dimensionless,stress_MPa,in_fit\n'+result.curves.flatMap(c=>c.points.map(p=>
    [quoted(c.specimenId),p.row,p.strain,p.stress,p.inFit].join(','))).join('\n')+'\n';
}
export function tensileSvg(result:Result){
  const points=result.curves.flatMap(c=>c.points),maxX=points.reduce((m,p)=>Math.max(m,p.strain),1e-12),maxY=points.reduce((m,p)=>Math.max(m,p.stress),1e-12),
    x=(n:number)=>64+n/maxX*690,y=(n:number)=>380-n/maxY*320,colors=['#4169a1','#21816a','#a06426','#9352ad'];
  // Sample only for display; every point remains in JSON/CSV and numerical calculations.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 440" role="img"><title>Engineering stress–strain; fit intervals highlighted</title><rect width="820" height="440" fill="#fafbfc"/><path d="M64 60V380H754" fill="none" stroke="#8c96a2"/><text x="320" y="428" font-size="14">Strain (dimensionless)</text><text x="20" y="32" font-size="14">Stress (MPa)</text><text x="64" y="404" font-size="12">0</text><text x="700" y="404" font-size="12">${maxX.toPrecision(4)}</text><text x="20" y="62" font-size="12">${maxY.toPrecision(4)}</text>${result.curves.map((c,i)=>{
    const color=colors[i%colors.length],stride=Math.max(1,Math.ceil(c.points.length/1500)),display=c.points.filter((_,j)=>j%stride===0||j===c.points.length-1);
    const inFit=c.points.filter(p=>p.inFit),a=inFit[0]!,b=inFit.at(-1)!;
    return `<polyline points="${display.map(p=>`${x(p.strain)},${y(p.stress)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"/><line x1="${x(a.strain)}" x2="${x(b.strain)}" y1="${y(c.fit.interceptMPa+c.fit.slopeMPa*a.strain)}" y2="${y(c.fit.interceptMPa+c.fit.slopeMPa*b.strain)}" stroke="${color}" stroke-width="4" stroke-dasharray="7 4"/><text x="${80+(i%4)*175}" y="${20+Math.floor(i/4)*17}" fill="${color}" font-size="12">${escape(c.specimenId.slice(0,22))}</text>`;
  }).join('')}</svg>`;
}
