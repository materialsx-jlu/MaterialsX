import {researchLimits} from "../../../packages/agent/src/papers/limits.js";
import type {DatabaseSync} from 'node:sqlite';
import type {PaperStore} from '../../../packages/agent/src/papers/store.js';
import {paperSchema,type PaperRecord,type PaperSearchResult} from '../../../packages/contracts/src/papers.js';
/** Literature metadata shares WorkspaceStore's SQLite. Immutable versions and read receipts are protected. */
export class SqlitePaperStore implements PaperStore {
  constructor(private db:DatabaseSync,private limit:number=researchLimits.metadataBytes){}
  private owner(id:string){if(!this.db.prepare('SELECT id FROM projects WHERE id=?').get(id))throw Error('PAPER_PROJECT_NOT_FOUND');}
  private get(key:string){const r=this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);return r?JSON.parse(String(r.value)):null;}
  private put(key:string,value:unknown){const text=JSON.stringify(value);if(Buffer.byteLength(text)>2*1024*1024)throw Error('PAPER_METADATA_ITEM_LIMIT');
    const old=this.db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM app_meta WHERE key=?').get(key);
    if(this.storageBytes()-Number(old?.bytes??0)+Buffer.byteLength(text)>this.limit){this.clearQueries();if(this.storageBytes()-Number(old?.bytes??0)+Buffer.byteLength(text)>this.limit)throw Error('PAPER_METADATA_BUDGET');}
    this.db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,text);
  }
  records(id:string):PaperRecord[]{this.owner(id);return this.db.prepare('SELECT value FROM app_meta WHERE key LIKE ? ORDER BY key').all('paper_record:'+id+':%').map(r=>JSON.parse(String(r.value)));}
  record(id:string,paperId:string):PaperRecord|null {this.owner(id);return this.get('paper_record:'+id+':'+paperId);}
  save(id:string,r:PaperRecord){this.owner(id);paperSchema.parse(r.paper);const old=this.record(id,r.paper.paperId);
    if(old&&old.paper.metadataSha256!==r.paper.metadataSha256)throw Error('PAPER_VERSION_METADATA_CHANGED');this.put('paper_record:'+id+':'+r.paper.paperId,r);}
  cached(key:string):PaperSearchResult|null{return this.get('paper_query:'+key);}
  cache(key:string,r:PaperSearchResult){this.put('paper_query:'+key,r);}
  storageBytes(){return Number(this.db.prepare("SELECT coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM app_meta WHERE substr(key,1,6)='paper_'").get()?.bytes??0);}
  downloadBytes(){return Number(this.db.prepare("SELECT coalesce(sum(json_extract(value,'$.file.bytes')),0) AS bytes FROM app_meta WHERE substr(key,1,13)='paper_record:'").get()?.bytes??0);}
  queryBytes(){return Number(this.db.prepare("SELECT coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM app_meta WHERE substr(key,1,12)='paper_query:'").get()?.bytes??0);}
  clearQueries(){this.db.prepare("DELETE FROM app_meta WHERE substr(key,1,12)='paper_query:'").run();}
}
