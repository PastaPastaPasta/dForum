// src/app-connect/crypto.ts
import * as secp256k12 from "@noble/secp256k1";
import { concatBytes } from "@noble/hashes/utils.js";

// src/key-exchange/yappr-protocol.ts
import bs58 from "bs58";
import * as secp256k1 from "@noble/secp256k1";
import { hkdf } from "@noble/hashes/hkdf.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
var encoder = new TextEncoder();
var NO_HKDF_INFO = new Uint8Array(0);
var YAPPR_KEY_EXCHANGE_VERSION = 1;
var YAPPR_STATE_TRANSITION_VERSION = 1;
var YAPPR_NETWORK_IDS = {
  mainnet: "m",
  testnet: "t",
  devnet: "d"
};
var DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG = {
  label: "Login to Yappr",
  pollIntervalMs: 3e3,
  timeoutMs: 12e4
};
function hash160(data) {
  return ripemd160(sha256(data));
}
function generateYapprEphemeralKeyPair() {
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return { privateKey, publicKey };
}
function deriveYapprSharedSecret(appEphemeralPrivateKey, walletEphemeralPublicKey, info = NO_HKDF_INFO) {
  const sharedPoint = secp256k1.getSharedSecret(appEphemeralPrivateKey, walletEphemeralPublicKey);
  const sharedX = sharedPoint.slice(1, 33);
  try {
    return hkdf(
      sha256,
      sharedX,
      encoder.encode("dash:key-exchange:v1"),
      info,
      32
    );
  } finally {
    sharedX.fill(0);
    sharedPoint.fill(0);
  }
}
async function decryptYapprLoginKey(encryptedPayload, sharedSecret) {
  if (encryptedPayload.length < 60) {
    throw new Error("Encrypted payload too short; must be at least 60 bytes");
  }
  const nonce = encryptedPayload.slice(0, 12);
  const ciphertextWithTag = encryptedPayload.slice(12);
  const key = await crypto.subtle.importKey(
    "raw",
    sharedSecret.buffer.slice(sharedSecret.byteOffset, sharedSecret.byteOffset + sharedSecret.byteLength),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertextWithTag
  );
  const result = new Uint8Array(decrypted);
  if (result.length !== 32) {
    throw new Error(`Invalid decrypted login key length: expected 32, got ${result.length}`);
  }
  return result;
}
function deriveYapprAuthKeyFromLogin(loginKey, identityIdBytes) {
  if (loginKey.length !== 32) {
    throw new Error(`Invalid login key length: expected 32, got ${loginKey.length}`);
  }
  if (identityIdBytes.length !== 32) {
    throw new Error(`Invalid identity ID length: expected 32, got ${identityIdBytes.length}`);
  }
  return hkdf(
    sha256,
    loginKey,
    identityIdBytes,
    encoder.encode("auth"),
    32
  );
}
function deriveYapprEncryptionKeyFromLogin(loginKey, identityIdBytes) {
  if (loginKey.length !== 32) {
    throw new Error(`Invalid login key length: expected 32, got ${loginKey.length}`);
  }
  if (identityIdBytes.length !== 32) {
    throw new Error(`Invalid identity ID length: expected 32, got ${identityIdBytes.length}`);
  }
  return hkdf(
    sha256,
    loginKey,
    identityIdBytes,
    encoder.encode("encryption"),
    32
  );
}
function getYapprPublicKey(privateKey) {
  return secp256k1.getPublicKey(privateKey, true);
}
function clearSensitiveBytes(bytes) {
  bytes.fill(0);
}
function decodeYapprIdentityId(identityIdBase58) {
  const decoded = bs58.decode(identityIdBase58);
  if (decoded.length !== 32) {
    throw new Error(`Invalid identity ID length: expected 32, got ${decoded.length}`);
  }
  return decoded;
}
function decodeYapprContractId(contractIdBase58) {
  const decoded = bs58.decode(contractIdBase58);
  if (decoded.length !== 32) {
    throw new Error(`Invalid contract ID length: expected 32, got ${decoded.length}`);
  }
  return decoded;
}
function serializeYapprKeyExchangeRequest(request) {
  if (request.appEphemeralPubKey.length !== 33) {
    throw new Error(`Invalid ephemeral public key length: expected 33, got ${request.appEphemeralPubKey.length}`);
  }
  if (request.contractId.length !== 32) {
    throw new Error(`Invalid contract ID length: expected 32, got ${request.contractId.length}`);
  }
  const labelBytes = request.label ? encoder.encode(request.label) : new Uint8Array(0);
  if (labelBytes.length > 64) {
    throw new Error(`Label too long: max 64 bytes, got ${labelBytes.length}`);
  }
  const buffer = new Uint8Array(1 + 33 + 32 + 1 + labelBytes.length);
  let offset = 0;
  buffer[offset++] = YAPPR_KEY_EXCHANGE_VERSION;
  buffer.set(request.appEphemeralPubKey, offset);
  offset += 33;
  buffer.set(request.contractId, offset);
  offset += 32;
  buffer[offset++] = labelBytes.length;
  if (labelBytes.length > 0) {
    buffer.set(labelBytes, offset);
  }
  return buffer;
}
function buildYapprKeyExchangeUri(request, network = "testnet") {
  const requestBytes = serializeYapprKeyExchangeRequest(request);
  const requestData = bs58.encode(requestBytes);
  return `dash-key:${requestData}?n=${YAPPR_NETWORK_IDS[network]}&v=${YAPPR_KEY_EXCHANGE_VERSION}`;
}
function parseYapprKeyExchangeUri(uri) {
  try {
    if (!uri.startsWith("dash-key:")) {
      return null;
    }
    const uriWithoutScheme = uri.slice(9);
    const queryStart = uriWithoutScheme.indexOf("?");
    if (queryStart === -1) {
      return null;
    }
    const requestData = uriWithoutScheme.slice(0, queryStart);
    const queryString = uriWithoutScheme.slice(queryStart + 1);
    const params = new URLSearchParams(queryString);
    const networkId = params.get("n");
    const versionStr = params.get("v");
    if (!networkId || !versionStr) {
      return null;
    }
    const version = Number.parseInt(versionStr, 10);
    if (version !== YAPPR_KEY_EXCHANGE_VERSION) {
      return null;
    }
    const network = parseYapprNetworkId(networkId);
    if (!network) {
      return null;
    }
    const requestBytes = bs58.decode(requestData);
    if (requestBytes.length < 67) {
      return null;
    }
    let offset = 0;
    const byteVersion = requestBytes[offset++];
    if (byteVersion !== YAPPR_KEY_EXCHANGE_VERSION) {
      return null;
    }
    const appEphemeralPubKey = requestBytes.slice(offset, offset + 33);
    offset += 33;
    const contractId = requestBytes.slice(offset, offset + 32);
    offset += 32;
    const labelLength = requestBytes[offset++];
    if (labelLength > 64 || offset + labelLength > requestBytes.length) {
      return null;
    }
    let label;
    if (labelLength > 0) {
      label = new TextDecoder().decode(requestBytes.slice(offset, offset + labelLength));
    }
    return {
      request: {
        appEphemeralPubKey,
        contractId,
        label
      },
      network,
      version
    };
  } catch {
    return null;
  }
}
function buildYapprStateTransitionUri(transitionBytes, network = "testnet") {
  return `dash-st:${bs58.encode(transitionBytes)}?n=${YAPPR_NETWORK_IDS[network]}&v=${YAPPR_STATE_TRANSITION_VERSION}`;
}
function parseYapprStateTransitionUri(uri) {
  try {
    if (!uri.startsWith("dash-st:")) {
      return null;
    }
    const uriWithoutScheme = uri.slice(8);
    const queryStart = uriWithoutScheme.indexOf("?");
    if (queryStart === -1) {
      return null;
    }
    const transitionData = uriWithoutScheme.slice(0, queryStart);
    const queryString = uriWithoutScheme.slice(queryStart + 1);
    const params = new URLSearchParams(queryString);
    const networkId = params.get("n");
    const versionStr = params.get("v");
    if (!networkId || !versionStr) {
      return null;
    }
    const version = Number.parseInt(versionStr, 10);
    if (version !== YAPPR_STATE_TRANSITION_VERSION) {
      return null;
    }
    const network = parseYapprNetworkId(networkId);
    if (!network) {
      return null;
    }
    return {
      transitionBytes: bs58.decode(transitionData),
      network,
      version
    };
  } catch {
    return null;
  }
}
async function pollForYapprKeyExchangeResponse(port, contractIdBytes, appEphemeralPubKeyHash, appEphemeralPrivateKey, options = {}) {
  const {
    pollIntervalMs = DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG.pollIntervalMs,
    timeoutMs = DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG.timeoutMs,
    signal,
    onPoll,
    logger
  } = options;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) {
      throw new Error("Cancelled");
    }
    onPoll?.();
    try {
      const response = await port.getResponse(contractIdBytes, appEphemeralPubKeyHash);
      logger?.info("platform-auth: yappr key exchange poll result", {
        hasResponse: !!response,
        ownerId: response?.$ownerId
      });
      if (response) {
        return await decryptYapprKeyExchangeResponse(response, appEphemeralPrivateKey);
      }
    } catch (error) {
      logger?.warn("platform-auth: yappr key exchange poll query failed", error);
    }
    await sleep(pollIntervalMs, signal);
  }
  throw new Error("Timeout waiting for key exchange response");
}
async function decryptYapprKeyExchangeResponse(response, appEphemeralPrivateKey) {
  const sharedSecret = deriveYapprSharedSecret(appEphemeralPrivateKey, response.walletEphemeralPubKey);
  try {
    const loginKey = await decryptYapprLoginKey(response.encryptedPayload, sharedSecret);
    return {
      loginKey,
      keyIndex: response.keyIndex,
      walletEphemeralPubKey: response.walletEphemeralPubKey,
      identityId: response.$ownerId
    };
  } finally {
    clearSensitiveBytes(sharedSecret);
  }
}
function parseYapprNetworkId(networkId) {
  switch (networkId) {
    case "m":
      return "mainnet";
    case "t":
      return "testnet";
    case "d":
      return "devnet";
    default:
      return null;
  }
}
function sleep(ms, signal) {
  return new Promise((resolve, reject2) => {
    if (signal?.aborted) {
      reject2(new Error("Cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject2(new Error("Cancelled"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
  });
}

// src/app-connect/crypto.ts
var APP_CONNECT_HKDF_INFO = "app-connect:v2";
var APP_CONNECT_AAD_PREFIX = "dash:app-connect:v2";
var APP_CONNECT_NONCE_BYTES = 12;
var APP_CONNECT_ENVELOPE_BYTES = APP_CONNECT_NONCE_BYTES + 16;
var APP_CONNECT_SLOT_BYTES = 32;
var APP_CONNECT_MAX_SLOTS = 17;
var encoder2 = new TextEncoder();
var AppConnectPayloadError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "AppConnectPayloadError";
    this.code = code;
  }
};
function appConnectAad(appEphemeralPubKey, ownerId) {
  if (appEphemeralPubKey.length !== 33) throw new Error("app ephemeral public key must be 33 bytes");
  if (ownerId.length !== 32) throw new Error("owner id must be 32 bytes");
  return concatBytes(encoder2.encode(APP_CONNECT_AAD_PREFIX), hash160(appEphemeralPubKey), ownerId);
}
function appConnectSlotCount(payloadLength) {
  const body = payloadLength - APP_CONNECT_ENVELOPE_BYTES;
  if (body <= 0 || body % APP_CONNECT_SLOT_BYTES !== 0) return null;
  const slots = body / APP_CONNECT_SLOT_BYTES;
  return slots <= APP_CONNECT_MAX_SLOTS ? slots : null;
}
function appConnectSessionKey(privateKey, publicKey) {
  return deriveYapprSharedSecret(privateKey, publicKey, encoder2.encode(APP_CONNECT_HKDF_INFO));
}
async function importAesKey(rawKey, usage) {
  const copy = toArrayBuffer(rawKey);
  try {
    return await crypto.subtle.importKey("raw", copy, { name: "AES-GCM" }, false, [usage]);
  } finally {
    new Uint8Array(copy).fill(0);
  }
}
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
async function sealAppConnectPayload(input) {
  const { appEphemeralPubKey, ownerId, slots } = input;
  if (slots.length < 1 || slots.length > APP_CONNECT_MAX_SLOTS) {
    throw new Error(`expected 1 to ${APP_CONNECT_MAX_SLOTS} slots, got ${slots.length}`);
  }
  if (slots.some((slot) => slot.length !== APP_CONNECT_SLOT_BYTES)) {
    throw new Error(`every slot must be ${APP_CONNECT_SLOT_BYTES} bytes`);
  }
  const nonce = input.nonce ?? crypto.getRandomValues(new Uint8Array(APP_CONNECT_NONCE_BYTES));
  if (nonce.length !== APP_CONNECT_NONCE_BYTES) throw new Error(`nonce must be ${APP_CONNECT_NONCE_BYTES} bytes`);
  const walletEphemeralPrivateKey = input.walletEphemeralPrivateKey ?? secp256k12.utils.randomSecretKey();
  const walletEphemeralPubKey = getYapprPublicKey(walletEphemeralPrivateKey);
  const sessionKey = appConnectSessionKey(walletEphemeralPrivateKey, appEphemeralPubKey);
  const plaintextBuffer = new ArrayBuffer(slots.length * APP_CONNECT_SLOT_BYTES);
  const plaintext = new Uint8Array(plaintextBuffer);
  slots.forEach((slot, index) => plaintext.set(slot, index * APP_CONNECT_SLOT_BYTES));
  try {
    const key = await importAesKey(sessionKey, "encrypt");
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(appConnectAad(appEphemeralPubKey, ownerId)) },
      key,
      plaintextBuffer
    ));
    return { walletEphemeralPubKey, encryptedPayload: concatBytes(nonce, sealed) };
  } finally {
    clearSensitiveBytes(sessionKey);
    clearSensitiveBytes(plaintext);
    if (!input.walletEphemeralPrivateKey) clearSensitiveBytes(walletEphemeralPrivateKey);
  }
}
async function openAppConnectPayload(input) {
  const { encryptedPayload } = input;
  const slotCount = appConnectSlotCount(encryptedPayload.length);
  if (slotCount === null) {
    throw new AppConnectPayloadError("framing", `payload of ${encryptedPayload.length} bytes is not 28 + 32n with 1 <= n <= ${APP_CONNECT_MAX_SLOTS}`);
  }
  const appEphemeralPubKey = getYapprPublicKey(input.appEphemeralPrivateKey);
  let sessionKey;
  try {
    sessionKey = appConnectSessionKey(input.appEphemeralPrivateKey, input.walletEphemeralPubKey);
  } catch {
    throw new AppConnectPayloadError("decrypt", "wallet ephemeral public key is not a valid point");
  }
  let plaintext;
  try {
    const key = await importAesKey(sessionKey, "decrypt");
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(encryptedPayload.subarray(0, APP_CONNECT_NONCE_BYTES)),
        additionalData: toArrayBuffer(appConnectAad(appEphemeralPubKey, input.ownerId))
      },
      key,
      toArrayBuffer(encryptedPayload.subarray(APP_CONNECT_NONCE_BYTES))
    ));
  } catch {
    throw new AppConnectPayloadError("decrypt", "payload does not decrypt for this request and owner");
  } finally {
    clearSensitiveBytes(sessionKey);
  }
  const slots = Array.from({ length: slotCount }, (_, index) => plaintext.slice(index * APP_CONNECT_SLOT_BYTES, (index + 1) * APP_CONNECT_SLOT_BYTES));
  clearSensitiveBytes(plaintext);
  return slots;
}

