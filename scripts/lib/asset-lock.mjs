/**
 * Minimal, self-contained Dash Core type-8 asset lock builder.
 *
 * Builds and signs a raw transaction (version 3, type 8) with an Asset Lock
 * Special Transaction Payload crediting credits to `creditPubKeyHash`, spending
 * P2PKH outputs of the funding key — the exact shape Core and the Dash Bridge
 * client produce. No external dependencies except @noble/curves for signing.
 *
 * References (Dash Core):
 *   src/primitives/transaction.h/cpp — CTransaction serialization:
 *     nVersion | nType << 16 (u32le of (version | (type << 16))), compactSize(vin),
 *     per-input (outpoint + compactSize(scriptSig) + scriptSig + sequence u32le),
 *     compactSize(vout), per-output (value i64le + compactSize(script) + script),
 *     lockTime u32le, compactSize(payloadLen) + payload.
 *   src/evo/assetlocktx.h — CAssetLockPayload: u8 version(1) + compactSize(creditOutputs)
 *     + per output (value i64le + compactSize(script) + script).
 *   src/evo/assetlocktx.cpp — CheckAssetLockTx.
 */
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import bs58check from 'bs58check';

export const VERSION_SPECIAL = 3;
export const TYPE_ASSET_LOCK = 8;
export const SIGHASH_ALL = 1;
export const FEE_PER_BYTE = 1n;
const DUST_DUFFS = 546n;
const INPUT_BYTES = 148;
const TESTNET_P2PKH_VERSION = 0x8c;

const concatBytes = (...parts) => {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const i64le = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const varuint = (n) => {
  if (n < 253) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([253, n & 0xff, (n >> 8) & 0xff]);
  if (n <= 0xffffffff) {
    const b = new Uint8Array(5); b[0] = 254; new DataView(b.buffer).setUint32(1, n >>> 0, true); return b;
  }
  const b = new Uint8Array(9); b[0] = 255; new DataView(b.buffer).setBigUint64(1, BigInt(n), true); return b;
};
const reversed = (hex) => { const b = Buffer.from(hex, 'hex'); b.reverse(); return new Uint8Array(b); };
const sha256 = (b) => createHash('sha256').update(b).digest();
const sha256d = (b) => createHash('sha256').update(sha256(b)).digest();
const hash160 = (b) => createHash('ripemd160').update(sha256(b)).digest();

export const p2pkhScript = (hash160Bytes) => concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), hash160Bytes, Uint8Array.of(0x88, 0xac));
export const BURN_SCRIPT = Uint8Array.of(0x6a, 0x00);

export const publicKeyOf = (privateKey) => new Uint8Array(secp256k1.getPublicKey(privateKey, true));

