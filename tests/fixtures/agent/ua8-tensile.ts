import {randomUUID} from 'node:crypto';
import type {ExperimentConfigInput} from '../../../packages/contracts/src/experiments.js';
import type {ExperimentTable} from '../../../experiments/tensile.mjs';
export function tensileFixture(index=0){
  const slope=1000+index*700,intercept=1+index*.3;
  const config:ExperimentConfigInput={datasetId:randomUUID(),expectedRevision:0,specimenId:'synthetic-'+index,mode:'stress-strain',xColumn:'strain',yColumn:'stress',xUnit:'1',yUnit:'MPa',
    areaMm2:10,gaugeLengthMm:50,strainSource:'extensometer',conditions:'Synthetic validation only; 300 K; fixed loading rate; not measured data',acquisition:'measured',digitizationUncertainty:null,elasticRegionConfirmed:true,fitRange:[0,.005],exclusions:[]};
  const table:ExperimentTable={columns:['strain','stress'],sheet:null,rows:Array.from({length:12},(_,i)=>({row:i+2,values:{strain:String(i*.001),stress:String(intercept+slope*i*.001+(i>=7?5*(i-6):0))}}))};
  if(index%4===1){config.xUnit='%';for(const r of table.rows)r.values.strain=String(Number(r.values.strain)*100);}
  if(index%4===2){config.mode='force-displacement';config.xUnit='mm';config.yUnit='kN';config.strainSource='crosshead';for(const r of table.rows){r.values.strain=String(Number(r.values.strain)*50);r.values.stress=String(Number(r.values.stress)*.01);}}
  if(index%4===3){config.yUnit='GPa';for(const r of table.rows)r.values.stress=String(Number(r.values.stress)*.001);}
  return {config,table,inputSha256:String(index%10).repeat(64),expectedSlope:slope,expectedIntercept:intercept};
}
export function fixtureCsv(table:ExperimentTable){return table.columns.join(',')+'\n'+table.rows.map(r=>table.columns.map(c=>r.values[c]).join(',')).join('\n')+'\n';}
