/**
 * Minimal DAPI (grpc-web) client: just what identity provisioning needs.
 *
 * Ports cairn's minimal protobuf encoder and the unary grpc-web call (the same
 * wire shapes), plus node discovery from the quorums service. No dependencies
 * beyond Node 18+ fetch.
 */
import { createHash } from 'node:crypto';

const SERVICE = 'org.dash.platform.dapi.v0.Core';
export const TESTNET_NODE_LIST = 'https://quorums.testnet.networks.dash.org/masternodes';

const concat = (...parts) => {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---- minimal protobuf ----
const te = new TextEncoder();
const td = new TextDecoder();

const varint = (n) => {
  const out = [];
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
  return Uint8Array.from(out);
};
const tag = (f, wire) => varint(f * 8 + wire);

export function encode(fields) {
  const parts = [];
  for (const [f, v, force] of fields) {
    if (v === undefined || v === null) continue;
    if (!force && (v === 0 || v === false)) continue;
    if (typeof v === 'boolean') parts.push(tag(f, 0), varint(v ? 1 : 0));
    else if (typeof v === 'number') parts.push(tag(f, 0), varint(v));
    else {
      const b = typeof v === 'string' ? te.encode(v) : v;
      if (b.length === 0 && !force) continue;
      parts.push(tag(f, 2), varint(b.length), b);
    }
  }
  return concat(...parts);
}

export function decode(buf) {
  const m = new Map();
  let i = 0;
  const readVarint = () => {
    let r = 0, mul = 1, b;
    do {
      if (i >= buf.length) throw new Error('pb: truncated varint');
      b = buf[i++];
      r += (b & 0x7f) * mul; mul *= 128;
    } while (b & 0x80);
    return r;
  };
  const push = (f, v) => { const a = m.get(f); if (a) a.push(v); else m.set(f, [v]); };
  while (i < buf.length) {
    const key = readVarint();
    const f = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) push(f, readVarint());
    else if (wire === 2) {
      const len = readVarint();
      if (i + len > buf.length) throw new Error('pb: truncated field');
      push(f, buf.subarray(i, i + len)); i += len;
    } else if (wire === 5) { push(f, buf.subarray(i, i + 4)); i += 4; }
    else if (wire === 1) { push(f, buf.subarray(i, i + 8)); i += 8; }
    else throw new Error(`pb: unsupported wire type ${wire}`);
  }
  return m;
}
const bytes = (m, f) => { const a = m.get(f); return a ? a[a.length - 1] : undefined; };