// src/app-connect/errors.ts
var CLASSIFICATIONS = {
  20003: { failure: "key-missing", action: "logout", paid: false },
  20004: { failure: "security-level", action: "handoff", paid: true },
  20006: { failure: "key-disabled", action: "logout", paid: false },
  20007: { failure: "security-level", action: "handoff", paid: false },
  20013: { failure: "bound-key-non-batch", action: "handoff", paid: false },
  20014: { failure: "out-of-bounds", action: "invalidate", paid: true },
  20015: { failure: "allowance-spent", action: "renew", paid: false },
  20016: { failure: "expired", action: "renew", paid: false },
  40208: { failure: "key-disabled", action: "logout", paid: true },
  40218: { failure: "insufficient-allowance", action: "renew", paid: false }
};
function classifyAppConnectError(code) {
  if (code === null || code === void 0) return null;
  return CLASSIFICATIONS[code] ?? null;
}

// src/app-connect/poller.ts
import bs583 from "bs58";
import { sha256 as sha2562 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes as concatBytes2 } from "@noble/hashes/utils.js";

// src/app-connect/request.ts
import bs582 from "bs58";
import * as secp256k13 from "@noble/secp256k1";

// src/app-connect/types.ts
var KeyPurpose = {
  AUTHENTICATION: 0,
  ENCRYPTION: 1,
  DECRYPTION: 2,
  TRANSFER: 3
};
var KeySecurityLevel = {
  MASTER: 0,
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3
};
var KeyType = {
  ECDSA_SECP256K1: 0,
  ECDSA_HASH160: 2
};
function boundsEqual(a, b) {
  switch (a.kind) {
    case "singleContract":
      return b.kind === "singleContract" && a.contractId === b.contractId;
    case "documentType":
      return b.kind === "documentType" && a.contractId === b.contractId && a.documentTypeName === b.documentTypeName;
    case "contractGroup":
      return b.kind === "contractGroup" && a.groupId === b.groupId;
  }
}

