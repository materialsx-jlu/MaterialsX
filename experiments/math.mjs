/** Fixed, bounded numeric methods. No package installation, fitted energy offsets or arbitrary user scripts. */
export function mean(values){
  if(!values.length||values.some(v=>!Number.isFinite(v)))throw Error('INVALID_NUMERIC_SERIES');
  // Incremental mean avoids overflow from summing large finite source values.
  let m=0;for(const [i,v]of values.entries())m+= (v-m)/(i+1);
  if(!Number.isFinite(m))throw Error('NUMERICAL_RANGE');return m;
}
export function describe(values,independent){
  const average=mean(values),n=values.length;
  const variance=n>1&&independent?values.reduce((sum,v)=>sum+(v-average)**2,0)/(n-1):null;
  if(variance!==null&&!Number.isFinite(variance))throw Error('NUMERICAL_RANGE');
  return {reportedRows:n,mean:average,min:Math.min(...values),max:Math.max(...values),
    independentReplicates:independent?n:null,sampleSd:variance===null?null:Math.sqrt(variance),
    standardError:variance===null?null:Math.sqrt(variance/n),confidenceInterval:null};
}
export function fitLine(points){
  if(points.length<3)throw Error('FIT_REQUIRES_THREE_POINTS');
  const xMean=mean(points.map(p=>p.x)),yMean=mean(points.map(p=>p.y));
  let xx=0,xy=0;for(const p of points){xx+=(p.x-xMean)**2;xy+=(p.x-xMean)*(p.y-yMean);}
  if(!(xx>0)||!Number.isFinite(xx)||!Number.isFinite(xy))throw Error('DEGENERATE_X_OR_NUMERICAL_RANGE');
  const slope=xy/xx,intercept=yMean-slope*xMean,predict=(x)=>yMean+slope*(x-xMean);
  const residuals=points.map(p=>p.y-predict(p.x)),sse=residuals.reduce((sum,v)=>sum+v*v,0),
    total=points.reduce((sum,p)=>sum+(p.y-yMean)**2,0);
  if([slope,intercept,sse,total].some(n=>!Number.isFinite(n)))throw Error('NUMERICAL_RANGE');
  return {slope,intercept,xMean,yMean,residualSd:Math.sqrt(sse/(points.length-2)),rSquared:total>0?1-sse/total:null,
    trainingDomain:{min:Math.min(...points.map(p=>p.x)),max:Math.max(...points.map(p=>p.x))},predict};
}
export function errorMetrics(actual,predicted){
  if(!actual.length||actual.length!==predicted.length||[...actual,...predicted].some(v=>!Number.isFinite(v)))throw Error('METRIC_INPUT_INVALID');
  const errors=actual.map((v,i)=>predicted[i]-v),mae=mean(errors.map(Math.abs)),rmse=Math.sqrt(mean(errors.map(v=>v*v)));
  if(!Number.isFinite(rmse))throw Error('NUMERICAL_RANGE');return {rows:actual.length,mae,rmse};
}