export function txidFromRaw(raw) {
  const hash = createHash('sha256').update(createHash('sha256').update(raw).digest()).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

export function assetLockPayload(creditOutputs) {
  const parts = [Uint8Array.of(1), varuint(creditOutputs.length)];
  for (const o of creditOutputs) parts.push(i64le(o.value), varuint(o.script.length), o.script);
  return concatBytes(...parts);
}

function serialize(tx) {
  const parts = [u32le((tx.version | (tx.type << 16)) >>> 0), varuint(tx.inputs.length)];
  for (const i of tx.inputs) {
    parts.push(reversed(i.txid), u32le(i.vout), varuint(i.scriptSig.length), i.scriptSig, u32le(i.sequence));
  }
  parts.push(varuint(tx.outputs.length));
  for (const o of tx.outputs) parts.push(i64le(o.value), varuint(o.script.length), o.script);
  parts.push(u32le(tx.lockTime));
  if (tx.extraPayload) parts.push(varuint(tx.extraPayload.length), tx.extraPayload);
  return concatBytes(...parts);
}

const push = (data) => {
  if (data.length > 75) throw new Error('push too long');
  return concatBytes(Uint8Array.of(data.length), data);
};

function signAll(tx, privateKey) {
  const pub = publicKeyOf(privateKey);
  const scriptCode = p2pkhScript(hash160(pub));
  const sigs = tx.inputs.map((_, idx) => {
    const copy = {
      ...tx,
      inputs: tx.inputs.map((x, j) => ({ ...x, scriptSig: j === idx ? scriptCode : new Uint8Array(0) })),
    };
    const digest = sha256d(concatBytes(serialize(copy), u32le(SIGHASH_ALL)));
    const der = secp256k1.sign(digest, privateKey, { prehash: false, format: 'der', lowS: true });
    return concatBytes(push(concatBytes(der, Uint8Array.of(SIGHASH_ALL))), push(pub));
  });
  return serialize({ ...tx, inputs: tx.inputs.map((x, j) => ({ ...x, scriptSig: sigs[j] })) });
}

const estimateSize = (inputs, outputScripts, payloadBytes) =>
  10 + inputs * INPUT_BYTES + outputScripts.reduce((a, s) => a + 9 + s, 0) + (payloadBytes ? varuint(payloadBytes).length + payloadBytes : 0);

export function estimateFirmSize(inputs, payloadLen) {
  const scriptLen = BURN_SCRIPT.length;
  return estimateSize(inputs, [scriptLen], payloadLen);
}

/**
 * Builds an asset lock spending all `utxos` (P2PKH to `fundingKey`), burning
 * `lockDuffs` less the fee and crediting the lock to `creditPubKeyHash`.
 * The lock amount defaults to the total minus the fee. Returns the raw signed
 * transaction, its txid, and where the credit/burn outputs live.
 */
export function buildAssetLock({ utxos, fundingKey, creditPubKeyHash, lockDuffs, feePerByte = FEE_PER_BYTE, change, minLockDuffs }) {
  if (!utxos.length) throw new Error('no funds to lock');
  if (utxos.length > 100) throw new Error('an asset lock may spend at most 100 payments');
  const total = utxos.reduce((a, u) => a + u.value, 0n);
  const credit = p2pkhScript(creditPubKeyHash);
  const payload = assetLockPayload([{ value: 0n, script: credit }]);
  const payloadLen = payload.length;
  const extraScripts = [BURN_SCRIPT.length, ...(change ? [change.script.length] : [])];
  const fee = BigInt(estimateSize(utxos.length, extraScripts, payloadLen)) * feePerByte;
  const lock = lockDuffs ?? total - fee;
  const changeDuffs = change?.duffs ?? 0n;
  if (lock <= 0n) throw new Error(`not enough funds: ${total} duffs cannot cover the lock`);
  if (change && total - lock - changeDuffs !== fee) throw new Error('change output and lock mismatch');
  if (minLockDuffs !== undefined && lock < minLockDuffs) throw new Error(`the lock would be ${lock} duffs; Platform needs at least ${minLockDuffs}`);
  const leftover = total - lock - changeDuffs - fee;
  if (leftover !== 0n) throw new Error(`lock leaves ${leftover} duffs unspent and no change output`);
  const outputs = [];
  if (change) outputs.push({ value: changeDuffs, script: change.script });
  outputs.push({ value: lock, script: BURN_SCRIPT });
  const raw = signAll(
    {
      version: VERSION_SPECIAL,
      type: TYPE_ASSET_LOCK,
      inputs: utxos.map((u) => ({ txid: u.txid, vout: u.vout, scriptSig: new Uint8Array(0), sequence: 0xffffffff })),
      outputs,
      lockTime: 0,
      extraPayload: assetLockPayload([{ value: lock, script: credit }]),
    },
    fundingKey,
  );
  return { raw, txid: txidFromRaw(raw), lockDuffs: lock, feeDuffs: fee, burnVout: outputs.length - 1, creditIndex: 0 };
}

/** Testnet P2PKH address (version 0x8c) for a 33-byte compressed public key (hex). */
export function addressForPublicKeyHex(publicKeyHex) {
  const pub = Buffer.from(publicKeyHex, 'hex');
  if (pub.length !== 33) throw new Error(`expected 33-byte compressed public key, got ${pub.length}`);
  const payload = Buffer.concat([Buffer.from([TESTNET_P2PKH_VERSION]), hash160(pub)]);
  return bs58check.encode(payload);
}
