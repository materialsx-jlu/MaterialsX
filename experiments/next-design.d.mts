import type {StudyInput,NextDesignInput,ExperimentFeedback,NextDesignResult} from '../packages/contracts/src/next-experiment.js';
export function feasible(study:StudyInput,point:Record<string,number>):boolean;
export function estimatedCost(study:StudyInput,point:Record<string,number>):number;
export function factorial(study:StudyInput):Array<Record<string,number>>;
export function latinHypercube(study:StudyInput,count:number,seed:number):Array<Record<string,number>>;
export function designNext(study:StudyInput,request:NextDesignInput,feedback?:ExperimentFeedback[]):NextDesignResult;
