import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPlatformBundle, PlatformConfigurationService } from './platform-configuration.js';

test('installed build uses bundled HTTPS origin and ignores development override', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mx-od1-'));
  await writeFile(join(dir,'materialsx-client.json'),JSON.stringify({schemaVersion:1,apiOrigin:'https://api.materialsx.example',releaseChannel:'preview'}));
  const bundle=await loadPlatformBundle(dir,true,'http://127.0.0.1:8788');
  assert.equal(bundle.apiOrigin,'https://api.materialsx.example');
  assert.equal(bundle.connection,'offline');
});

test('invalid or missing installed origin never falls back to localhost', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mx-od1-'));
  assert.equal((await loadPlatformBundle(dir,true,'http://127.0.0.1:8788')).apiOrigin,null);
  await writeFile(join(dir,'materialsx-client.json'),JSON.stringify({schemaVersion:1,apiOrigin:'http://127.0.0.1:8788',releaseChannel:'stable'}));
  assert.equal((await loadPlatformBundle(dir,true)).apiOrigin,null);
  assert.equal((await loadPlatformBundle(dir,false,'http://127.0.0.1:8788')).apiOrigin,'http://127.0.0.1:8788');
});

test('public metadata is validated and cached as stale while offline', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mx-od1-'));
  const bundle=await loadPlatformBundle(dir,false,'http://127.0.0.1:8788');
  const payload={schemaVersion:1,catalogRevision:'a'.repeat(64),recommendedVersion:null,
    features:{account:true,models:true,research:false,payments:false}};
  const service=new PlatformConfigurationService(bundle,dir,async input=>{
    assert.equal(input,'http://127.0.0.1:8788/v1/client-config');
    return new Response(JSON.stringify(payload),{headers:{ETag:'"'+'b'.repeat(64)+'"'}});
  });
  assert.equal((await service.refresh()).connection,'online');
  const offline=new PlatformConfigurationService(bundle,dir,async()=>{throw Error('offline')});
  await offline.restore();
  const state=await offline.refresh();
  assert.equal(state.connection,'offline');
  assert.equal(state.stale,true);
  assert.equal(state.remote?.catalogRevision,'a'.repeat(64));
});