// src/app-connect/request.ts
var APP_CONNECT_REQUEST_VERSION = 2;
var APP_CONNECT_MAX_LABEL_BYTES = 64;
var APP_CONNECT_MAX_AUTH_BINDINGS = 4;
var APP_CONNECT_MAX_ENC_BINDINGS = 2;
var APP_CONNECT_MAX_CALLBACK_LENGTH = 512;
var APP_CONNECT_MAX_REQUEST_AGE_MS = 10 * 6e4;
var APP_CONNECT_MAX_REQUEST_SKEW_MS = 2 * 6e4;
var AppConnectTlv = {
  IDENTITY_HINT: 1,
  AUTH_BINDING: 2,
  CONNECTION_ID: 3,
  ENC_BINDING: 4,
  MODE: 5,
  CREATED_AT: 6
};
var BINDING_KIND_TAGS = { singleContract: 0, documentType: 1, contractGroup: 2 };
var AppConnectRequestError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "AppConnectRequestError";
    this.code = code;
  }
};
var encoder3 = new TextEncoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
var DOCUMENT_TYPE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
var LABEL_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
var AUTH_BINDING_FIXED_BYTES = 1 + 1 + 32 + 8 + 8;
var ENC_BINDING_BYTES = 33;
var FIXED_VALUE_BYTES = {
  [AppConnectTlv.IDENTITY_HINT]: 32,
  [AppConnectTlv.CONNECTION_ID]: 16,
  [AppConnectTlv.ENC_BINDING]: ENC_BINDING_BYTES,
  [AppConnectTlv.MODE]: 1,
  [AppConnectTlv.CREATED_AT]: 8
};
var MAX_U64 = (1n << 64n) - 1n;
var KNOWN_TLV_TYPES = new Set(Object.values(AppConnectTlv));
function invalid(message) {
  throw new AppConnectRequestError("invalid", message);
}
function appConnectRequestHash(request) {
  return hash160(request.appEphemeralPubKey);
}
function authBindingBounds(binding) {
  const id = bs582.encode(binding.id);
  switch (binding.kind) {
    case "singleContract":
      return { kind: "singleContract", contractId: id };
    case "documentType":
      return { kind: "documentType", contractId: id, documentTypeName: binding.documentTypeName ?? "" };
    case "contractGroup":
      return { kind: "contractGroup", groupId: id };
  }
}
function encBindingBounds(binding) {
  return { kind: "singleContract", contractId: bs582.encode(binding.contractId) };
}
function validateAppConnectRequest(request) {
  checkPublicKey(request.appEphemeralPubKey);
  checkLength(request.appId, 32, "app id");
  if (encoder3.encode(request.label).length > APP_CONNECT_MAX_LABEL_BYTES) {
    invalid(`label is longer than ${APP_CONNECT_MAX_LABEL_BYTES} bytes`);
  }
  if (LABEL_FORBIDDEN.test(request.label)) invalid("label contains control or bidirectional formatting characters");
  const { authBindings, encBindings } = request;
  if (authBindings.length < 1 || authBindings.length > APP_CONNECT_MAX_AUTH_BINDINGS) {
    invalid(`expected 1 to ${APP_CONNECT_MAX_AUTH_BINDINGS} auth bindings, got ${authBindings.length}`);
  }
  const seenBounds = /* @__PURE__ */ new Set();
  for (const binding of authBindings) {
    checkAuthBinding(binding);
    const key = `${binding.kind}:${bs582.encode(binding.id)}:${binding.documentTypeName ?? ""}`;
    if (seenBounds.has(key)) invalid("duplicate auth binding");
    seenBounds.add(key);
  }
  if (encBindings.length > APP_CONNECT_MAX_ENC_BINDINGS) {
    invalid(`expected at most ${APP_CONNECT_MAX_ENC_BINDINGS} encryption bindings, got ${encBindings.length}`);
  }
  const seenEnc = /* @__PURE__ */ new Set();
  for (const binding of encBindings) {
    checkLength(binding.contractId, 32, "encryption binding contract id");
    if (binding.purpose !== KeyPurpose.ENCRYPTION && binding.purpose !== KeyPurpose.DECRYPTION) {
      invalid(`encryption binding purpose ${binding.purpose} is not ENCRYPTION or DECRYPTION`);
    }
    const key = `${bs582.encode(binding.contractId)}:${binding.purpose}`;
    if (seenEnc.has(key)) invalid("duplicate encryption binding");
    seenEnc.add(key);
  }
  if (!Number.isSafeInteger(request.createdAt) || request.createdAt <= 0) {
    invalid("created-at must be a positive millisecond timestamp");
  }
  if (request.identityHint !== void 0) checkLength(request.identityHint, 32, "identity hint");
  if (request.connectionId !== void 0) checkLength(request.connectionId, 16, "connection id");
  if (request.mode !== void 0 && request.mode !== "renew") {
    invalid(`unknown mode ${String(request.mode)}`);
  }
}
function checkAuthBinding(binding) {
  if (!Object.hasOwn(BINDING_KIND_TAGS, binding.kind)) invalid(`unknown binding kind ${String(binding.kind)}`);
  checkLength(binding.id, 32, "binding id");
  if (binding.kind === "documentType") {
    if (binding.documentTypeName === void 0 || !DOCUMENT_TYPE_NAME.test(binding.documentTypeName)) {
      invalid("a documentType binding needs a document type name of 1-64 [A-Za-z0-9_-]");
    }
  } else if (binding.documentTypeName !== void 0) {
    invalid(`a ${binding.kind} binding carries no document type name`);
  }
  const level = binding.securityLevel;
  const levelAllowed = binding.kind === "contractGroup" ? level === KeySecurityLevel.CRITICAL || level === KeySecurityLevel.HIGH : level === KeySecurityLevel.HIGH;
  if (!levelAllowed) {
    invalid(`security level ${binding.securityLevel} is not allowed on a ${binding.kind} binding`);
  }
  if (binding.totalBudget !== void 0 && (binding.totalBudget <= 0n || binding.totalBudget > MAX_U64)) {
    invalid("total budget must be between 1 and 2^64-1 credits");
  }
  if (binding.kind === "contractGroup" && binding.totalBudget === void 0) {
    invalid("a contractGroup binding must carry a budget");
  }
  if (binding.expiresAt !== void 0 && (!Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= 0)) {
    invalid("expires-at must be a positive millisecond timestamp");
  }
}
function checkLength(bytes, expected, what) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== expected) {
    invalid(`${what} must be ${expected} bytes`);
  }
}
function checkPublicKey(publicKey) {
  checkLength(publicKey, 33, "app ephemeral public key");
  try {
    secp256k13.Point.fromBytes(publicKey);
  } catch {
    invalid("app ephemeral public key is not a compressed secp256k1 point");
  }
}
function encodeAppConnectRequest(request) {
  validateAppConnectRequest(request);
  const out = [APP_CONNECT_REQUEST_VERSION, ...request.appEphemeralPubKey, ...request.appId];
  const label = encoder3.encode(request.label);
  out.push(label.length, ...label);
  const tlv = (type, value) => {
    out.push(type, value.length, ...value);
  };
  if (request.identityHint) tlv(AppConnectTlv.IDENTITY_HINT, request.identityHint);
  for (const binding of request.authBindings) tlv(AppConnectTlv.AUTH_BINDING, encodeAuthBinding(binding));
  if (request.connectionId) tlv(AppConnectTlv.CONNECTION_ID, request.connectionId);
  for (const binding of request.encBindings) {
    tlv(AppConnectTlv.ENC_BINDING, Uint8Array.of(...binding.contractId, binding.purpose));
  }
  if (request.mode === "renew") tlv(AppConnectTlv.MODE, Uint8Array.of(1));
  tlv(AppConnectTlv.CREATED_AT, u64(BigInt(request.createdAt)));
  return Uint8Array.from(out);
}
function encodeAuthBinding(binding) {
  const name = binding.documentTypeName === void 0 ? [] : [...encoder3.encode(binding.documentTypeName)];
  return Uint8Array.from([
    BINDING_KIND_TAGS[binding.kind],
    binding.securityLevel,
    ...binding.id,
    ...u64(binding.totalBudget ?? 0n),
    ...u64(BigInt(binding.expiresAt ?? 0)),
    ...name.length > 0 ? [name.length, ...name] : []
  ]);
}
function u64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value);
  return bytes;
}
function readU64(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset);
}
function readMs(bytes, offset, what) {
  const value = readU64(bytes, offset);
  if (value === 0n) return void 0;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(`${what} is out of range`);
  return Number(value);
}
function decodeAppConnectRequest(bytes) {
  if (bytes.length < 1) invalid("empty request");
  if (bytes[0] !== APP_CONNECT_REQUEST_VERSION) {
    throw new AppConnectRequestError("unsupported", `unsupported request version ${bytes[0]}`);
  }
  if (bytes.length < 1 + 33 + 32 + 1) invalid("request is truncated");
  let offset = 1;
  const appEphemeralPubKey = bytes.slice(offset, offset + 33);
  offset += 33;
  const appId = bytes.slice(offset, offset + 32);
  offset += 32;
  const labelLength = bytes[offset++];
  if (labelLength > APP_CONNECT_MAX_LABEL_BYTES) invalid("label is too long");
  if (offset + labelLength > bytes.length) invalid("request is truncated");
  let label;
  try {
    label = strictDecoder.decode(bytes.subarray(offset, offset + labelLength));
  } catch {
    invalid("label is not valid UTF-8");
  }
  offset += labelLength;
  const request = {
    appEphemeralPubKey,
    appId,
    label,
    authBindings: [],
    encBindings: [],
    createdAt: 0
  };
  let previousType = 0;
  let sawCreatedAt = false;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) invalid("TLV header is truncated");
    const type = bytes[offset];
    const length = bytes[offset + 1];
    offset += 2;
    if (offset + length > bytes.length) invalid(`TLV 0x${hex2(type)} is truncated`);
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    const repeatable = type === AppConnectTlv.AUTH_BINDING || type === AppConnectTlv.ENC_BINDING || type % 2 === 1 && !KNOWN_TLV_TYPES.has(type);
    if (type < previousType || type === previousType && !repeatable) {
      invalid(`TLV 0x${hex2(type)} is out of order or repeated`);
    }
    previousType = type;
    const fixed = FIXED_VALUE_BYTES[type];
    if (fixed !== void 0 && length !== fixed) invalid(`TLV 0x${hex2(type)} must be ${fixed} bytes`);
    switch (type) {
      case AppConnectTlv.IDENTITY_HINT:
        request.identityHint = value.slice();
        break;
      case AppConnectTlv.AUTH_BINDING:
        if (request.authBindings.length === APP_CONNECT_MAX_AUTH_BINDINGS) invalid("too many auth bindings");
        request.authBindings.push(decodeAuthBinding(value));
        break;
      case AppConnectTlv.CONNECTION_ID:
        request.connectionId = value.slice();
        break;
      case AppConnectTlv.ENC_BINDING:
        if (request.encBindings.length === APP_CONNECT_MAX_ENC_BINDINGS) invalid("too many encryption bindings");
        request.encBindings.push({ contractId: value.slice(0, 32), purpose: value[32] });
        break;
      case AppConnectTlv.MODE:
        if (value[0] !== 1) invalid(`unknown mode ${value[0]}`);
        request.mode = "renew";
        break;
      case AppConnectTlv.CREATED_AT:
        request.createdAt = readMs(value, 0, "created-at") ?? invalid("created-at is zero");
        sawCreatedAt = true;
        break;
      default:
        if (type % 2 === 0) {
          throw new AppConnectRequestError("unsupported", `unknown mandatory TLV 0x${hex2(type)}`);
        }
    }
  }
  if (!sawCreatedAt) invalid("request has no created-at");
  validateAppConnectRequest(request);
  return request;
}
function decodeAuthBinding(value) {
  if (value.length < AUTH_BINDING_FIXED_BYTES) invalid("auth binding is truncated");
  const tag = value[0];
  const kind = Object.keys(BINDING_KIND_TAGS).find((k) => BINDING_KIND_TAGS[k] === tag);
  if (kind === void 0) {
    throw new AppConnectRequestError("unsupported", `unknown auth binding kind ${tag}`);
  }
  const binding = {
    kind,
    securityLevel: value[1],
    id: value.slice(2, 34)
  };
  const budget = readU64(value, 34);
  if (budget > 0n) binding.totalBudget = budget;
  const expiresAt = readMs(value, 42, "expires-at");
  if (expiresAt !== void 0) binding.expiresAt = expiresAt;
  const rest = value.subarray(AUTH_BINDING_FIXED_BYTES);
  if (kind === "documentType") {
    if (rest.length < 1 || rest[0] + 1 !== rest.length) invalid("document type name length does not match");
    try {
      binding.documentTypeName = strictDecoder.decode(rest.subarray(1));
    } catch {
      invalid("document type name is not valid UTF-8");
    }
  } else if (rest.length !== 0) {
    invalid(`a ${kind} binding carries trailing bytes`);
  }
  return binding;
}
function hex2(byte) {
  return byte.toString(16).padStart(2, "0");
}
function checkCallbackUrl(callbackUrl) {
  if (callbackUrl.length > APP_CONNECT_MAX_CALLBACK_LENGTH) invalid("callback URL is too long");
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    invalid("callback URL is not a URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    invalid("callback URL must be https without credentials");
  }
}
var BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var BASE64URL_CHARS = /^[A-Za-z0-9_-]*$/;
function base64urlEncode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += BASE64URL_ALPHABET[chunk >> 18 & 63] + BASE64URL_ALPHABET[chunk >> 12 & 63];
    if (i + 1 < bytes.length) out += BASE64URL_ALPHABET[chunk >> 6 & 63];
    if (i + 2 < bytes.length) out += BASE64URL_ALPHABET[chunk & 63];
  }
  return out;
}
function base64urlDecode(text) {
  if (!BASE64URL_CHARS.test(text)) invalid("value is not canonical base64url");
  if (text.length % 4 === 1) invalid("base64url value has an impossible length");
  const out = new Uint8Array(Math.floor(text.length * 3 / 4));
  let outAt = 0;
  for (let i = 0; i < text.length; i += 4) {
    const group = text.slice(i, i + 4);
    let chunk = 0;
    for (let j = 0; j < 4; j++) {
      chunk = chunk << 6 | (j < group.length ? BASE64URL_ALPHABET.indexOf(group[j]) : 0);
    }
    const bytes = Math.floor(group.length * 6 / 8);
    if (bytes < 3 && (chunk & (1 << 24 - bytes * 8) - 1) !== 0) {
      invalid("base64url value has non-zero trailing bits");
    }
    out[outAt++] = chunk >> 16 & 255;
    if (bytes > 1) out[outAt++] = chunk >> 8 & 255;
    if (bytes > 2) out[outAt++] = chunk & 255;
  }
  return out;
}
var APP_CONNECT_MAX_URI_BYTES = 4096;
var APP_CONNECT_MAX_R_LENGTH = 1366;
var APP_CONNECT_MAX_BODY_BYTES = 1024;
function buildAppConnectUri(request, network, callbackUrl, carrier = network === "mainnet" ? "dashpay" : "dash-key") {
  if (carrier === "dash-key" && network === "mainnet") invalid("the dash-key: carrier is not allowed on mainnet");
  const bodyBytes = encodeAppConnectRequest(request);
  let uri;
  if (carrier === "dashpay") {
    if (bodyBytes.length > APP_CONNECT_MAX_BODY_BYTES) invalid("request body is too long");
    uri = `dashpay://connect?v=${APP_CONNECT_REQUEST_VERSION}&n=${YAPPR_NETWORK_IDS[network]}&r=${base64urlEncode(bodyBytes)}`;
  } else {
    uri = `dash-key:${bs582.encode(bodyBytes)}?n=${YAPPR_NETWORK_IDS[network]}&v=${APP_CONNECT_REQUEST_VERSION}`;
  }
  if (callbackUrl !== void 0) {
    checkCallbackUrl(callbackUrl);
    uri += `&cb=${encodeURIComponent(callbackUrl)}`;
  }
  if (carrier === "dashpay" && encoder3.encode(uri).length > APP_CONNECT_MAX_URI_BYTES) invalid("URI is too long");
  return uri;
}
function parseAppConnectUri(uri) {
  if (uri.startsWith("dash-key:")) return parseDashKeyUri(uri);
  if (/^dashpay:/i.test(uri)) return parseDashpayConnectUri(uri);
  return invalid("not an App Connect URI");
}
function parseQuery(query, known) {
  const params = new URLSearchParams(query);
  for (const name of known) {
    if (params.getAll(name).length > 1) invalid(`query parameter ${name} is repeated`);
  }
  return params;
}
function readVersionAndNetwork(params) {
  const version = params.get("v");
  if (version !== String(APP_CONNECT_REQUEST_VERSION)) {
    throw new AppConnectRequestError("unsupported", `unsupported URI version ${version ?? "(none)"}`);
  }
  const networkId = params.get("n");
  const network = Object.keys(YAPPR_NETWORK_IDS).find((name) => YAPPR_NETWORK_IDS[name] === networkId);
  if (network === void 0) invalid(`unknown network ${networkId ?? "(none)"}`);
  return network;
}
function readCallback(params) {
  const callbackUrl = params.get("cb") ?? void 0;
  if (callbackUrl !== void 0) checkCallbackUrl(callbackUrl);
  return callbackUrl;
}
function parseDashKeyUri(uri) {
  const rest = uri.slice("dash-key:".length);
  const queryStart = rest.indexOf("?");
  if (queryStart === -1) invalid("URI has no query");
  const params = parseQuery(rest.slice(queryStart + 1), ["n", "v", "cb"]);
  const network = readVersionAndNetwork(params);
  if (network === "mainnet") invalid("the dash-key: carrier is not accepted on mainnet");
  let requestBytes;
  try {
    requestBytes = bs582.decode(rest.slice(0, queryStart));
  } catch {
    invalid("request is not base58");
  }
  const callbackUrl = readCallback(params);
  return { request: decodeAppConnectRequest(requestBytes), requestBytes, network, callbackUrl };
}
function parseDashpayConnectUri(uri) {
  if (encoder3.encode(uri).length > APP_CONNECT_MAX_URI_BYTES) invalid("URI is too long");
  if (uri.includes("#")) invalid("URI has a fragment");
  const match = /^dashpay:\/\/([^/?#]*)\/?(?:\?([\s\S]*))?$/i.exec(uri);
  if (!match) invalid("not a dashpay://connect URI");
  const [, authority, query] = match;
  if (authority.toLowerCase() !== "connect") invalid("not a dashpay://connect URI");
  if (query === void 0) invalid("URI has no query");
  const params = parseQuery(query, ["n", "v", "r", "cb"]);
  const network = readVersionAndNetwork(params);
  const r = params.get("r");
  if (r === null) invalid("URI has no request");
  if (r.length > APP_CONNECT_MAX_R_LENGTH) invalid("request is too long");
  const requestBytes = base64urlDecode(r);
  if (requestBytes.length > APP_CONNECT_MAX_BODY_BYTES) invalid("request body is too long");
  const callbackUrl = readCallback(params);
  return { request: decodeAppConnectRequest(requestBytes), requestBytes, network, callbackUrl };
}
function checkAppConnectRequestAge(createdAt, now) {
  if (now - createdAt > APP_CONNECT_MAX_REQUEST_AGE_MS) return "stale";
  if (createdAt - now > APP_CONNECT_MAX_REQUEST_SKEW_MS) return "future";
  return null;
}

// src/app-connect/poller.ts
var APP_CONNECT_PAGE_SIZE = 10;
var APP_CONNECT_MAX_CANDIDATES = 20;
var APP_CONNECT_FAST_POLL_MS = 2e3;
var APP_CONNECT_SLOW_POLL_MS = 4e3;
var APP_CONNECT_FAST_POLL_WINDOW_MS = 6e4;
async function listAppConnectCandidates(port, requestHash, options = {}) {
  const { hint, pageSize = APP_CONNECT_PAGE_SIZE, maxCandidates = APP_CONNECT_MAX_CANDIDATES } = options;
  const candidates = [];
  let startAfter;
  for (; ; ) {
    const page = await port.listCandidates(requestHash, hint, startAfter, pageSize);
    for (const candidate of page) {
      if (startAfter !== void 0 && !idAfter(candidate.ownerId, startAfter)) return { candidates, truncated: false };
      startAfter = candidate.ownerId;
      if (hint !== void 0 && candidate.ownerId !== hint) continue;
      if (candidates.length === maxCandidates) return { candidates, truncated: true };
      candidates.push(candidate);
    }
    if (page.length < pageSize) return { candidates, truncated: false };
  }
}
function idAfter(a, b) {
  let left;
  let right;
  try {
    left = bs583.decode(a);
    right = bs583.decode(b);
  } catch {
    return false;
  }
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return left.length > right.length;
}
function appConnectPollDelayMs(elapsedMs) {
  if (elapsedMs >= APP_CONNECT_MAX_REQUEST_AGE_MS) return null;
  return elapsedMs < APP_CONNECT_FAST_POLL_WINDOW_MS ? APP_CONNECT_FAST_POLL_MS : APP_CONNECT_SLOW_POLL_MS;
}
function appConnectCandidateKey(candidate) {
  const contents = concatBytes2(candidate.walletEphemeralPubKey, candidate.encryptedPayload);
  return `${candidate.ownerId}:${bytesToHex(sha2562(contents))}`;
}

// src/app-connect/verify.ts
import bs584 from "bs58";
var APP_CONNECT_EXPIRY_MARGIN_MS = 60 * 6e4;
var Rejection = class {
  constructor(reason, slot) {
    this.reason = reason;
    this.slot = slot;
  }
  reason;
  slot;
};
var RETRYABLE = /* @__PURE__ */ new Set([
  "identity-not-found",
  "key-not-found",
  "budget-unknown",
  "encryption-key-not-current"
]);
async function verifyAppConnectCandidate(input) {
  const { request, candidate } = input;
  if (request.identityHint && candidate.ownerId !== bs584.encode(request.identityHint)) {
    return reject(new Rejection("hint-mismatch"));
  }
  let ownerIdBytes;
  try {
    ownerIdBytes = decodeYapprIdentityId(candidate.ownerId);
  } catch {
    return reject(new Rejection("identity-not-found"));
  }
  let slots;
  try {
    slots = await openAppConnectPayload({
      appEphemeralPrivateKey: input.appEphemeralPrivateKey,
      ownerId: ownerIdBytes,
      walletEphemeralPubKey: candidate.walletEphemeralPubKey,
      encryptedPayload: candidate.encryptedPayload
    });
  } catch (error) {
    return reject(new Rejection(error instanceof AppConnectPayloadError ? error.code : "decrypt"));
  }
  return verifyKeys({ request, ownerId: candidate.ownerId, identity: input.identity, now: input.now, expiryMarginMs: input.expiryMarginMs }, slots);
}
function verifyAppConnectKeys(input) {
  return verifyKeys(input, input.privateKeys);
}
async function verifyKeys(context, slots) {
  try {
    if (slots.length > context.request.authBindings.length + context.request.encBindings.length) {
      throw new Rejection("framing");
    }
    const grant = await verifySlots(context, slots);
    return { ok: true, grant };
  } catch (error) {
    slots.forEach(clearSensitiveBytes);
    if (error instanceof Rejection) return reject(error);
    throw error;
  }
}
function reject(rejection) {
  return { ok: false, reason: rejection.reason, retryable: RETRYABLE.has(rejection.reason), slot: rejection.slot };
}
async function verifySlots(input, slots) {
  const { request, ownerId, identity, now } = input;
  const margin = input.expiryMarginMs ?? APP_CONNECT_EXPIRY_MARGIN_MS;
  const record = await identity.getIdentityFresh(ownerId);
  if (!record || record.id !== ownerId) throw new Rejection("identity-not-found");
  const matches = [];
  for (const [slot, privateKey] of slots.entries()) {
    const key = findKeyForSlot(record.publicKeys, privateKey, slot);
    const match = matchBinding(request, key, slot);
    checkKeyLimits(key, match, request, now, margin, slot);
    if (matches.some((m) => m.key.id === key.id || m.role === match.role && m.bindingIndex === match.bindingIndex)) {
      throw new Rejection("duplicate-binding", slot);
    }
    matches.push({ slot, privateKey, key, ...match });
  }
  if (!matches.some((m) => isAuthRole(m.role) && m.bindingIndex === 0)) {
    throw new Rejection("primary-missing");
  }
  for (const match of matches.filter((m) => !isAuthRole(m.role))) {
    const binding = request.encBindings[match.bindingIndex];
    const current = await identity.contractKeys(ownerId, bs584.encode(binding.contractId), binding.purpose);
    if (!current.some((key) => key.id === match.key.id && bytesEqual(key.data, match.key.data))) {
      throw new Rejection("encryption-key-not-current", match.slot);
    }
  }
  const budgeted = matches.filter((m) => m.key.totalBudget !== void 0);
  const remaining = budgeted.length > 0 ? await identity.remainingBudgets(ownerId, budgeted.map((m) => m.key.id)) : /* @__PURE__ */ new Map();
  for (const match of budgeted) {
    const left = remaining.get(match.key.id);
    if (left === void 0) throw new Rejection("budget-unknown", match.slot);
    if (left <= 0n) throw new Rejection("budget-exhausted", match.slot);
  }
  const granted = matches.map((m) => ({
    role: m.role,
    bindingIndex: m.bindingIndex,
    privateKey: m.privateKey,
    key: m.key,
    remainingBudget: remaining.get(m.key.id)
  }));
  return {
    identityId: ownerId,
    authKeys: granted.filter((g) => isAuthRole(g.role)),
    encryptionKeys: granted.filter((g) => !isAuthRole(g.role))
  };
}
function isAuthRole(role) {
  return role !== "encryption" && role !== "decryption";
}
function findKeyForSlot(keys, privateKey, slot) {
  let publicKey;
  try {
    publicKey = getYapprPublicKey(privateKey);
  } catch {
    throw new Rejection("invalid-key", slot);
  }
  const publicKeyHash = hash160(publicKey);
  const found = keys.filter((key) => key.type === KeyType.ECDSA_SECP256K1 && bytesEqual(key.data, publicKey) || key.type === KeyType.ECDSA_HASH160 && bytesEqual(key.data, publicKeyHash));
  if (found.length === 0) throw new Rejection("key-not-found", slot);
  if (found.length > 1) throw new Rejection("duplicate-binding", slot);
  return found[0];
}
function matchBinding(request, key, slot) {
  if (key.disabledAt !== void 0) throw new Rejection("key-disabled", slot);
  if (key.securityLevel === KeySecurityLevel.MASTER) throw new Rejection("key-master", slot);
  const isAuth = key.purpose === KeyPurpose.AUTHENTICATION;
  if (!isAuth && key.purpose !== KeyPurpose.ENCRYPTION && key.purpose !== KeyPurpose.DECRYPTION) {
    throw new Rejection("key-purpose", slot);
  }
  if (!key.bounds) throw new Rejection("key-unbound", slot);
  const bounds = key.bounds;
  if (isAuth) {
    const bindingIndex2 = request.authBindings.findIndex((binding2) => boundsEqual(authBindingBounds(binding2), bounds));
    if (bindingIndex2 === -1) throw new Rejection("key-unmatched", slot);
    const binding = request.authBindings[bindingIndex2];
    if (!authLevelAllowed(binding, key.securityLevel)) throw new Rejection("key-level", slot);
    if (key.type !== KeyType.ECDSA_SECP256K1 && key.type !== KeyType.ECDSA_HASH160) {
      throw new Rejection("key-type", slot);
    }
    return { role: binding.kind, bindingIndex: bindingIndex2 };
  }
  const bindingIndex = request.encBindings.findIndex((binding) => binding.purpose === key.purpose && boundsEqual(encBindingBounds(binding), bounds));
  if (bindingIndex === -1) throw new Rejection("key-unmatched", slot);
  if (key.securityLevel !== KeySecurityLevel.MEDIUM) throw new Rejection("key-level", slot);
  if (key.type !== KeyType.ECDSA_SECP256K1) throw new Rejection("key-type", slot);
  return { role: key.purpose === KeyPurpose.ENCRYPTION ? "encryption" : "decryption", bindingIndex };
}
function authLevelAllowed(binding, level) {
  if (binding.kind === "contractGroup") {
    return (level === KeySecurityLevel.CRITICAL || level === KeySecurityLevel.HIGH) && level >= binding.securityLevel;
  }
  return level === KeySecurityLevel.HIGH;
}
function checkKeyLimits(key, match, request, now, margin, slot) {
  if (isAuthRole(match.role)) {
    const binding = request.authBindings[match.bindingIndex];
    const budgetRequired = binding.kind === "contractGroup" || binding.totalBudget !== void 0;
    if (budgetRequired && (key.totalBudget === void 0 || key.totalBudget <= 0n)) {
      throw new Rejection("key-limits", slot);
    }
    if (binding.expiresAt !== void 0 && key.expiresAt === void 0) throw new Rejection("key-limits", slot);
  }
  if (key.expiresAt !== void 0 && key.expiresAt - now <= margin) throw new Rejection("key-expired", slot);
}
function bytesEqual(a, b) {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

// src/browser/passkey-prf.ts
import { sha256 as sha2563 } from "@noble/hashes/sha2.js";

// src/browser/secret-store.ts
var BrowserStorage = class {
  constructor(prefix) {
    this.prefix = prefix;
  }
  prefix;
  getKeysWithPrefix(storage) {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(this.prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }
  getStorage() {
    if (typeof window === "undefined") return null;
    return localStorage;
  }
  getLegacyStorage() {
    if (typeof window === "undefined") return null;
    return sessionStorage;
  }
  isAvailable() {
    if (typeof window === "undefined") return false;
    try {
      const test = "__storage_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }
  set(key, value) {
    if (!this.isAvailable()) return;
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(this.prefix + key, JSON.stringify(value));
      this.getLegacyStorage()?.removeItem(this.prefix + key);
    } catch {
    }
  }
  get(key) {
    if (!this.isAvailable()) return null;
    try {
      const storage = this.getStorage();
      if (!storage) return null;
      const item = storage.getItem(this.prefix + key);
      if (item) return JSON.parse(item);
      const legacyStorage = this.getLegacyStorage();
      const fallback = legacyStorage?.getItem(this.prefix + key);
      if (!fallback) return null;
      const parsed = JSON.parse(fallback);
      storage.setItem(this.prefix + key, fallback);
      legacyStorage?.removeItem(this.prefix + key);
      return parsed;
    } catch {
      return null;
    }
  }
  has(key) {
    if (!this.isAvailable()) return false;
    const storage = this.getStorage();
    if (!storage) return false;
    if (storage.getItem(this.prefix + key) !== null) return true;
    return this.getLegacyStorage()?.getItem(this.prefix + key) !== null;
  }
  delete(key) {
    if (!this.isAvailable()) return false;
    const existed = this.has(key);
    localStorage.removeItem(this.prefix + key);
    sessionStorage.removeItem(this.prefix + key);
    return existed;
  }
  clear() {
    if (!this.isAvailable()) return;
    this.getKeysWithPrefix(localStorage).forEach((key) => localStorage.removeItem(key));
    this.getKeysWithPrefix(sessionStorage).forEach((key) => sessionStorage.removeItem(key));
  }
  keys() {
    if (!this.isAvailable()) return [];
    const allKeys = [
      ...this.getKeysWithPrefix(localStorage),
      ...this.getKeysWithPrefix(sessionStorage)
    ];
    const uniqueKeys = new Set(allKeys.map((key) => key.slice(this.prefix.length)));
    return Array.from(uniqueKeys);
  }
  size() {
    return this.keys().length;
  }
};
function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
function base64ToBytes(value) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
function generatePrfInput() {
  return crypto.getRandomValues(new Uint8Array(32));
}
function createBrowserSecretStore(options) {
  const storage = new BrowserStorage(options.prefix ?? "platform_auth_secure_");
  const storePrivateKey = (identityId, privateKey) => {
    storage.set(`pk_${identityId}`, privateKey);
  };
  const getPrivateKey = (identityId) => {
    const value = storage.get(`pk_${identityId}`);
    return typeof value === "string" ? value : null;
  };
  const clearPrivateKey = (identityId) => storage.delete(`pk_${identityId}`);
  const hasPrivateKey = (identityId) => storage.has(`pk_${identityId}`);
  const clearAllPrivateKeys = () => {
    storage.keys().filter((key) => key.startsWith("pk_")).forEach((key) => {
      storage.delete(key);
    });
  };
  const storeLoginKey = (identityId, loginKey) => {
    storage.set(`lk_${identityId}`, bytesToBase64(loginKey));
  };
  const getLoginKey = (identityId) => {
    const value = storage.get(`lk_${identityId}`);
    return typeof value === "string" ? value : null;
  };
  const getLoginKeyBytes = (identityId) => {
    const value = getLoginKey(identityId);
    return value ? base64ToBytes(value) : null;
  };
  const hasLoginKey = (identityId) => storage.has(`lk_${identityId}`);
  const clearLoginKey = (identityId) => storage.delete(`lk_${identityId}`);
  const storeAuthVaultDek = (identityId, dek) => {
    storage.set(`avd_${identityId}`, bytesToBase64(dek));
  };
  const getAuthVaultDek = (identityId) => {
    const value = storage.get(`avd_${identityId}`);
    return typeof value === "string" ? value : null;
  };
  const getAuthVaultDekBytes = (identityId) => {
    const value = getAuthVaultDek(identityId);
    return value ? base64ToBytes(value) : null;
  };
  const hasAuthVaultDek = (identityId) => storage.has(`avd_${identityId}`);
  const clearAuthVaultDek = (identityId) => storage.delete(`avd_${identityId}`);
  const storeNormalizedWif = (storageKey, privateKey) => {
    if (options.crypto.isLikelyWif(privateKey)) {
      storage.set(storageKey, privateKey);
      return;
    }
    const parsed = options.crypto.parsePrivateKey(privateKey);
    const wif = options.crypto.privateKeyToWif(parsed.privateKey, options.network, true);
    storage.set(storageKey, wif);
  };
  const getKeyBytes = (value) => {
    if (!value) return null;
    try {
      const parsed = options.crypto.parsePrivateKey(value);
      return parsed.privateKey;
    } catch {
      return null;
    }
  };
  const storeEncryptionKey = (identityId, encryptionKey) => {
    storeNormalizedWif(`ek_${identityId}`, encryptionKey);
  };
  const getEncryptionKey = (identityId) => {
    const value = storage.get(`ek_${identityId}`);
    return typeof value === "string" ? value : null;
  };
  const getEncryptionKeyBytes = (identityId) => getKeyBytes(getEncryptionKey(identityId));
  const hasEncryptionKey = (identityId) => storage.has(`ek_${identityId}`);
  const clearEncryptionKey = (identityId) => storage.delete(`ek_${identityId}`);
  const storeEncryptionKeyType = (identityId, type) => {
    storage.set(`ek_type_${identityId}`, type);
  };
  const getEncryptionKeyType = (identityId) => {
    const value = storage.get(`ek_type_${identityId}`);
    return value === "derived" || value === "external" ? value : null;
  };
  const clearEncryptionKeyType = (identityId) => storage.delete(`ek_type_${identityId}`);
  const storeTransferKey = (identityId, transferKey) => {
    storeNormalizedWif(`tk_${identityId}`, transferKey);
  };
  const getTransferKey = (identityId) => {
    const value = storage.get(`tk_${identityId}`);
    return typeof value === "string" ? value : null;
  };
  const getTransferKeyBytes = (identityId) => getKeyBytes(getTransferKey(identityId));
  const hasTransferKey = (identityId) => storage.has(`tk_${identityId}`);
  const clearTransferKey = (identityId) => storage.delete(`tk_${identityId}`);
  return {
    secureStorage: storage,
    storePrivateKey,
    getPrivateKey,
    clearPrivateKey,
    hasPrivateKey,
    clearAllPrivateKeys,
    storeLoginKey,
    getLoginKey,
    getLoginKeyBytes,
    hasLoginKey,
    clearLoginKey,
    storeAuthVaultDek,
    getAuthVaultDek,
    getAuthVaultDekBytes,
    hasAuthVaultDek,
    clearAuthVaultDek,
    storeEncryptionKey,
    getEncryptionKey,
    getEncryptionKeyBytes,
    hasEncryptionKey,
    clearEncryptionKey,
    storeEncryptionKeyType,
    getEncryptionKeyType,
    clearEncryptionKeyType,
    storeTransferKey,
    getTransferKey,
    getTransferKeyBytes,
    hasTransferKey,
    clearTransferKey
  };
}

// src/browser/passkey-prf.ts
var DEFAULT_RP_NAME = "Platform Auth";
function getDefaultRpId() {
  if (typeof window === "undefined") {
    throw new Error("Passkeys require a browser environment");
  }
  return window.location.hostname;
}
function toArrayBuffer2(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function base64UrlEncode(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function extractPrfFirst(result) {
  if (!result?.results?.first) return null;
  return new Uint8Array(result.results.first);
}
function decodeUserHandle(userHandle) {
  if (!userHandle) return void 0;
  const decoded = new TextDecoder().decode(new Uint8Array(userHandle)).trim();
  return decoded || void 0;
}
function ensureBrowserPasskeys() {
  if (typeof window === "undefined" || !window.isSecureContext || !window.PublicKeyCredential) {
    throw new Error("Passkey enrollment requires a secure browser with WebAuthn support.");
  }
}
async function createPasskeyWithPrf(options) {
  ensureBrowserPasskeys();
  const rpId = options.rpId ?? getDefaultRpId();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(options.identityId).slice(0, 64);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        id: rpId,
        name: options.rpName ?? DEFAULT_RP_NAME
      },
      user: {
        id: userId,
        name: options.username,
        displayName: options.displayName
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -257 }
      ],
      timeout: 6e4,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required"
      },
      extensions: {
        prf: {}
      }
    }
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Failed to create passkey credential");
  }
  const createExtensions = credential.getClientExtensionResults();
  if (createExtensions.prf?.enabled === false) {
    throw new Error("This passkey/provider did not enable PRF during registration.");
  }
  const credentialId = new Uint8Array(credential.rawId);
  const prfInput = generatePrfInput();
  const assertion = await getPrfAssertionForCredentials([{ credentialId, prfInput, rpId }]);
  return {
    ...assertion,
    label: options.label
  };
}
async function getPrfAssertionForCredentials(credentials) {
  ensureBrowserPasskeys();
  if (credentials.length === 0) {
    throw new Error("No passkey credentials available");
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpId = credentials[0].rpId;
  const allowCredentials = credentials.map((entry) => ({
    id: toArrayBuffer2(entry.credentialId),
    type: "public-key"
  }));
  const evalByCredential = credentials.reduce((accumulator, entry) => {
    accumulator[base64UrlEncode(entry.credentialId)] = { first: entry.prfInput };
    return accumulator;
  }, {});
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId,
      timeout: 6e4,
      userVerification: "required",
      allowCredentials,
      extensions: {
        prf: {
          evalByCredential
        }
      }
    }
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey assertion failed");
  }
  const typedCredential = credential;
  const prfOutput = extractPrfFirst(typedCredential.getClientExtensionResults().prf);
  if (!prfOutput) {
    throw new Error("This passkey/provider did not return PRF output.");
  }
  const credentialId = new Uint8Array(credential.rawId);
  const descriptor = credentials.find((entry) => base64UrlEncode(entry.credentialId) === base64UrlEncode(credentialId));
  if (!descriptor) {
    throw new Error("Selected passkey is not registered for this identity.");
  }
  return {
    credentialId,
    credentialIdHash: sha2563(credentialId),
    prfInput: descriptor.prfInput,
    prfOutput,
    rpId: descriptor.rpId
  };
}
async function selectDiscoverablePasskey(rpId = getDefaultRpId()) {
  ensureBrowserPasskeys();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId,
      timeout: 6e4,
      userVerification: "required"
    }
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey assertion failed");
  }
  const assertionCredential = credential;
  const credentialId = new Uint8Array(credential.rawId);
  return {
    credentialId,
    credentialIdHash: sha2563(credentialId),
    userHandle: decodeUserHandle(assertionCredential.response.userHandle),
    rpId
  };
}
function getPasskeyAllowCredentialIds(credentials) {
  return credentials.map((entry) => new Uint8Array(toArrayBuffer2(entry.credentialId)));
}

