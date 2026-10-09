import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed: ${(result.stderr || result.stdout).trim().slice(0, 1000)}`);
  return result.stdout + result.stderr;
}

function developerIdentity() {
  const output = run('security', ['find-identity', '-p', 'codesigning', '-v']);
  if (!/"Developer ID Application: [^"]+"/.test(output))
    throw Error('MAC_DISTRIBUTION_BLOCKED: no Developer ID Application identity in the keychain');
}

function signedApp(app) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const info = run('codesign', ['-dv', '--verbose=4', app]);
  if (!info.includes('Authority=Developer ID Application:') || !/TeamIdentifier=[A-Z0-9]+/.test(info))
    throw Error('MAC_DISTRIBUTION_BLOCKED: app is not signed with Developer ID Application');
}

function inspectDmg(dmg) {
  run('hdiutil', ['verify', dmg]);
  const mount = mkdtempSync(join(tmpdir(), 'mx-dmg-verify-'));
  let attached = false;
  try {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    attached = true;
    const app = join(mount, 'MaterialsX.app');
    signedApp(app);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  } finally {
    if (attached) run('hdiutil', ['detach', mount]);
    rmSync(mount, { recursive: true, force: true });
  }
  run('xcrun', ['stapler', 'validate', dmg]);
}

const action = process.argv[2];
if (action === 'preflight') {
  developerIdentity();
  if (!process.env.MATERIALSX_NOTARY_PROFILE)
    throw Error('MAC_DISTRIBUTION_BLOCKED: MATERIALSX_NOTARY_PROFILE is required');
  run('xcrun', ['notarytool', 'history', '--keychain-profile', process.env.MATERIALSX_NOTARY_PROFILE]);
  console.log('Developer ID and notarization profile are available.');
} else if (action === 'notarize' || action === 'verify') {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version;
  const dmg = resolve(process.argv[3] ?? `release/dist/MaterialsX-${version}-mac-arm64.dmg`);
  if (action === 'notarize') {
    developerIdentity();
    if (!process.env.MATERIALSX_NOTARY_PROFILE) throw Error('MATERIALSX_NOTARY_PROFILE_REQUIRED');
    const result = run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', process.env.MATERIALSX_NOTARY_PROFILE, '--wait']);
    if (!/status:\s*Accepted\b/.test(result)) throw Error('MAC_DISTRIBUTION_BLOCKED: Apple did not accept notarization');
    run('xcrun', ['stapler', 'staple', dmg]);
  }
  inspectDmg(dmg);
  console.log(`Verified signed and notarized macOS installer: ${dmg}`);
} else {
  throw Error('Usage: macos-distribution.mjs preflight|notarize|verify [dmg]');
}
