import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { internalAddress, privateAddress } from '../deploy/config-schema.mjs';
import { createMoosLinkClient, createMoosLinkServer } from '../deploy/moos-link.mjs';

function credential(name) {
  const path = process.env[name];
  if (!path) throw Error(`MISSING_${name}`);
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const file = fstatSync(fd);
    if (!file.isFile() || file.size > 64 * 1024 || (file.mode & 0o077)) throw Error('unsafe');
    return readFileSync(fd);
  } catch { throw Error(`UNSAFE_${name}`); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function startMoosLink(role = process.argv[2]) {
  if (!['server', 'client'].includes(role)) throw Error('USAGE: moos-link.mjs server|client');
  const ca = credential('MATERIALSX_MOOS_LINK_CA');
  const cert = credential('MATERIALSX_MOOS_LINK_CERT');
  const key = credential('MATERIALSX_MOOS_LINK_KEY');
  let address, service;
  if (role === 'server') {
    const privateBind = process.env.MATERIALSX_MOOS_LINK_LISTEN;
    privateAddress(privateBind);
    const moos = internalAddress(process.env.MATERIALSX_MOOS_LINK_UPSTREAM, 'MATERIALSX_MOOS_LINK_UPSTREAM');
    address = new URL(`https://${privateBind}`);
    service = createMoosLinkServer({ ca, cert, key,
      clientFingerprint: process.env.MATERIALSX_MOOS_LINK_CLIENT_FINGERPRINT,
      upstreamHost: moos.host.replaceAll(/[\[\]]/g, ''), upstreamPort: moos.port });
  } else {
    const local = internalAddress(process.env.MATERIALSX_MOOS_LINK_LOCAL, 'MATERIALSX_MOOS_LINK_LOCAL');
    const remote = process.env.MATERIALSX_MOOS_LINK_REMOTE;
    privateAddress(remote);
    address = new URL(`https://${remote}`);
    service = createMoosLinkClient({ ca, cert, key,
      serverName: process.env.MATERIALSX_MOOS_LINK_SERVER_NAME,
      remoteHost: address.hostname.replaceAll(/[\[\]]/g, ''), remotePort: Number(address.port) });
    address = { hostname: local.host.replaceAll(/[\[\]]/g, ''), port: local.port };
  }
  service.listen(Number(address.port), address.hostname, () => {
    process.stdout.write(`MOOS ${role} link ready\n`);
  });
  return service;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { startMoosLink(); }
  catch (error) { process.stderr.write(`MOOS link startup rejected: ${error.message}\n`); process.exitCode = 1; }
}