// src/browser/passkey-support.ts
function getPlatformHint() {
  if (typeof navigator === "undefined") return "unknown";
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() ?? "";
  if (/iphone|ipad|ipod|mac os|macintosh/.test(userAgent) || /iphone|ipad|mac/.test(platform)) {
    return "apple";
  }
  if (/android/.test(userAgent)) {
    return "android";
  }
  if (/windows/.test(userAgent) || /win/.test(platform)) {
    return "windows";
  }
  if (userAgent) {
    return "desktop-other";
  }
  return "unknown";
}
async function getPasskeyPrfSupport() {
  if (typeof window === "undefined") {
    return {
      webauthnAvailable: false,
      conditionalUiAvailable: false,
      likelyPrfCapable: false,
      platformHint: "unknown",
      blockedReason: "Passkeys are only available in a browser context."
    };
  }
  if (!window.isSecureContext) {
    return {
      webauthnAvailable: false,
      conditionalUiAvailable: false,
      likelyPrfCapable: false,
      platformHint: getPlatformHint(),
      blockedReason: "Passkey enrollment requires a secure browser context."
    };
  }
  const publicKeyCredential = window.PublicKeyCredential;
  if (!publicKeyCredential) {
    return {
      webauthnAvailable: false,
      conditionalUiAvailable: false,
      likelyPrfCapable: false,
      platformHint: getPlatformHint(),
      blockedReason: "This browser does not support WebAuthn passkeys."
    };
  }
  const conditionalUiAvailable = typeof publicKeyCredential.isConditionalMediationAvailable === "function" ? await publicKeyCredential.isConditionalMediationAvailable().catch(() => false) : false;
  const platformAuthenticatorAvailable = typeof publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function" ? await publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false) : false;
  return {
    webauthnAvailable: true,
    conditionalUiAvailable,
    likelyPrfCapable: platformAuthenticatorAvailable || conditionalUiAvailable,
    platformHint: getPlatformHint(),
    blockedReason: platformAuthenticatorAvailable || conditionalUiAvailable ? void 0 : "This browser can use passkeys, but PRF capability still needs to be confirmed by an actual passkey assertion."
  };
}

