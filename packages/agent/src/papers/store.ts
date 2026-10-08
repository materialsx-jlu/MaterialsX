import type {Paper,PaperRecord,PaperSearchResult} from '../../../contracts/src/papers.js';
export interface PaperStore {
  records(projectId:string):PaperRecord[];
  record(projectId:string,paperId:string):PaperRecord|null;
  save(projectId:string,record:PaperRecord):void;
  cached(key:string):PaperSearchResult|null;
  cache(key:string,result:PaperSearchResult):void;
  storageBytes():number;
  downloadBytes():number;
  clearQueries():void;
}
export function metadataRecord(paper:Paper):PaperRecord{return {paper,file:null,reading:null,status:'metadata_only'};}
