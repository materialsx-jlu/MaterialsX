/** Fixed engineering tensile analysis. Shared by the desktop and exported replay bundle. */
import {fitLine,describe} from './math.mjs';
export function analyzeTensile(samples,independentReplicates=false){
  if(!Array.isArray(samples)||!samples.length||samples.length>20)throw Error('SAMPLE_LIMIT');
  const ids=new Set(),signatures=new Set(),conditions=new Set();
  const curves=samples.map(({config:c,table,inputSha256})=>{
    if(ids.has(c.specimenId))throw Error('DUPLICATE_SPECIMEN_ID');ids.add(c.specimenId);
    conditions.add(c.conditions.trim());
    if(!table.columns.includes(c.xColumn)||!table.columns.includes(c.yColumn))throw Error('COLUMN_NOT_FOUND');
    if(!(c.areaMm2>0)||!c.conditions.trim()||!(c.fitRange[0]>=0&&c.fitRange[1]>c.fitRange[0]))throw Error('METADATA_OR_RANGE_INVALID');
    if(c.acquisition==='digitized'&&!c.digitizationUncertainty)throw Error('DIGITIZATION_UNCERTAINTY_REQUIRED');
    const force=c.mode==='force-displacement',xFactor={'1':1,'%':.01,mm:1,m:1000}[c.xUnit],
      yFactor=force?{N:1,kN:1000}[c.yUnit]:{Pa:1e-6,MPa:1,GPa:1000}[c.yUnit];
    if(!xFactor||!yFactor||(force&&!(c.gaugeLengthMm>0)))throw Error('UNITS_OR_GAUGE_INVALID');
    const excluded=new Map(c.exclusions.map(e=>[e.row,e.reason]));
    if(excluded.size!==c.exclusions.length||[...excluded.values()].some(v=>!v.trim()))throw Error('EXCLUSION_REASON_REQUIRED');
    for(const row of excluded.keys())if(!table.rows.some(r=>r.row===row))throw Error('EXCLUSION_ROW_NOT_FOUND');
    const points=[];let previous=-Infinity;
    for(const row of table.rows){
      if(excluded.has(row.row))continue;
      const numeric=value=>{const s=String(value??'').trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))throw Error('NON_NUMERIC_ROW:'+row.row);const v=Number(s);if(!Number.isFinite(v))throw Error('NON_FINITE_ROW:'+row.row);return v;};
      const strain=numeric(row.values[c.xColumn])*xFactor/(force?c.gaugeLengthMm:1),
        stress=numeric(row.values[c.yColumn])*yFactor/(force?c.areaMm2:1);
      if(!Number.isFinite(strain)||!Number.isFinite(stress)||strain<0||stress<0)throw Error('NEGATIVE_OR_INVALID_TENSILE_ROW:'+row.row);
      if(strain<previous)throw Error('NON_MONOTONIC_LOADING:'+row.row);previous=strain;
      points.push({row:row.row,strain,stress,inFit:strain>=c.fitRange[0]&&strain<=c.fitRange[1]});
    }
    const fitPoints=points.filter(p=>p.inFit),fit=fitLine(fitPoints.map(p=>({x:p.strain,y:p.stress})));
    const signature=JSON.stringify(points.map(p=>[p.strain.toPrecision(12),p.stress.toPrecision(12)]));
    if(signatures.has(signature))throw Error('DUPLICATE_CURVE_NOT_INDEPENDENT');signatures.add(signature);
    if(!(fit.slope>0))throw Error('NON_POSITIVE_STIFFNESS');
    const peak=points.reduce((best,p)=>p.stress>best.stress?p:best,points[0]);
    const modulusEligible=c.elasticRegionConfirmed&&['extensometer','dic'].includes(c.strainSource)&&c.acquisition==='measured';
    const warnings=['needs_review: fitted slope does not establish a constitutive law or scientific qualification.'];
    if(!modulusEligible)warnings.push('Elastic modulus not assigned: confirm an elastic region and specimen strain measurement on measured data.');
    if(c.strainSource==='crosshead')warnings.push('Crosshead displacement includes system compliance: apparent stiffness only.');
    if(c.acquisition==='digitized')warnings.push('Digitized data; declared digitization uncertainty is retained, not propagated as measured error bars.');
    return {specimenId:c.specimenId,inputSha256,conditions:c.conditions,acquisition:c.acquisition,strainSource:c.strainSource,
      areaMm2:c.areaMm2,gaugeLengthMm:c.gaugeLengthMm,digitizationUncertainty:c.digitizationUncertainty,
      fitRange:c.fitRange,exclusions:c.exclusions,points,fit:{slopeMPa:fit.slope,interceptMPa:fit.intercept,rSquared:fit.rSquared,
        residualSdMPa:fit.residualSd,rows:fitPoints.length,youngsModulusMPa:modulusEligible?fit.slope:null},
      observedPeakStressMPa:peak.stress,strainAtObservedPeak:peak.strain,warnings};
  });
  if(conditions.size!==1)throw Error('INCOMPARABLE_TEST_CONDITIONS');
  if(independentReplicates&&curves.length<2)throw Error('INDEPENDENT_REPLICATES_REQUIRE_TWO_SPECIMENS');
  if(independentReplicates&&curves.some(c=>c.acquisition!=='measured'))throw Error('DIGITIZED_REPLICATES_NOT_MEASURED');
  return {curves,statistics:{fitSlopeMPa:describe(curves.map(c=>c.fit.slopeMPa),independentReplicates),
    observedPeakStressMPa:describe(curves.map(c=>c.observedPeakStressMPa),independentReplicates)},
    scientificStatus:'needs_review',productionApproved:false,
    limitations:['Engineering tensile data only; no automatic zero correction, true stress, yield or fracture identification.',
      'Observed peak applies only to retained rows, not automatically to ultimate tensile strength.',
      'Residual fit scatter is not measurement uncertainty; no confidence intervals or error bars are inferred.']};
}
