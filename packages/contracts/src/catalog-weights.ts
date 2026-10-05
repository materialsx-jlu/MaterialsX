import {z} from 'zod';
import {catalogId} from './potential-hub.js';
export const catalogWeightRequest=z.strictObject({potentialId:catalogId});
export interface CatalogWeightStatus {
 potentialId:string;state:'absent'|'downloading'|'paused'|'downloaded'|'failed';bytes:number;totalBytes:number|null;
 observedSha256:string|null;expectedSha256:string|null;verifiedAgainstCatalog:boolean;error:string|null;
}
export interface PotentialModelState extends Omit<CatalogWeightStatus,'state'> {
 supported:boolean;managedPackage:boolean;cacheOwned:boolean;runtimeReady:boolean;canDownload:boolean;canImport:boolean;canLoad:boolean;
 state:CatalogWeightStatus['state']|'installed'|'disabled'|'loading'|'ready';
}