// src/core/controller.ts
var DEFAULT_FEATURES = {
  usernameGate: true,
  profileGate: true,
  passwordLogin: true,
  passkeyLogin: true,
  keyExchangeLogin: true,
  authVault: true,
  legacyPasswordLogin: true,
  autoDeriveEncryptionKey: true,
  postLoginTasks: true,
  balanceRefresh: true
};
var DEFAULT_BALANCE_REFRESH_MS = 3e5;
var noopLogger = {
  info: () => void 0,
  warn: () => void 0,
  error: () => void 0
};
function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
function buildIntent(kind, identityId, username) {
  if (kind === "profile-required") {
    return { kind, identityId, username };
  }
  return { kind, identityId };
}
var PlatformAuthController = class {
  constructor(deps) {
    this.deps = deps;
    this.features = { ...DEFAULT_FEATURES, ...deps.features };
    this.logger = deps.logger ?? noopLogger;
    this.balanceRefreshMs = deps.balanceRefreshMs ?? DEFAULT_BALANCE_REFRESH_MS;
  }
  deps;
  features;
  listeners = /* @__PURE__ */ new Set();
  logger;
  balanceRefreshMs;
  state = {
    user: null,
    isLoading: false,
    isAuthRestoring: true,
    error: null
  };
  balanceInterval = null;
  getState() {
    return this.state;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose() {
    if (this.balanceInterval) {
      clearInterval(this.balanceInterval);
      this.balanceInterval = null;
    }
    this.listeners.clear();
  }
  getYapprKeyExchangeConfig(overrides = {}) {
    const configured = this.deps.yapprKeyExchangeConfig ?? {};
    const appContractId = overrides.appContractId ?? configured.appContractId;
    const keyExchangeContractId = overrides.keyExchangeContractId ?? configured.keyExchangeContractId;
    if (!appContractId || !keyExchangeContractId) {
      throw new Error("Yappr key exchange is not configured");
    }
    return {
      appContractId,
      keyExchangeContractId,
      network: overrides.network ?? configured.network ?? this.deps.network,
      label: overrides.label ?? configured.label ?? DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG.label,
      pollIntervalMs: overrides.pollIntervalMs ?? configured.pollIntervalMs ?? DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG.pollIntervalMs,
      timeoutMs: overrides.timeoutMs ?? configured.timeoutMs ?? DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG.timeoutMs
    };
  }
  async pollYapprKeyExchangeResponse(appEphemeralPubKeyHash, appEphemeralPrivateKey, overrides = {}, options = {}) {
    const { port, config } = this.requireYapprKeyExchange(overrides);
    const contractIdBytes = decodeYapprContractId(config.appContractId);
    return pollForYapprKeyExchangeResponse(
      port,
      contractIdBytes,
      appEphemeralPubKeyHash,
      appEphemeralPrivateKey,
      {
        pollIntervalMs: config.pollIntervalMs,
        timeoutMs: config.timeoutMs,
        signal: options.signal,
        onPoll: options.onPoll,
        logger: this.logger
      }
    );
  }
  async checkYapprKeysRegistered(identityId, authPublicKey, encryptionPublicKey, overrides = {}) {
    const { port } = this.requireYapprKeyExchange(overrides);
    return port.checkKeysRegistered(identityId, authPublicKey, encryptionPublicKey);
  }
  async buildYapprUnsignedKeyRegistrationTransition(request, overrides = {}) {
    const { port } = this.requireYapprKeyExchange(overrides);
    return port.buildUnsignedKeyRegistrationTransition(request);
  }
  async completeYapprKeyExchangeLogin(input) {
    return this.loginWithLoginKey(input.identityId, input.loginKey, input.keyIndex);
  }
  async restoreSession() {
    this.patchState({ isAuthRestoring: true, error: null });
    try {
      const snapshot = await this.deps.sessionStore.getSession();
      if (!snapshot) {
        this.patchState({ isAuthRestoring: false });
        return null;
      }
      const identityId = snapshot.user.identityId;
      const hasPrivateKey = await this.deps.secretStore.hasPrivateKey(identityId);
      if (!hasPrivateKey) {
        await this.deps.sessionStore.clearSession();
        this.patchState({ isAuthRestoring: false, user: null });
        return null;
      }
      this.patchState({
        user: snapshot.user,
        isAuthRestoring: false,
        error: null
      });
      await this.deps.clientIdentity?.setIdentity(identityId);
      await this.emit({ type: "session-restored", user: snapshot.user });
      if (!snapshot.user.username && this.deps.usernames) {
        void this.backfillUsername(identityId);
      }
      this.startBalanceRefresh();
      this.runPostLoginTasks(identityId, 3e3);
      return snapshot.user;
    } catch (error) {
      this.logger.error("platform-auth: failed to restore session", error);
      await this.deps.sessionStore.clearSession();
      this.patchState({
        user: null,
        error: error instanceof Error ? error.message : "Failed to restore session",
        isAuthRestoring: false
      });
      return null;
    }
  }
  async loginWithAuthKey(identityId, privateKey, options = {}) {
    const skipUsernameCheck = options.skipUsernameCheck ?? false;
    this.patchState({ isLoading: true, error: null });
    try {
      if (!identityId || !privateKey) {
        throw new Error("Identity ID and private key are required");
      }
      const identity = await this.deps.identity.getIdentity(identityId);
      if (!identity) {
        throw new Error("Identity not found");
      }
      const username = this.deps.usernames ? await this.deps.usernames.resolveUsername(identity.id) : null;
      const user = {
        identityId: identity.id,
        balance: identity.balance,
        username: username ?? void 0,
        publicKeys: identity.publicKeys
      };
      await this.persistSessionUser(user);
      await this.deps.secretStore.storePrivateKey(identity.id, privateKey);
      await this.deps.clientIdentity?.setIdentity(identity.id);
      this.patchState({
        user,
        error: null
      });
      await this.emit({ type: "login-succeeded", user });
      this.startBalanceRefresh();
      this.tryAutoDeriveEncryptionKey(identity.id, privateKey, user.publicKeys);
      if (this.features.usernameGate && !skipUsernameCheck && !user.username) {
        await this.emit({ type: "username-required", identityId: identity.id });
        return {
          user,
          intent: buildIntent("username-required", identity.id)
        };
      }
      if (this.features.profileGate && this.deps.profiles) {
        const hasProfile = await this.deps.profiles.hasProfile(identity.id, user.username);
        if (!hasProfile) {
          await this.emit({ type: "profile-required", identityId: identity.id, username: user.username });
          return {
            user,
            intent: buildIntent("profile-required", identity.id, user.username)
          };
        }
      }
      this.runPostLoginTasks(identity.id, 2e3);
      return {
        user,
        intent: buildIntent("ready", identity.id)
      };
    } catch (error) {
      this.logger.error("platform-auth: auth-key login failed", error);
      this.patchState({
        error: error instanceof Error ? error.message : "Failed to login"
      });
      throw error;
    } finally {
      this.patchState({ isLoading: false });
    }
  }
  async loginWithPassword(identityOrUsername, password) {
    if (!this.features.passwordLogin) {
      throw new Error("Password login is disabled");
    }
    this.patchState({ isLoading: true, error: null });
    try {
      let fallbackResult = null;
      let sawInvalidPassword = false;
      let lastNonPasswordError = null;
      if (this.features.authVault && this.deps.vault?.isConfigured()) {
        try {
          const unlocked = await this.deps.vault.unlockWithPassword(identityOrUsername, password);
          return await this.restoreUnlockedVaultSession(unlocked);
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (message === "Invalid password") {
            sawInvalidPassword = true;
          } else if (error instanceof Error) {
            lastNonPasswordError = error;
          }
        }
      }
      if (this.features.legacyPasswordLogin && this.deps.legacyPasswordLogins) {
        for (const adapter of this.deps.legacyPasswordLogins) {
          if (!adapter.isConfigured()) continue;
          try {
            fallbackResult = await adapter.loginWithPassword(identityOrUsername, password);
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (message === "Invalid password") {
              sawInvalidPassword = true;
            } else if (error instanceof Error) {
              lastNonPasswordError = error;
            }
          }
        }
      }
      if (!fallbackResult) {
        if (sawInvalidPassword) {
          throw new Error("Invalid password");
        }
        throw lastNonPasswordError ?? new Error("Password login is not configured");
      }
      return await this.loginWithAuthKey(fallbackResult.identityId, fallbackResult.privateKey, {
        skipUsernameCheck: true
      });
    } catch (error) {
      this.logger.error("platform-auth: password login failed", error);
      this.patchState({
        error: error instanceof Error ? error.message : "Failed to login with password"
      });
      throw error;
    } finally {
      this.patchState({ isLoading: false });
    }
  }
  async loginWithPasskey(identityOrUsername) {
    if (!this.features.passkeyLogin) {
      throw new Error("Passkey login is disabled");
    }
    if (!this.deps.vault?.isConfigured() || !this.deps.passkeys) {
      throw new Error("Passkey login is not configured");
    }
    this.patchState({ isLoading: true, error: null });
    try {
      const normalizedIdentity = identityOrUsername?.trim();
      const currentRpId = this.deps.passkeys.getDefaultRpId();
      let accesses = [];
      let selectedCredentialHash;
      if (normalizedIdentity) {
        const identityId = await this.deps.vault.resolveIdentityId(normalizedIdentity);
        if (!identityId) {
          throw new Error("Username not found");
        }
        accesses = (await this.deps.vault.getPasskeyAccesses(identityId)).filter((entry) => entry.rpId === currentRpId);
      } else {
        const selected = await this.deps.passkeys.selectDiscoverablePasskey(currentRpId);
        if (!selected.userHandle) {
          throw new Error("This passkey did not provide an account identifier. Try signing in with your username once, then use passkey login again.");
        }
        accesses = (await this.deps.vault.getPasskeyAccesses(selected.userHandle)).filter((entry) => entry.rpId === currentRpId);
        selectedCredentialHash = selected.credentialIdHash;
      }
      if (accesses.length === 0) {
        if (normalizedIdentity) {
          throw new Error("No passkey login is configured for this site and account");
        }
        throw new Error("No passkey login is configured for this selected passkey on this site yet");
      }
      if (selectedCredentialHash) {
        accesses = accesses.filter((entry) => sameBytes(entry.credentialIdHash, selectedCredentialHash));
        if (accesses.length === 0) {
          throw new Error("This selected passkey is not registered for this site");
        }
      }
      const descriptors = accesses.flatMap((entry) => {
        if (!entry.credentialId || !entry.prfInput || !entry.rpId) return [];
        return [{
          credentialId: entry.credentialId,
          prfInput: entry.prfInput,
          rpId: entry.rpId
        }];
      });
      const assertion = await this.deps.passkeys.getPrfAssertionForCredentials(descriptors);
      const expectedCredentialHash = selectedCredentialHash ?? assertion.credentialIdHash;
      const access = accesses.find((entry) => sameBytes(entry.credentialIdHash, expectedCredentialHash));
      if (!access) {
        throw new Error("Selected passkey is not registered for this site");
      }
      const unlocked = await this.deps.vault.unlockWithPrf(access.$ownerId, access, assertion.prfOutput);
      return await this.restoreUnlockedVaultSession(unlocked);
    } catch (error) {
      this.logger.error("platform-auth: passkey login failed", error);
      this.patchState({
        error: error instanceof Error ? error.message : "Failed to login with passkey"
      });
      throw error;
    } finally {
      this.patchState({ isLoading: false });
    }
  }
  async loginWithLoginKey(identityId, loginKey, keyIndex) {
    if (!this.features.keyExchangeLogin) {
      throw new Error("Login-key login is disabled");
    }
    if (!this.deps.crypto) {
      throw new Error("Login-key login requires crypto adapters");
    }
    this.patchState({ isLoading: true, error: null });
    try {
      const identityIdBytes = this.deps.crypto.decodeIdentityId(identityId);
      const authKey = this.deps.crypto.deriveAuthKeyFromLogin(loginKey, identityIdBytes);
      const encryptionKey = this.deps.crypto.deriveEncryptionKeyFromLogin(loginKey, identityIdBytes);
      if (this.deps.crypto.validateDerivedKeyMatchesIdentity) {
        const matches = await this.deps.crypto.validateDerivedKeyMatchesIdentity(authKey, identityId);
        if (!matches) {
          throw new Error("Derived auth key does not match the identity \u2014 refusing to log in");
        }
      }
      const authKeyWif = this.deps.crypto.privateKeyToWif(authKey, this.deps.network, true);
      const encryptionKeyWif = this.deps.crypto.privateKeyToWif(encryptionKey, this.deps.network, true);
      await this.deps.secretStore.storeLoginKey(identityId, loginKey);
      this.logger.info(`platform-auth: login-key login using keyIndex=${keyIndex}`);
      const result = await this.loginWithAuthKey(identityId, authKeyWif, {
        skipUsernameCheck: false
      });
      await this.deps.secretStore.storeEncryptionKey(identityId, encryptionKeyWif);
      await this.deps.secretStore.storeEncryptionKeyType(identityId, "derived");
      await this.createOrUpdateVaultFromLoginKey(identityId, loginKey).catch((error) => {
        this.logger.warn("platform-auth: failed to create or update vault from login key", error);
      });
      await this.mergeSecretsIntoVault(identityId, {
        loginKey,
        encryptionKeyWif,
        source: "wallet-derived"
      }).catch((error) => {
        this.logger.warn("platform-auth: failed to merge login-key secrets into vault", error);
      });
      return result;
    } catch (error) {
      await this.deps.secretStore.clearPrivateKey(identityId);
      await this.deps.secretStore.clearEncryptionKey(identityId);
      await this.deps.secretStore.clearEncryptionKeyType(identityId);
      await this.deps.secretStore.clearLoginKey(identityId);
      this.logger.error("platform-auth: login-key login failed", error);
      this.patchState({
        error: error instanceof Error ? error.message : "Failed to login with key exchange"
      });
      throw error;
    } finally {
      this.patchState({ isLoading: false });
    }
  }
  async createOrUpdateVaultFromLoginKey(identityId, loginKey) {
    return this.ensureVaultForCurrentSession(identityId, {
      loginKey,
      source: "wallet-derived"
    });
  }
  async createOrUpdateVaultFromAuthKey(identityId, authKeyWif) {
    return this.ensureVaultForCurrentSession(identityId, {
      authKeyWif,
      source: "direct-key"
    });
  }
  async mergeSecretsIntoVault(identityId, partialSecrets) {
    if (!this.features.authVault || !this.deps.vault?.isConfigured()) {
      return null;
    }
    const dek = await this.deps.secretStore.getAuthVaultDek(identityId);
    if (!dek) {
      return null;
    }
    const merged = await this.deps.vault.mergeSecrets(identityId, dek, partialSecrets);
    if (!merged) {
      return null;
    }
    await this.deps.secretStore.storeAuthVaultDek(identityId, merged.dek);
    if (partialSecrets.loginKey) {
      await this.deps.secretStore.storeLoginKey(identityId, partialSecrets.loginKey);
    }
    return merged;
  }
  async addPasswordAccess(password, iterations, label = "Password") {
    const user = this.requireUser("You must be logged in to add a password unlock method.");
    if (!this.deps.vault?.isConfigured()) {
      throw new Error("Auth vault is not configured");
    }
    const ensured = await this.ensureVaultForCurrentSession(user.identityId);
    await this.deps.vault.addPasswordAccess(user.identityId, {
      vaultId: ensured.vault.$id,
      dek: ensured.dek,
      password,
      iterations,
      label
    });
  }
  async addPasskeyAccess(label = "Current device") {
    const user = this.requireUser("You must be logged in to add a passkey.");
    if (!this.deps.vault?.isConfigured() || !this.deps.passkeys) {
      throw new Error("Passkeys are not configured");
    }
    const ensured = await this.ensureVaultForCurrentSession(user.identityId);
    const username = user.username ?? user.identityId;
    const passkey = await this.deps.passkeys.createPasskeyWithPrf({
      identityId: user.identityId,
      username,
      displayName: username,
      label
    });
    await this.deps.vault.addPasskeyAccess(user.identityId, {
      vaultId: ensured.vault.$id,
      dek: ensured.dek,
      passkey
    });
  }
  async logout() {
    const identityId = this.state.user?.identityId;
    await this.deps.sessionStore.clearSession();
    if (identityId) {
      await this.deps.secretStore.clearPrivateKey(identityId);
      await this.deps.secretStore.clearEncryptionKey(identityId);
      await this.deps.secretStore.clearEncryptionKeyType(identityId);
      await this.deps.secretStore.clearTransferKey(identityId);
      await this.deps.secretStore.clearLoginKey(identityId);
      await this.deps.secretStore.clearAuthVaultDek(identityId);
      await this.deps.sideEffects?.runLogoutCleanup?.(identityId);
    }
    await this.deps.clientIdentity?.setIdentity("");
    this.stopBalanceRefresh();
    this.patchState({
      user: null,
      error: null
    });
    await this.emit({ type: "logout", identityId });
    return {
      user: null,
      intent: { kind: "logged-out" }
    };
  }
  async refreshUsername() {
    const identityId = this.state.user?.identityId;
    if (!identityId || !this.deps.usernames) {
      return;
    }
    await this.deps.usernames.clearCache?.(void 0, identityId);
    const username = await this.deps.usernames.resolveUsername(identityId);
    if (!username || username === this.state.user?.username) {
      return;
    }
    await this.updateSessionUser((current) => ({
      ...current,
      username
    }));
  }
  async setUsername(username) {
    if (!this.state.user) {
      return;
    }
    await this.updateSessionUser((current) => ({
      ...current,
      username
    }));
  }
  async refreshBalance() {
    const identityId = this.state.user?.identityId;
    if (!identityId) {
      return;
    }
    await this.deps.identity.clearCache?.(identityId);
    const balance = await this.deps.identity.getBalance(identityId);
    await this.updateSessionUser((current) => ({
      ...current,
      balance
    }));
  }
  async backfillUsername(identityId) {
    try {
      const username = await this.deps.usernames?.resolveUsername(identityId);
      if (!username) return;
      if (!this.isSessionActive(identityId)) return;
      await this.updateSessionUser((current) => ({
        ...current,
        username
      }));
    } catch (error) {
      await this.emit({ type: "background-error", operation: "backfill-username", error });
    }
  }
  async ensureVaultForCurrentSession(identityId, overrides = {}) {
    if (!this.features.authVault || !this.deps.vault?.isConfigured()) {
      throw new Error("Auth vault is not configured");
    }
    let activeDek = await this.deps.secretStore.getAuthVaultDek(identityId);
    if (!activeDek) {
      const status = await this.deps.vault.getStatus(identityId);
      if (status.hasVault && status.passkeyCount > 0) {
        if (!this.deps.passkeys) {
          throw new Error("Passkeys are required to unlock this auth vault on this device.");
        }
        const currentRpId = this.deps.passkeys.getDefaultRpId();
        const passkeyAccesses = (await this.deps.vault.getPasskeyAccesses(identityId)).filter(
          (entry) => entry.rpId === currentRpId && entry.credentialId && entry.credentialIdHash && entry.prfInput
        );
        if (passkeyAccesses.length === 0) {
          throw new Error("This auth vault has passkeys, but none are registered for this site. Use an existing unlock method for this site before updating it.");
        }
        const descriptors = passkeyAccesses.map((entry) => ({
          credentialId: entry.credentialId,
          prfInput: entry.prfInput,
          rpId: entry.rpId
        }));
        const assertion = await this.deps.passkeys.getPrfAssertionForCredentials(descriptors);
        const matchingAccess = passkeyAccesses.find((entry) => sameBytes(entry.credentialIdHash, assertion.credentialIdHash));
        if (!matchingAccess) {
          throw new Error("The selected passkey is not registered for this account on this site.");
        }
        const unlocked = await this.deps.vault.unlockWithPrf(identityId, matchingAccess, assertion.prfOutput);
        await this.deps.secretStore.storeAuthVaultDek(identityId, unlocked.dek);
        activeDek = unlocked.dek;
      } else if (status.hasVault && status.hasPasswordAccess) {
        throw new Error("This auth vault already has a password unlock method. Sign in once with that auth-vault password or an existing passkey on this device before adding another unlock method.");
      }
    }
    if (activeDek) {
      const merged = await this.deps.vault.mergeSecrets(identityId, activeDek, {
        loginKey: overrides.loginKey,
        authKeyWif: overrides.authKeyWif,
        encryptionKeyWif: overrides.encryptionKeyWif,
        transferKeyWif: overrides.transferKeyWif,
        source: overrides.source
      });
      if (merged) {
        await this.deps.secretStore.storeAuthVaultDek(identityId, merged.dek);
        if (overrides.loginKey) {
          await this.deps.secretStore.storeLoginKey(identityId, overrides.loginKey);
        }
        return merged;
      }
    }
    const hasExistingVault = await this.deps.vault.hasVault(identityId);
    if (hasExistingVault && !activeDek) {
      throw new Error("This auth vault already exists but is not unlocked on this device. Unlock it once with its current password or passkey, then try again.");
    }
    const loginKey = overrides.loginKey ?? await this.deps.secretStore.getLoginKey(identityId) ?? void 0;
    const authKeyWif = overrides.authKeyWif ?? await this.deps.secretStore.getPrivateKey(identityId) ?? void 0;
    const encryptionKeyWif = overrides.encryptionKeyWif ?? await this.deps.secretStore.getEncryptionKey(identityId) ?? void 0;
    const transferKeyWif = overrides.transferKeyWif ?? await this.deps.secretStore.getTransferKey(identityId) ?? void 0;
    if (!loginKey && !authKeyWif) {
      throw new Error("No active login secret is available for auth vault enrollment.");
    }
    const bundle = {
      version: 1,
      identityId,
      network: this.deps.network,
      secretKind: loginKey ? "login-key" : "auth-key",
      loginKey,
      authKeyWif,
      encryptionKeyWif,
      transferKeyWif,
      source: overrides.source ?? (loginKey ? "wallet-derived" : "direct-key"),
      updatedAt: this.now()
    };
    const created = await this.deps.vault.createOrUpdateVaultBundle(identityId, bundle, activeDek ?? void 0);
    await this.deps.secretStore.storeAuthVaultDek(identityId, created.dek);
    if (loginKey) {
      await this.deps.secretStore.storeLoginKey(identityId, loginKey);
    }
    return created;
  }
  async restoreUnlockedVaultSession(unlocked) {
    await this.deps.secretStore.storeAuthVaultDek(unlocked.identityId, unlocked.dek);
    let authKeyWif = unlocked.bundle.authKeyWif;
    let encryptionKeyWif = unlocked.bundle.encryptionKeyWif;
    let encryptionKeyType = "external";
    if (unlocked.bundle.secretKind === "login-key") {
      if (!this.deps.crypto || !unlocked.bundle.loginKey) {
        throw new Error("Auth vault is missing the wallet login secret.");
      }
      const identityIdBytes = this.deps.crypto.decodeIdentityId(unlocked.identityId);
      const authKey = this.deps.crypto.deriveAuthKeyFromLogin(unlocked.bundle.loginKey, identityIdBytes);
      const derivedEncryptionKey = this.deps.crypto.deriveEncryptionKeyFromLogin(unlocked.bundle.loginKey, identityIdBytes);
      authKeyWif = this.deps.crypto.privateKeyToWif(authKey, this.deps.network, true);
      const derivedEncryptionKeyWif = this.deps.crypto.privateKeyToWif(derivedEncryptionKey, this.deps.network, true);
      encryptionKeyWif = unlocked.bundle.encryptionKeyWif ?? derivedEncryptionKeyWif;
      encryptionKeyType = !unlocked.bundle.encryptionKeyWif || unlocked.bundle.encryptionKeyWif === derivedEncryptionKeyWif ? "derived" : "external";
      await this.deps.secretStore.storeLoginKey(unlocked.identityId, unlocked.bundle.loginKey);
    } else if (authKeyWif && encryptionKeyWif && this.deps.crypto) {
      try {
        const parsed = this.deps.crypto.parsePrivateKey(authKeyWif);
        const derived = this.deps.crypto.deriveEncryptionKey(parsed.privateKey, unlocked.identityId);
        const derivedWif = this.deps.crypto.privateKeyToWif(derived, this.deps.network, true);
        encryptionKeyType = derivedWif === encryptionKeyWif ? "derived" : "external";
      } catch {
        encryptionKeyType = "external";
      }
    }
    if (!authKeyWif) {
      throw new Error("Auth vault is missing the authentication key.");
    }
    const result = await this.loginWithAuthKey(unlocked.identityId, authKeyWif, {
      skipUsernameCheck: true
    });
    if (encryptionKeyWif) {
      await this.deps.secretStore.storeEncryptionKey(unlocked.identityId, encryptionKeyWif);
      await this.deps.secretStore.storeEncryptionKeyType(unlocked.identityId, encryptionKeyType);
    }
    if (unlocked.bundle.transferKeyWif) {
      await this.deps.secretStore.storeTransferKey(unlocked.identityId, unlocked.bundle.transferKeyWif);
    }
    return result;
  }
  tryAutoDeriveEncryptionKey(identityId, privateKey, publicKeys) {
    if (!this.features.autoDeriveEncryptionKey || !this.deps.crypto) {
      return;
    }
    const crypto2 = this.deps.crypto;
    void (async () => {
      try {
        const hasEncryptionKeyOnIdentity = crypto2.identityHasEncryptionKey(publicKeys);
        const hasStoredEncryptionKey = await this.deps.secretStore.hasEncryptionKey(identityId);
        if (!hasEncryptionKeyOnIdentity || hasStoredEncryptionKey) {
          return;
        }
        const parsed = crypto2.parsePrivateKey(privateKey);
        const derivedKey = crypto2.deriveEncryptionKey(parsed.privateKey, identityId);
        const matches = await crypto2.validateDerivedKeyMatchesIdentity(derivedKey, identityId);
        if (!matches || !this.isSessionActive(identityId)) {
          return;
        }
        const derivedKeyWif = crypto2.privateKeyToWif(derivedKey, this.deps.network, true);
        await this.deps.secretStore.storeEncryptionKey(identityId, derivedKeyWif);
        await this.deps.secretStore.storeEncryptionKeyType(identityId, "derived");
        const dek = await this.deps.secretStore.getAuthVaultDek(identityId);
        if (dek && this.deps.vault?.isConfigured()) {
          await this.deps.vault.mergeSecrets(identityId, dek, {
            encryptionKeyWif: derivedKeyWif
          });
        }
      } catch (error) {
        await this.emit({ type: "background-error", operation: "derive-encryption-key", error });
      }
    })();
  }
  runPostLoginTasks(identityId, delayMs) {
    if (!this.features.postLoginTasks || !this.deps.sideEffects) {
      return;
    }
    void Promise.resolve(
      this.deps.sideEffects.runPostLogin(identityId, {
        delayMs,
        isSessionActive: () => this.isSessionActive(identityId)
      })
    ).catch(async (error) => {
      await this.emit({ type: "background-error", operation: "post-login-tasks", error });
    });
  }
  startBalanceRefresh() {
    if (!this.features.balanceRefresh || !this.state.user) {
      return;
    }
    this.stopBalanceRefresh();
    this.balanceInterval = setInterval(() => {
      void this.refreshBalance().catch((error) => {
        this.logger.error("platform-auth: balance refresh failed", error);
      });
    }, this.balanceRefreshMs);
  }
  stopBalanceRefresh() {
    if (!this.balanceInterval) {
      return;
    }
    clearInterval(this.balanceInterval);
    this.balanceInterval = null;
  }
  requireYapprKeyExchange(overrides = {}) {
    if (!this.features.keyExchangeLogin) {
      throw new Error("Yappr key exchange login is disabled");
    }
    if (!this.deps.yapprKeyExchange) {
      throw new Error("Yappr key exchange is not configured");
    }
    return {
      port: this.deps.yapprKeyExchange,
      config: this.getYapprKeyExchangeConfig(overrides)
    };
  }
  requireUser(message) {
    if (!this.state.user) {
      throw new Error(message);
    }
    return this.state.user;
  }
  isSessionActive(identityId) {
    return this.state.user?.identityId === identityId;
  }
  async persistSessionUser(user) {
    const snapshot = {
      user,
      timestamp: this.now()
    };
    await this.deps.sessionStore.setSession(snapshot);
    this.patchState({ user });
  }
  async updateSessionUser(updater) {
    const current = this.state.user;
    if (!current) return;
    const updated = updater(current);
    await this.deps.sessionStore.setSession({
      user: updated,
      timestamp: this.now()
    });
    this.patchState({ user: updated });
  }
  patchState(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
  now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }
  async emit(event) {
    await this.deps.onEvent?.(event);
  }
};

// src/key-exchange/yappr-hooks.tsx
import { useCallback, useEffect, useRef, useState } from "react";
var DEFAULT_REGISTRATION_TIMEOUT_MS = 3e5;
function useYapprKeyExchangeLogin(controller, options = {}) {
  const [state, setState] = useState("idle");
  const [uri, setUri] = useState(null);
  const [remainingTime, setRemainingTime] = useState(null);
  const [keyIndex, setKeyIndex] = useState(0);
  const [needsKeyRegistration, setNeedsKeyRegistration] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const abortControllerRef = useRef(null);
  const ephemeralKeyRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const lastOptionsRef = useRef({});
  const cleanup = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (ephemeralKeyRef.current) {
      clearSensitiveBytes(ephemeralKeyRef.current);
      ephemeralKeyRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    startTimeRef.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);
  const clearResult = useCallback((value) => {
    if (!value) return;
    clearSensitiveBytes(value.loginKey);
    clearSensitiveBytes(value.authKey);
    clearSensitiveBytes(value.encryptionKey);
  }, []);
  const start = useCallback(async (startOptions = {}) => {
    lastOptionsRef.current = startOptions;
    cleanup();
    abortControllerRef.current = new AbortController();
    try {
      const resolvedConfig = controller.getYapprKeyExchangeConfig({
        ...options.config,
        label: startOptions.label ?? options.config?.label
      });
      setState("generating");
      setError(null);
      setResult((previous) => {
        clearResult(previous);
        return null;
      });
      setNeedsKeyRegistration(false);
      const contractIdBytes = decodeYapprContractId(resolvedConfig.appContractId);
      const ephemeral = generateYapprEphemeralKeyPair();
      ephemeralKeyRef.current = ephemeral.privateKey;
      const ephemeralPubKeyHash = hash160(ephemeral.publicKey);
      setUri(buildYapprKeyExchangeUri({
        appEphemeralPubKey: ephemeral.publicKey,
        contractId: contractIdBytes,
        label: resolvedConfig.label
      }, resolvedConfig.network));
      setState("waiting");
      startTimeRef.current = Date.now();
      timerIntervalRef.current = setInterval(() => {
        if (!startTimeRef.current) {
          return;
        }
        const elapsed = Date.now() - startTimeRef.current;
        const remaining = Math.max(0, Math.ceil((resolvedConfig.timeoutMs - elapsed) / 1e3));
        setRemainingTime(remaining);
        if (remaining === 0 && timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }, 1e3);
      const decrypted = await controller.pollYapprKeyExchangeResponse(
        ephemeralPubKeyHash,
        ephemeral.privateKey,
        options.config,
        { signal: abortControllerRef.current.signal }
      );
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      clearSensitiveBytes(ephemeral.privateKey);
      ephemeralKeyRef.current = null;
      setState("decrypting");
      const identityId = decrypted.identityId;
      setKeyIndex(decrypted.keyIndex);
      const identityIdBytes = decodeYapprIdentityId(identityId);
      const authKey = deriveYapprAuthKeyFromLogin(decrypted.loginKey, identityIdBytes);
      const encryptionKey = deriveYapprEncryptionKeyFromLogin(decrypted.loginKey, identityIdBytes);
      setState("checking");
      const authPublicKey = getYapprPublicKey(authKey);
      const encPublicKey = getYapprPublicKey(encryptionKey);
      const keysExist = await controller.checkYapprKeysRegistered(
        identityId,
        authPublicKey,
        encPublicKey,
        options.config
      );
      const loginResult = {
        loginKey: decrypted.loginKey,
        authKey,
        encryptionKey,
        keyIndex: decrypted.keyIndex,
        needsKeyRegistration: !keysExist,
        identityId
      };
      setResult(loginResult);
      if (loginResult.needsKeyRegistration) {
        setNeedsKeyRegistration(true);
        setState("registering");
        return;
      }
      setState("complete");
    } catch (err) {
      if (ephemeralKeyRef.current) {
        clearSensitiveBytes(ephemeralKeyRef.current);
        ephemeralKeyRef.current = null;
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (err instanceof Error) {
        if (err.message === "Cancelled") {
          setState("idle");
          return;
        }
        if (err.message.includes("Timeout")) {
          setState("timeout");
          setError("Timed out waiting for wallet response");
          return;
        }
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
      setState("error");
    }
  }, [cleanup, clearResult, controller, options.config]);
  const cancel = useCallback(() => {
    cleanup();
    setResult((previous) => {
      clearResult(previous);
      return null;
    });
    setState("idle");
    setUri(null);
    setRemainingTime(null);
    setError(null);
    setNeedsKeyRegistration(false);
  }, [cleanup, clearResult]);
  const retry = useCallback(() => {
    start(lastOptionsRef.current);
  }, [start]);
  return {
    state,
    uri,
    remainingTime,
    keyIndex,
    needsKeyRegistration,
    error,
    result,
    start,
    cancel,
    retry
  };
}
function useYapprKeyRegistration(controller, onComplete, options = {}) {
  const [state, setState] = useState("idle");
  const [uri, setUri] = useState(null);
  const [remainingTime, setRemainingTime] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const abortControllerRef = useRef(null);
  const identityIdRef = useRef(null);
  const authKeyRef = useRef(null);
  const encryptionKeyRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const cancelledRef = useRef(false);
  const cleanupTimers = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    startTimeRef.current = null;
  }, []);
  const cleanup = useCallback(() => {
    cleanupTimers();
    if (authKeyRef.current) {
      clearSensitiveBytes(authKeyRef.current);
      authKeyRef.current = null;
    }
    if (encryptionKeyRef.current) {
      clearSensitiveBytes(encryptionKeyRef.current);
      encryptionKeyRef.current = null;
    }
    identityIdRef.current = null;
  }, [cleanupTimers]);
  useEffect(() => cleanup, [cleanup]);
  const start = useCallback(async (identityId, authKey, encryptionKey) => {
    cleanup();
    identityIdRef.current = identityId;
    authKeyRef.current = new Uint8Array(authKey);
    encryptionKeyRef.current = new Uint8Array(encryptionKey);
    abortControllerRef.current = new AbortController();
    cancelledRef.current = false;
    try {
      const resolvedConfig = controller.getYapprKeyExchangeConfig(options.config);
      setState("building");
      setError(null);
      setResult(null);
      const authPublicKey = getYapprPublicKey(authKey);
      const encryptionPublicKey = getYapprPublicKey(encryptionKey);
      const transition = await controller.buildYapprUnsignedKeyRegistrationTransition({
        identityId,
        authPrivateKey: authKey,
        authPublicKey,
        encryptionPrivateKey: encryptionKey,
        encryptionPublicKey
      }, options.config);
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }
      setUri(buildYapprStateTransitionUri(transition.transitionBytes, resolvedConfig.network));
      setState("waiting");
      startTimeRef.current = Date.now();
      timerIntervalRef.current = setInterval(() => {
        if (!startTimeRef.current) {
          return;
        }
        const elapsed = Date.now() - startTimeRef.current;
        const remaining = Math.max(0, Math.ceil((DEFAULT_REGISTRATION_TIMEOUT_MS - elapsed) / 1e3));
        setRemainingTime(remaining);
        if (remaining === 0) {
          cleanupTimers();
          setError("Request timed out. Please try again.");
          setState("error");
        }
      }, 1e3);
      const checkKeys = async (pendingTransition) => {
        if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
          return;
        }
        try {
          const keysFound = await controller.checkYapprKeysRegistered(
            identityId,
            authPublicKey,
            encryptionPublicKey,
            options.config
          );
          if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
            return;
          }
          if (!keysFound) {
            return;
          }
          cleanup();
          setState("verifying");
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (cancelledRef.current) {
            return;
          }
          setResult({
            authKeyId: pendingTransition.authKeyId,
            encryptionKeyId: pendingTransition.encryptionKeyId
          });
          setState("complete");
          onComplete?.();
        } catch {
        }
      };
      await checkKeys(transition);
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        pollIntervalRef.current = setInterval(() => {
          void checkKeys(transition);
        }, 5e3);
      }
    } catch (err) {
      cleanupTimers();
      if (err instanceof Error) {
        if (err.message === "Cancelled") {
          setState("idle");
          return;
        }
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
      setState("error");
    }
  }, [cleanup, cleanupTimers, controller, onComplete, options.config]);
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    cleanup();
    setState("idle");
    setUri(null);
    setRemainingTime(null);
    setError(null);
    setResult(null);
  }, [cleanup]);
  const retry = useCallback(() => {
    const identityId = identityIdRef.current;
    const authKey = authKeyRef.current;
    const encryptionKey = encryptionKeyRef.current;
    if (identityId && authKey && encryptionKey) {
      start(identityId, new Uint8Array(authKey), new Uint8Array(encryptionKey));
    }
  }, [start]);
  return {
    state,
    uri,
    remainingTime,
    error,
    result,
    start,
    cancel,
    retry
  };
}

