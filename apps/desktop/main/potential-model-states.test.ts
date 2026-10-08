import {test} from 'node:test';
import assert from 'node:assert/strict';
import {singleFlight} from './potential-model-states.js';

test('concurrent status reads share work; subsequent refreshes see new state',async()=>{
 let count=0;
 let resolve!:(n:number)=>void;
 const read=singleFlight(()=>{count++;return new Promise<number>(r=>resolve=r);});
 const first=read(),second=read();
 await Promise.resolve();assert.equal(count,1);resolve(1);
 assert.deepEqual(await Promise.all([first,second]),[1,1]);
 const third=read();await Promise.resolve();assert.equal(count,2);resolve(2);
 assert.equal(await third,2);
});
test('a failed status scan is not cached and can be retried',async()=>{
 let count=0;const read=singleFlight(async()=>{if(++count===1)throw Error('scan failed');return count;});
 await assert.rejects(read(),/scan failed/);assert.equal(await read(),2);
});
