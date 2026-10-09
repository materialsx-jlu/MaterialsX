import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRelease, isNewer } from './platform-release.js';
import type { PlatformConfiguration } from './platform-configuration.js';

const config:PlatformConfiguration={apiOrigin:'https://api.example.org',websiteOrigin:'https://example.org',releaseChannel:'preview',connection:'online',stale:false,remote:null};
test('release channels compare versions without crossing stable into preview',()=>{
  assert.equal(isNewer('0.3.0-preview.2','0.3.0-preview.1'),true);
  assert.equal(isNewer('0.3.0-preview.2','0.3.0'),false);
  assert.equal(isNewer('0.3.0','0.3.0-preview.2'),true);
});
test('client accepts a bounded same-channel manifest and installer checksum',async()=>{
  const transport=async(input:RequestInfo|URL)=>{
    assert.equal(input,'https://example.org/releases/preview.json');
    return new Response(JSON.stringify({schemaVersion:1,channel:'preview',version:'0.3.0-preview.2',assets:[{name:'MaterialsX-0.3.0-preview.2-mac-arm64.dmg',bytes:10,sha256:'a'.repeat(64)}]}));
  };
  const result=await checkRelease(config,'0.3.0-preview.1','darwin',transport as typeof fetch);
  assert.equal(result.state,'available');assert.equal(result.sha256,'a'.repeat(64));
  assert.equal((await checkRelease({...config,releaseChannel:'stable'},'0.3.0','darwin',transport as typeof fetch)).state,'offline');
  assert.equal((await checkRelease({...config,websiteOrigin:'http://example.org'},'0.3.0-preview.1','darwin',transport as typeof fetch)).state,'offline');
});
