import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script=resolve('scripts/release/prepare-client-config.mjs');
const development=resolve('deploy/examples/development.yaml');

test('client package config is explicit and identical for platform-neutral builders',()=>{
  const cwd=mkdtempSync(join(tmpdir(),'mx-client-build-'));
  const run=(env)=>spawnSync(process.execPath,[script],{cwd,env:{...process.env,...env},encoding:'utf8'});
  assert.equal(run({MATERIALSX_DEPLOY_MANIFEST:development}).status,0);
  const result=JSON.parse(readFileSync(join(cwd,'runtime/release-build/client/materialsx-client.json'),'utf8'));
  assert.equal(result.apiOrigin,'http://127.0.0.1:8788');
  assert.equal(result.releaseChannel,'development');
  const pkg=JSON.parse(readFileSync(resolve('package.json'),'utf8'));
  assert.ok(pkg.build.extraResources.some(item=>item.to==='materialsx-client.json'));
  for(const target of ['mac','win','linux'])assert.match(pkg.scripts[`package:preview:${target}`],/npm run config:client/);
  assert.notEqual(run({MATERIALSX_DEPLOY_MANIFEST:'',MATERIALSX_RELEASE_CHANNEL:'stable'}).status,0);
});
