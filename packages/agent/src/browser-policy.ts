import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
/** Explicit public HTTPS origins; fixture loopback is injectable only in tests, never a saved product option. */
export function browserUrl(value: string, origins: readonly string[], fixtureOrigin?: string) {
    const u = new URL(value);
    if (u.username || u.password || u.href.length > 2048 || !origins.includes(u.origin))
        throw Error('BROWSER_ORIGIN_NOT_APPROVED');
    if (u.origin === fixtureOrigin && u.protocol === 'http:' && u.hostname === '127.0.0.1')
        return u;
    if (u.protocol !== 'https:' || u.port || isIP(u.hostname) || u.hostname === 'localhost' || !u.hostname.includes('.') || /\.(local|internal|localhost)$/.test(u.hostname))
        throw Error('BROWSER_PUBLIC_HTTPS_REQUIRED');
    return u;
}
export function publicAddress(ip: string) {
    if (isIP(ip) === 4) {
        const [a, b] = ip.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127 || a! >= 224 || a === 198 && [18, 19].includes(b!));
    }
    if (isIP(ip) === 6)
        return /^[23][a-f0-9]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip) && !ip.includes('.');
    return false;
}
export async function verifyBrowserHost(url: URL, fixtureOrigin?: string) {
    if (url.origin === fixtureOrigin)
        return;
    const ips = await lookup(url.hostname, { all: true });
    if (!ips.length || ips.some(i => !publicAddress(i.address)))
        throw Error('BROWSER_PRIVATE_NETWORK_DENIED');
}
export function publicSourceUrl(value: string) { const u = new URL(value); u.search = ''; u.hash = ''; return u.href; }
