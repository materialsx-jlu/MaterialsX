export function mean(values:number[]):number;
export function describe(values:number[],independent:boolean):{reportedRows:number;mean:number;min:number;max:number;independentReplicates:number|null;sampleSd:number|null;standardError:number|null;confidenceInterval:null};
export function fitLine(points:Array<{x:number;y:number}>):{slope:number;intercept:number;xMean:number;yMean:number;residualSd:number;rSquared:number|null;trainingDomain:{min:number;max:number};predict:(x:number)=>number};
export function errorMetrics(actual:number[],predicted:number[]):{rows:number;mae:number;rmse:number};
