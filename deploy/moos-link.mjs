import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';

const MAX_REQUEST = 128 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const TIMEOUT_MS = 9_000;

export function permittedMoosRoute(method, target) {
  if (typeof target !== 'string' || target.length > 4096 || !target.startsWith('/') ||
      target.startsWith('//') || /[\\#\0]/.test(target)) return false;
  let url;
  try { url = new URL(target, 'http://moos.local'); } catch { return false; }
  if (url.pathname + url.search !== target || /%(?:2f|5c|2e|00)/i.test(url.pathname)) return false;
  const route = url.pathname;
  if (method === 'POST') return ['/api/knowledge/search', '/api/knowledge/compare'].includes(route);
  if (method !== 'GET') return false;
  return /^\/api\/(?:health|knowledge\/(?:phase-zero|indexes\/status|visual\/status|media|simulations))$/.test(route) ||
    /^\/api\/knowledge\/records\/[1-9]\d*$/.test(route) ||
    /^\/api\/knowledge\/evidence\/[^/]+$/.test(route) ||
    /^\/api\/knowledge\/(?:media|simulations)\/[1-9]\d*\/[^/]+(?:\/preview)?$/.test(route);
}

async function boundedBody(stream, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > limit) throw Error('MOOS_LINK_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function responseType(headers) {
  const value = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return value === 'application/json' || value === 'image/jpeg' ? value : null;
}

function reply(res, status, body = '') {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function forward(transport, options, body) {
  return new Promise((resolve, reject) => {
    const upstream = transport.request({ ...options, timeout: TIMEOUT_MS, maxHeaderSize: 8192 }, async response => {
      try {
        const bytes = await boundedBody(response, MAX_RESPONSE);
        resolve({ status: response.statusCode, type: responseType(response.headers), bytes });
      } catch (error) { response.destroy(); reject(error); }
    });
    upstream.on('timeout', () => upstream.destroy(Error('MOOS_LINK_TIMEOUT')));
    upstream.on('error', reject);
    upstream.end(body);
  });
}

function deliver(res, result) {
  if (!result.type) return reply(res, 502, 'MOOS_LINK_UNEXPECTED_CONTENT_TYPE');
  res.writeHead(result.status ?? 502, {
    'content-type': result.type,
    'content-length': result.bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(result.bytes);
}

function processRequest(res, action) {
  Promise.resolve().then(action).then(result => deliver(res, result)).catch(error => {
    reply(res, error?.message === 'MOOS_LINK_BODY_TOO_LARGE' ? 413 : 502, 'MOOS_LINK_UNAVAILABLE');
  });
}

/** MOOS host: only fixed read routes, with mutually authenticated TLS and a pinned client certificate. */
export function createMoosLinkServer({ ca, cert, key, clientFingerprint, upstreamHost = '127.0.0.1', upstreamPort }) {
  if (!/^[0-9a-f]{64}$/i.test(clientFingerprint) || !Number.isInteger(upstreamPort)) throw Error('MOOS_LINK_CONFIG_INVALID');
  const server = https.createServer({ ca, cert, key, requestCert: true, rejectUnauthorized: true,
    maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 12_000 }, (req, res) => {
    const peer = req.socket.getPeerCertificate(true);
    if (!req.socket.authorized || !peer?.raw ||
        new X509Certificate(peer.raw).fingerprint256.replaceAll(':', '').toLowerCase() !== clientFingerprint.toLowerCase())
      return reply(res, 403, 'MOOS_LINK_CLIENT_DENIED');
    if (!permittedMoosRoute(req.method, req.url)) return reply(res, 404, 'MOOS_LINK_ROUTE_DENIED');
    processRequest(res, async () => {
      const body = await boundedBody(req, MAX_REQUEST);
      if (req.method === 'POST') {
        const payload = JSON.parse(body.toString('utf8'));
        if (req.url.startsWith('/api/knowledge/search') && payload?.mode !== 'precise') return { status: 403, type: 'application/json', bytes: Buffer.from('{"error":"precise search required"}') };
      }
      return forward(http, { hostname: upstreamHost, port: upstreamPort, path: req.url, method: req.method,
        headers: { 'content-type': 'application/json', accept: 'application/json, image/jpeg', 'content-length': body.length } }, body);
    });
  });
  return server;
}

/** Team host: loopback listener preserves the existing MOOS MCP adapter contract. */
export function createMoosLinkClient({ ca, cert, key, serverName, remoteHost, remotePort }) {
  if (!serverName || !remoteHost || !Number.isInteger(remotePort)) throw Error('MOOS_LINK_CONFIG_INVALID');
  return http.createServer({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 12_000 }, (req, res) => {
    if (!permittedMoosRoute(req.method, req.url)) return reply(res, 404, 'MOOS_LINK_ROUTE_DENIED');
    processRequest(res, async () => {
      const body = await boundedBody(req, MAX_REQUEST);
      return forward(https, { hostname: remoteHost, port: remotePort, path: req.url, method: req.method,
        ca, cert, key, servername: serverName, rejectUnauthorized: true,
        headers: { 'content-type': 'application/json', accept: 'application/json, image/jpeg', 'content-length': body.length } }, body);
    });
  });
}
