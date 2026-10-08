import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexEngine,codexReadOnlyWorkspace} from './codex-engine.js';
import {requestedGrant} from './request-limits.js';
import {harness} from './task-supervisor.fixture.js';
test('explicit no-write and no-terminal requests use read-only Codex without expanding their grant',()=>{
 const base={...harness().context.grant,permissions:['read','search','terminal','patch'] as const};
 for(const text of ['do not write files','不要写文件','do not run commands','不要执行命令']){
  const grant=requestedGrant({...base,permissions:[...base.permissions]},text),permissions=[...grant.permissions];
  const engine=new CodexEngine({home:'/unused-fixture',maxOutput:1,readOnlyWorkspace:codexReadOnlyWorkspace(grant.permissions),invoke:async()=>{throw Error('No requests in policy test');}});
  assert.equal(codexReadOnlyWorkspace(grant.permissions),true);assert.deepEqual(grant.permissions,permissions);
  for(const name of ['exec_command','apply_patch','write_stdin'])assert(!engine.capabilities.tools.has(name));
 }
 assert.equal(codexReadOnlyWorkspace(base.permissions),false);assert.equal(codexReadOnlyWorkspace(base.permissions,true),true);
});
