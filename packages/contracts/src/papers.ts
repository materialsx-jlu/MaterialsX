import {z} from 'zod';
export const arxivIdentity=z.string().regex(/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})v[1-9]\d*$/);
const registeredPaperId=z.string().max(150).regex(/^arxiv:(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})v[1-9]\d*$/, 'Use the exact versioned paperId returned by paper_search or paper_get, including arxiv: and vN.').describe('Exact registered paperId from the tool receipt. Preserve the arxiv: prefix and vN version suffix. Do not use arxivId or a URL.');
export const paperSchema=z.strictObject({
  schemaVersion:z.literal('paper-v1'),paperId:z.string().regex(/^arxiv:/),arxivId:arxivIdentity,
  titleOriginal:z.string().min(1).max(4000),abstractOriginal:z.string().max(30000),authors:z.array(z.string().max(500)).max(500),
  categories:z.array(z.string()).max(100),publishedAt:z.string(),updatedAt:z.string(),doi:z.string().nullable(),journalRef:z.string().nullable(),
  abstractUrl:z.string().url(),pdfUrl:z.string().url(),retrievedAt:z.string(),metadataSha256:z.string().regex(/^[a-f0-9]{64}$/),
  license:z.literal('unknown'),peerReview:z.literal('not-verified'),
  crossref:z.strictObject({doi:z.string(),title:z.string(),publisher:z.string(),retrievedAt:z.string(),sha256:z.string()}).nullable(),
});
export type Paper=z.infer<typeof paperSchema>;
export const paperSearchSchema=z.strictObject({query:z.string().trim().min(1).max(160),
  queryEnglish:z.string().trim().min(1).max(160).optional(),source:z.enum(['local-first','arxiv']).default('local-first'),
  category:z.string().regex(/^[a-z-]+(?:\.[A-Za-z-]+)?$/).optional(),author:z.string().max(100).optional(),
  from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reviewScope:z.enum(['verified','include-unreviewed']).default('verified'),
  sort:z.enum(['relevance','submitted','updated']).default('submitted'),page:z.number().int().min(0).max(20).default(0),
  limit:z.number().int().min(1).max(50).default(10),refresh:z.boolean().default(false),
  publicQueryConfirmed:z.literal(true).describe('Only public scientific keywords may leave the machine. No private recipe, filenames, personal data or credentials.'),
}).superRefine((q,c)=>{for(const key of ['from','to'] as const)if(q[key]&&(!Number.isFinite(Date.parse(q[key]!))||new Date(q[key]!).toISOString().slice(0,10)!==q[key]))c.addIssue({code:'custom',message:'Invalid calendar date'});if(q.from&&q.to&&q.from>q.to)c.addIssue({code:'custom',message:'Date range reversed'});});
export type PaperSearchInput=z.input<typeof paperSearchSchema>;
export interface PaperSearchResult {
  queryId:string;provider:'arxiv'|'project'|'moos';queryOriginal:string;queryExecuted:string;
  filters:Record<string,unknown>;fetchedAt:string;cacheAsOf:string|null;stale:boolean;
  totalProviderMatches:number|null;nextPage:number|null;items:Paper[];localSources:unknown[];limitation:string|null;
}
export const paperGetSchema=z.strictObject({paperId:z.string().max(150),crossref:z.boolean().default(false)});
export const paperFetchSchema=z.strictObject({paperId:registeredPaperId,grant:z.literal('personal-research'),maxBytes:z.number().int().min(1024).max(50*1024*1024).default(30*1024*1024)});
export const paperReadSchema=z.strictObject({paperId:registeredPaperId,fromPage:z.number().int().positive().default(1),toPage:z.number().int().positive().optional()});
export const paperExportSchema=z.strictObject({paperIds:z.array(registeredPaperId).min(1).max(50),format:z.enum(['json','bibtex','csv','markdown'])});
export interface PaperFile {path:string;sha256:string;bytes:number;version:string;downloadedAt:string;grant:'personal-research';redistribution:false}
export interface PaperPage {page:number;text:string;sha256:string}
export interface PaperReading {paperId:string;pdfSha256:string;totalPages:number;pages:PaperPage[];missingPages:number[];readPages:number[];pageReceipts:Array<{page:number;sha256:string;readAt:string}>;status:'partially_read'|'fully_read';modality:'page-text';imagesReviewed:false;readAt:string}
export interface PaperRecord {paper:Paper;file:PaperFile|null;reading:PaperReading|null;status:'metadata_only'|'downloaded'|'partially_read'|'fully_read'}
export interface PaperAPI {
  cancelPaperOperations(projectId:string):Promise<void>;
  listPapers(projectId:string):Promise<PaperRecord[]>;
  searchPapers(projectId:string,input:PaperSearchInput):Promise<PaperSearchResult>;
  getPaper(projectId:string,input:z.input<typeof paperGetSchema>):Promise<Paper>;
  fetchPaper(projectId:string,input:z.input<typeof paperFetchSchema>):Promise<PaperRecord>;
  readPaper(projectId:string,input:z.input<typeof paperReadSchema>):Promise<PaperReading>;
  exportPapers(projectId:string,input:z.input<typeof paperExportSchema>):Promise<{path:string;sha256:string;bytes:number}>;
  officialDocument(projectId:string,input:{source:'arxiv-api'|'arxiv-policy'|'crossref-api'|'python-docs';query:string}):Promise<unknown>;
  managedEnvironment(action:'check'|'repair'):Promise<EnvironmentReceipt>;
}
export interface EnvironmentReceipt {status:'ready'|'unavailable'|'repaired'|'rolled-back';python:string;lockSha256:string|null;versions:Record<string,string>;detail:string;at:string}
