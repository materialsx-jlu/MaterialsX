import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SqlitePaperStore} from './paper-store.js';
import {parseAtom} from '../../../packages/agent/src/papers/arxiv.js';
import {metadataRecord} from '../../../packages/agent/src/papers/store.js';
test('Paper persistence shares SQLite, enforces project scope, protects registered versions and caps metadata',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO projects VALUES ('p');");
 const store=new SqlitePaperStore(db,4000),paper=parseAtom('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:o="urn:opensearch"><o:totalResults>1</o:totalResults><entry><id>http://arxiv.org/abs/2609.12345v1</id><title>Title</title><summary>Abstract</summary><published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated></entry></feed>').items[0]!;
 store.save('p',metadataRecord(paper));assert.equal(store.records('p').length,1);assert.throws(()=>store.record('other',paper.paperId),/PROJECT/);
 assert.throws(()=>store.save('p',metadataRecord({...paper,metadataSha256:'f'.repeat(64)})),/VERSION/);store.clearQueries();assert.equal(store.records('p').length,1);assert.equal(store.downloadBytes(),0);
 assert.throws(()=>store.save('p',metadataRecord({...paper,paperId:'arxiv:2609.12346v1',abstractOriginal:'a'.repeat(6000)})),/BUDGET/);assert.equal(store.records('p').length,1);
 }finally{db.close();}
});
