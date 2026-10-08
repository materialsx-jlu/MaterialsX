import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const electron = require('electron');
const main = join(root, 'dist/apps/desktop/main/index.js');

function command(program, args, quiet = false) {
  const result = spawnSync(program, args, { stdio: quiet ? 'ignore' : 'inherit' });
  if (result.status !== 0) throw new Error(`${program} failed (${result.status ?? result.error?.message})`);
}

function brandedMacElectron() {
  const source = resolve(dirname(electron), '../..');
  const output = join(root, 'runtime/desktop-dev');
  const destination = join(output, 'MaterialsX.app');
  const stampPath = join(output, 'brand.sha256');
  const logo = join(root, 'assets/brand/materialsx-atom-depth-1024.png');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const fingerprint = createHash('sha256')
    .update(readFileSync(join(source, 'Contents/Info.plist')))
    .update(readFileSync(logo))
    .update(version)
    .update('materialsx-dev-bundle-v1')
    .digest('hex');
  if (existsSync(join(destination, 'Contents/MacOS/MaterialsX')) &&
      existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === fingerprint) {
    return join(destination, 'Contents/MacOS/MaterialsX');
  }

  mkdirSync(output, { recursive: true });
  const temporary = join(output, `MaterialsX-${process.pid}.app`);
  const iconset = join(output, `MaterialsX-${process.pid}.iconset`);
  try {
    // APFS clone keeps the separate development bundle from duplicating Electron's disk blocks.
    command('cp', ['-cR', source, temporary]);
    mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      command('sips', ['-z', String(size), String(size), logo, '--out', join(iconset, `icon_${size}x${size}.png`)], true);
      command('sips', ['-z', String(size * 2), String(size * 2), logo, '--out', join(iconset, `icon_${size}x${size}@2x.png`)], true);
    }
    command('iconutil', ['-c', 'icns', iconset, '-o', join(temporary, 'Contents/Resources/materialsx.icns')]);
    renameSync(join(temporary, 'Contents/MacOS/Electron'), join(temporary, 'Contents/MacOS/MaterialsX'));
    const plist = join(temporary, 'Contents/Info.plist');
    for (const [key, value] of [
      ['CFBundleDisplayName', 'MaterialsX'],
      ['CFBundleName', 'MaterialsX'],
      ['CFBundleExecutable', 'MaterialsX'],
      ['CFBundleIdentifier', 'cn.edu.jlu.materialsx.development'],
      ['CFBundleIconFile', 'materialsx.icns'],
      ['CFBundleShortVersionString', version],
    ]) command('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
    command('codesign', ['--force', '--deep', '--sign', '-', temporary]);
    rmSync(destination, { recursive: true, force: true });
    renameSync(temporary, destination);
    writeFileSync(stampPath, `${fingerprint}\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    rmSync(iconset, { recursive: true, force: true });
  }
  return join(destination, 'Contents/MacOS/MaterialsX');
}

const executable = process.platform === 'darwin' ? brandedMacElectron() : electron;
const child = spawn(executable, process.argv.slice(2).length ? process.argv.slice(2) : [main], {
  stdio: 'inherit',
  env: process.platform === 'darwin' ? { ...process.env, MATERIALSX_DEV_BUNDLE: '1' } : process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
