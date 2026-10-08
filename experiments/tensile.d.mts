import type {ExperimentConfigInput} from '../packages/contracts/src/experiments.js';
export interface ExperimentTable {columns:string[];rows:Array<{row:number;values:Record<string,string>}>;sheet:string|null}
export function analyzeTensile(samples:Array<{config:ExperimentConfigInput;table:ExperimentTable;inputSha256:string}>,independentReplicates?:boolean):{
  curves:Array<{specimenId:string;inputSha256:string;conditions:string;acquisition:string;strainSource:string;areaMm2:number;gaugeLengthMm:number|null;digitizationUncertainty:string|null;
    fitRange:[number,number];exclusions:Array<{row:number;reason:string}>;points:Array<{row:number;strain:number;stress:number;inFit:boolean}>;
    fit:{slopeMPa:number;interceptMPa:number;rSquared:number|null;residualSdMPa:number;rows:number;youngsModulusMPa:number|null};observedPeakStressMPa:number;strainAtObservedPeak:number;warnings:string[]}>;
  statistics:{fitSlopeMPa:ReturnType<typeof import('./math.mjs').describe>;observedPeakStressMPa:ReturnType<typeof import('./math.mjs').describe>};
  scientificStatus:string;productionApproved:boolean;limitations:string[]};