// src/react/context.tsx
import { createContext, useContext, useEffect as useEffect2, useMemo, useState as useState2 } from "react";
import { jsx } from "react/jsx-runtime";
var PlatformAuthContext = createContext(void 0);
function PlatformAuthProvider({
  controller,
  children
}) {
  const [state, setState] = useState2(controller.getState());
  useEffect2(() => controller.subscribe(setState), [controller]);
  const value = useMemo(() => ({
    ...state,
    controller,
    restoreSession: controller.restoreSession.bind(controller),
    loginWithAuthKey: controller.loginWithAuthKey.bind(controller),
    loginWithPassword: controller.loginWithPassword.bind(controller),
    loginWithPasskey: controller.loginWithPasskey.bind(controller),
    loginWithLoginKey: controller.loginWithLoginKey.bind(controller),
    createOrUpdateVaultFromLoginKey: controller.createOrUpdateVaultFromLoginKey.bind(controller),
    createOrUpdateVaultFromAuthKey: controller.createOrUpdateVaultFromAuthKey.bind(controller),
    addPasswordAccess: controller.addPasswordAccess.bind(controller),
    addPasskeyAccess: controller.addPasskeyAccess.bind(controller),
    logout: controller.logout.bind(controller),
    setUsername: controller.setUsername.bind(controller),
    refreshUsername: controller.refreshUsername.bind(controller),
    refreshBalance: controller.refreshBalance.bind(controller)
  }), [controller, state]);
  return /* @__PURE__ */ jsx(PlatformAuthContext.Provider, { value, children });
}
function usePlatformAuth() {
  const value = useContext(PlatformAuthContext);
  if (!value) {
    throw new Error("usePlatformAuth must be used within a PlatformAuthProvider");
  }
  return value;
}
export {
  APP_CONNECT_AAD_PREFIX,
  APP_CONNECT_ENVELOPE_BYTES,
  APP_CONNECT_EXPIRY_MARGIN_MS,
  APP_CONNECT_FAST_POLL_MS,
  APP_CONNECT_FAST_POLL_WINDOW_MS,
  APP_CONNECT_HKDF_INFO,
  APP_CONNECT_MAX_AUTH_BINDINGS,
  APP_CONNECT_MAX_BODY_BYTES,
  APP_CONNECT_MAX_CALLBACK_LENGTH,
  APP_CONNECT_MAX_CANDIDATES,
  APP_CONNECT_MAX_ENC_BINDINGS,
  APP_CONNECT_MAX_LABEL_BYTES,
  APP_CONNECT_MAX_REQUEST_AGE_MS,
  APP_CONNECT_MAX_REQUEST_SKEW_MS,
  APP_CONNECT_MAX_R_LENGTH,
  APP_CONNECT_MAX_SLOTS,
  APP_CONNECT_MAX_URI_BYTES,
  APP_CONNECT_NONCE_BYTES,
  APP_CONNECT_PAGE_SIZE,
  APP_CONNECT_REQUEST_VERSION,
  APP_CONNECT_SLOT_BYTES,
  APP_CONNECT_SLOW_POLL_MS,
  AppConnectPayloadError,
  AppConnectRequestError,
  AppConnectTlv,
  DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG,
  KeyPurpose,
  KeySecurityLevel,
  KeyType,
  PlatformAuthController,
  PlatformAuthProvider,
  YAPPR_KEY_EXCHANGE_VERSION,
  YAPPR_NETWORK_IDS,
  YAPPR_STATE_TRANSITION_VERSION,
  appConnectAad,
  appConnectCandidateKey,
  appConnectPollDelayMs,
  appConnectRequestHash,
  appConnectSlotCount,
  authBindingBounds,
  base64urlDecode,
  base64urlEncode,
  boundsEqual,
  buildAppConnectUri,
  buildYapprKeyExchangeUri,
  buildYapprStateTransitionUri,
  checkAppConnectRequestAge,
  classifyAppConnectError,
  clearSensitiveBytes,
  createBrowserSecretStore,
  createPasskeyWithPrf,
  decodeAppConnectRequest,
  decodeYapprContractId,
  decodeYapprIdentityId,
  decryptYapprKeyExchangeResponse,
  decryptYapprLoginKey,
  deriveYapprAuthKeyFromLogin,
  deriveYapprEncryptionKeyFromLogin,
  deriveYapprSharedSecret,
  encBindingBounds,
  encodeAppConnectRequest,
  generatePrfInput,
  generateYapprEphemeralKeyPair,
  getDefaultRpId,
  getPasskeyAllowCredentialIds,
  getPasskeyPrfSupport,
  getPrfAssertionForCredentials,
  getYapprPublicKey,
  hash160,
  listAppConnectCandidates,
  openAppConnectPayload,
  parseAppConnectUri,
  parseYapprKeyExchangeUri,
  parseYapprStateTransitionUri,
  pollForYapprKeyExchangeResponse,
  sealAppConnectPayload,
  selectDiscoverablePasskey,
  serializeYapprKeyExchangeRequest,
  usePlatformAuth,
  useYapprKeyExchangeLogin,
  useYapprKeyRegistration,
  validateAppConnectRequest,
  verifyAppConnectCandidate,
  verifyAppConnectKeys
};
//# sourceMappingURL=index.js.map