// ---- grpc-web framing ----
const HEADERS = { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1', accept: 'application/grpc-web+proto' };
const frame = (msg) => {
  const b = new Uint8Array(5 + msg.length);
  new DataView(b.buffer).setUint32(1, msg.length);
  b.set(msg, 5);
  return b;
};

export class GrpcError extends Error {
  constructor(code, message, extra = {}) { super(message || `grpc status ${code}`); this.name = 'GrpcError'; this.code = code; Object.assign(this, extra); }
}

async function unary(url, body, { timeoutMs = 15000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new GrpcError(4, 'deadline exceeded')), timeoutMs);
  const linkAbort = () => ctrl.abort();
  signal?.addEventListener('abort', linkAbort, { once: true });
  try {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: HEADERS, body: frame(body), signal: ctrl.signal });
    } catch (e) {
      if (e instanceof GrpcError) throw e;
      throw new GrpcError(14, `network error: ${e?.message ?? e}`, { network: true });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new GrpcError(res.status === 429 ? 8 : 14, `HTTP ${res.status}`, { http: res.status });
    }
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const response = concat(...chunks);
    let msg = null, trailers = null;
    let i = 0;
    while (i < response.length) {
      const flags = response[i];
      if (flags & 1) throw new GrpcError(12, 'compressed grpc-web frames are not supported');
      const len = new DataView(response.buffer, response.byteOffset + i + 1).getUint32(0);
      const data = response.subarray(i + 5, i + 5 + len);
      i += 5 + len;
      if (flags & 0x80) trailers = td.decode(data);
      else msg = data;
    }
    const status = /^grpc-status: (\d+)/m.exec(trailers ?? '');
    const code = status ? Number(status[1]) : 0;
    if (code !== 0) {
      const m = /^grpc-message: (.*)$/m.exec(trailers ?? '');
      throw new GrpcError(code, m ? decodeURIComponent(m[1]) : 'grpc error');
    }
    if (!msg) throw new GrpcError(13, 'empty response');
    return msg;
  } catch (e) {
    if (e instanceof GrpcError) throw e;
    if (e?.name === 'AbortError') throw new GrpcError(4, 'aborted');
    throw new GrpcError(14, `network error: ${e?.message ?? e}`, { network: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', linkAbort);
  }
}

const isEndpoint = (s) => typeof s === 'string' && /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?:\d{1,5}$/.test(s) && Number(s.slice(s.lastIndexOf(':') + 1)) <= 65535;

export async function fetchTestnetNodes({ timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(TESTNET_NODE_LIST, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`node list HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body?.data)) throw new Error('node list: unexpected response shape');
    const out = [];
    for (const n of body.data) {
      if (n.status !== 'ENABLED') continue;
      if (n.versionCheck !== undefined && n.versionCheck !== 'success') continue;
      const e = n.addresses?.platform_https?.[0];
      if (isEndpoint(e)) out.push(e);
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export class Dapi {
  constructor(node, { timeoutMs = 15000 } = {}) {
    this.node = node;
    this.base = `https://${node}/${SERVICE}/`;
    this.timeoutMs = timeoutMs;
  }

  /** Submit raw tx bytes. Resolves with the txid the node reports (display order). */
  async broadcastTransaction(raw, { allowHighFees = false, bypassLimits = false } = {}, opts = {}) {
    const msg = decode(await unary(`${this.base}broadcastTransaction`, encode([[1, raw], [2, allowHighFees], [3, bypassLimits]]), { timeoutMs: this.timeoutMs, ...opts }));
    return td.decode(bytes(msg, 1));
  }

  /** What the node claims about a transaction (display-order txid). */
  async getTransaction(txid, opts = {}) {
    const msg = decode(await unary(`${this.base}getTransaction`, encode([[1, txid]]), { timeoutMs: this.timeoutMs, ...opts }));
    return {
      raw: bytes(msg, 1),
      blockHash: bytes(msg, 2)?.toString(),
      height: msg.get(3)?.[0],
      confirmations: msg.get(4)?.[0],
      isInstantLocked: !!msg.get(5)?.[0],
      isChainLocked: !!msg.get(6)?.[0],
    };
  }
}

/** What a node claims about the chain. */
export async function getBlockchainStatus(node, opts = {}) {
  const dapi = new Dapi(node, opts);
  const msg = decode(await unary(`${dapi.base}getBlockchainStatus`, encode([]), { timeoutMs: dapi.timeoutMs, ...opts }));
  const chain = decode(bytes(msg, 5));
  return {
    status: ['NOT_STARTED', 'SYNCING', 'READY', 'ERROR'][msg.get(3)?.[0] ?? 0] ?? 'UNKNOWN',
    syncProgress: msg.get(4)?.[0],
    chain: {
      name: td.decode(bytes(chain, 1) ?? new Uint8Array(0)),
      headersCount: chain.get(2)?.[0],
      blocksCount: chain.get(3)?.[0],
      isSynced: !!chain.get(7)?.[0],
    },
  };
}

/** One broadcast helper that walks a node list, failing over until one answers. */
export async function broadcastRaw(raw, { nodeListUrl = TESTNET_NODE_LIST, maxAttempts = 6, log = () => {} } = {}) {
  const nodes = await fetchTestnetNodes();
  if (!nodes.length) throw new Error('node list returned no usable nodes');
  let lastErr;
  for (let i = 0; i < Math.min(maxAttempts, nodes.length); i++) {
    const node = nodes[i];
    try {
      const dapi = new Dapi(node);
      const txid = await dapi.broadcastTransaction(raw);
      log(`broadcast via ${node}: ${txid}`);
      return { txid, node };
    } catch (e) {
      lastErr = e;
      log(`broadcast via ${node} refused: ${e?.message ?? e}`);
    }
  }
  throw lastErr ?? new Error('all nodes refused the broadcast');
}

/** Poll until the tx shows as mined (height > 0) on the node list. Returns { height, txid }. */
export async function waitForMined(txid, { timeoutMs = 10 * 60 * 1000, intervalMs = 5000, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let nodes = await fetchTestnetNodes();
  while (Date.now() < deadline) {
    for (const node of nodes) {
      try {
        const dapi = new Dapi(node);
        const tx = await dapi.getTransaction(txid);
        if (tx.height > 0) {
          log(`mined at height ${tx.height} (via ${node})`);
          return { txid, height: tx.height, node };
        }
      } catch { /* node slow; try the next one */ }
    }
    if (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`tx ${txid} not mined within ${timeoutMs / 1000}s`);
}

export function hash160(pubBytes) {
  return createHash('ripemd160').update(createHash('sha256').update(pubBytes).digest()).digest();
}
