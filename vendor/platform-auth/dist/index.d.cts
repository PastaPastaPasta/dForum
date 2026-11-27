import React from 'react';

/**
 * App Connect v2 response encryption:
 *
 *   key  = HKDF-SHA256(ECDH-x(appEph, walletEph), salt "dash:key-exchange:v1", info "app-connect:v2")
 *   aad  = "dash:app-connect:v2" ‖ hash160(appEphPub) ‖ $ownerId
 *   body = nonce(12) ‖ AES-256-GCM(key, nonce, aad, slot₀ ‖ … ‖ slotₙ₋₁) ‖ tag(16)
 *
 * Each slot is a 32-byte private key. The AAD ties the ciphertext to the
 * request and to the identity that publishes it, so a response copied under
 * another identity fails to open.
 */
declare const APP_CONNECT_HKDF_INFO = "app-connect:v2";
declare const APP_CONNECT_AAD_PREFIX = "dash:app-connect:v2";
declare const APP_CONNECT_NONCE_BYTES = 12;
declare const APP_CONNECT_ENVELOPE_BYTES: number;
declare const APP_CONNECT_SLOT_BYTES = 32;
/** The `loginKeyResponse` schema's limit (572-byte payload). */
declare const APP_CONNECT_MAX_SLOTS = 17;
declare class AppConnectPayloadError extends Error {
    readonly code: 'framing' | 'decrypt';
    constructor(code: 'framing' | 'decrypt', message: string);
}
declare function appConnectAad(appEphemeralPubKey: Uint8Array, ownerId: Uint8Array): Uint8Array;
/** Number of key slots a payload of this length holds, or null when the framing is wrong. */
declare function appConnectSlotCount(payloadLength: number): number | null;
interface SealAppConnectPayloadInput {
    appEphemeralPubKey: Uint8Array;
    ownerId: Uint8Array;
    slots: Uint8Array[];
    /** Fresh per response; fixed only for test vectors. */
    walletEphemeralPrivateKey?: Uint8Array;
    /** Random by default; fixed only for test vectors. */
    nonce?: Uint8Array;
}
/** Wallet side: encrypts the granted keys to the app's request. */
declare function sealAppConnectPayload(input: SealAppConnectPayloadInput): Promise<{
    walletEphemeralPubKey: Uint8Array;
    encryptedPayload: Uint8Array;
}>;
interface OpenAppConnectPayloadInput {
    appEphemeralPrivateKey: Uint8Array;
    ownerId: Uint8Array;
    walletEphemeralPubKey: Uint8Array;
    encryptedPayload: Uint8Array;
}
/**
 * App side: checks the framing and the tag, and returns the slots in payload
 * order. The caller owns (and should clear) the returned keys. Throws
 * {@link AppConnectPayloadError}.
 */
declare function openAppConnectPayload(input: OpenAppConnectPayloadInput): Promise<Uint8Array[]>;

/**
 * Consensus errors an App Connect key ring can meet, mapped to what the app
 * should do. Callers extract the numeric code from the SDK error (the app has
 * `consensusCodeOf`) and pass it here.
 */
type AppConnectSigningFailure = 
/** 20013: a bound key signed a non-batch transition. A routing bug; hand off to the wallet. */
'bound-key-non-batch'
/** 20014: a batch member outside the key's bounds. Paid; the selector should make it impossible. */
 | 'out-of-bounds'
/** 20015: the key's budget is spent. */
 | 'allowance-spent'
/** 20016: the key has expired. */
 | 'expired'
/** 40218: this write needs more than the key has left. */
 | 'insufficient-allowance'
/** 20006 / 40208: the key was disabled (revoked in the wallet). */
 | 'key-disabled'
/** 20003: the key is no longer on the identity. */
 | 'key-missing'
/** 20004 / 20007: the key's security level does not meet the transition's (20004 is paid inside a batch). */
 | 'security-level';
/**
 * `renew`: keep the session (reads continue) and ask for a new grant.
 * `logout`: the grant is gone; wipe the session.
 * `handoff`: send this one write to the wallet.
 * `invalidate`: drop cached budgets and bounds, report loudly, show a generic error.
 */
type AppConnectFailureAction = 'renew' | 'logout' | 'handoff' | 'invalidate';
interface AppConnectErrorClassification {
    failure: AppConnectSigningFailure;
    action: AppConnectFailureAction;
    /** Whether the refusal still cost fees (and so budget). */
    paid: boolean;
}
/** The App Connect reading of a consensus code, or null when it is not a key-ring error. */
declare function classifyAppConnectError(code: number | null | undefined): AppConnectErrorClassification | null;

/**
 * Candidate discovery for App Connect. Responses live in the App Connect system
 * contract (`H8F9…`, `loginKeyResponse`), keyed by `appEphemeralPubKeyHash`
 * then `$ownerId`. Anyone can answer a request, so the app pages through every
 * candidate and verifies each one; nothing here decides who logged in.
 */
/** One `loginKeyResponse` entry. */
interface AppConnectCandidate {
    ownerId: string;
    walletEphemeralPubKey: Uint8Array;
    encryptedPayload: Uint8Array;
}
interface AppConnectResponsePort {
    /**
     * Up to `limit` responses with `appEphemeralPubKeyHash == requestHash`,
     * ordered by `$ownerId` ascending, after `startAfter` when given, and only
     * `$ownerId == hint` when a hint is given.
     */
    listCandidates(requestHash: Uint8Array, hint: string | undefined, startAfter: string | undefined, limit: number): Promise<AppConnectCandidate[]>;
}
declare const APP_CONNECT_PAGE_SIZE = 10;
/** Past this many candidates the app stops and asks the user to start again. */
declare const APP_CONNECT_MAX_CANDIDATES = 20;
declare const APP_CONNECT_FAST_POLL_MS = 2000;
declare const APP_CONNECT_SLOW_POLL_MS = 4000;
declare const APP_CONNECT_FAST_POLL_WINDOW_MS = 60000;
interface ListAppConnectCandidatesOptions {
    hint?: string;
    pageSize?: number;
    maxCandidates?: number;
}
/**
 * Pages through every candidate for a request. `truncated` means more than
 * `maxCandidates` exist (spam): the caller should abandon the request.
 */
declare function listAppConnectCandidates(port: AppConnectResponsePort, requestHash: Uint8Array, options?: ListAppConnectCandidatesOptions): Promise<{
    candidates: AppConnectCandidate[];
    truncated: boolean;
}>;
/**
 * Delay before the next poll: every 2 s for the first minute, then every 4 s,
 * and null once the request has expired (10 minutes). Polls on focus or on the
 * wallet's callback happen immediately, outside this cadence.
 */
declare function appConnectPollDelayMs(elapsedMs: number): number | null;
/**
 * Identifies a candidate's exact contents, so a poll loop verifies each
 * response once and notices when an identity republishes a different one.
 */
declare function appConnectCandidateKey(candidate: AppConnectCandidate): string;

type MaybePromise<T> = T | Promise<T>;
type NetworkName = 'testnet' | 'mainnet';
type EncryptionKeyType = 'derived' | 'external';
type VaultSource = 'wallet-derived' | 'direct-key' | 'password-migrated' | 'mixed';
type VaultSecretKind = 'login-key' | 'auth-key';
interface AuthPublicKey {
    id: number;
    type: number;
    purpose: number;
    securityLevel: number;
    security_level?: number;
    disabledAt?: number;
    data?: string | Uint8Array;
}
interface IdentityRecord {
    id: string;
    balance: number;
    publicKeys: AuthPublicKey[];
}
interface AuthUser {
    identityId: string;
    balance: number;
    username?: string;
    publicKeys: AuthPublicKey[];
}
interface AuthSessionSnapshot {
    user: AuthUser;
    timestamp: number;
}
interface AuthVaultBundle {
    version: number;
    identityId: string;
    network: NetworkName;
    secretKind: VaultSecretKind;
    loginKey?: Uint8Array;
    authKeyWif?: string;
    encryptionKeyWif?: string;
    transferKeyWif?: string;
    source: VaultSource;
    updatedAt: number;
}
interface AuthVaultDocumentRef {
    $id: string;
}
interface AuthVaultStatus {
    configured: boolean;
    hasVault: boolean;
    secretKind?: VaultSecretKind;
    hasPasswordAccess: boolean;
    passkeyCount: number;
    hasEncryptionKey: boolean;
    hasTransferKey: boolean;
    updatedAt?: number;
}
interface AuthVaultUnlockResult {
    identityId: string;
    vault: AuthVaultDocumentRef;
    bundle: AuthVaultBundle;
    dek: Uint8Array;
}
interface PasskeyAccess {
    $id: string;
    $ownerId: string;
    label: string;
    credentialId?: Uint8Array;
    credentialIdHash?: Uint8Array;
    prfInput?: Uint8Array;
    rpId?: string;
}
interface PasskeyCredentialDescriptor {
    credentialId: Uint8Array;
    prfInput: Uint8Array;
    rpId: string;
}
interface PasskeyPrfAssertionResult {
    credentialId: Uint8Array;
    credentialIdHash: Uint8Array;
    prfInput: Uint8Array;
    prfOutput: Uint8Array;
    rpId: string;
}
interface DiscoverablePasskeySelectionResult {
    credentialId: Uint8Array;
    credentialIdHash: Uint8Array;
    userHandle?: string;
    rpId: string;
}
interface EnrollPasskeyOptions {
    identityId: string;
    username: string;
    displayName: string;
    label: string;
    rpId?: string;
    rpName?: string;
}
interface SessionStore {
    getSession(): MaybePromise<AuthSessionSnapshot | null>;
    setSession(snapshot: AuthSessionSnapshot): MaybePromise<void>;
    clearSession(): MaybePromise<void>;
}
interface SecretStore {
    storePrivateKey(identityId: string, privateKey: string): MaybePromise<void>;
    getPrivateKey(identityId: string): MaybePromise<string | null>;
    hasPrivateKey(identityId: string): MaybePromise<boolean>;
    clearPrivateKey(identityId: string): MaybePromise<void>;
    storeEncryptionKey(identityId: string, encryptionKey: string): MaybePromise<void>;
    getEncryptionKey(identityId: string): MaybePromise<string | null>;
    hasEncryptionKey(identityId: string): MaybePromise<boolean>;
    clearEncryptionKey(identityId: string): MaybePromise<void>;
    storeEncryptionKeyType(identityId: string, type: EncryptionKeyType): MaybePromise<void>;
    clearEncryptionKeyType(identityId: string): MaybePromise<void>;
    storeTransferKey(identityId: string, transferKey: string): MaybePromise<void>;
    getTransferKey(identityId: string): MaybePromise<string | null>;
    clearTransferKey(identityId: string): MaybePromise<void>;
    storeLoginKey(identityId: string, loginKey: Uint8Array): MaybePromise<void>;
    getLoginKey(identityId: string): MaybePromise<Uint8Array | null>;
    clearLoginKey(identityId: string): MaybePromise<void>;
    storeAuthVaultDek(identityId: string, dek: Uint8Array): MaybePromise<void>;
    getAuthVaultDek(identityId: string): MaybePromise<Uint8Array | null>;
    clearAuthVaultDek(identityId: string): MaybePromise<void>;
}
interface IdentityPort {
    getIdentity(identityId: string): Promise<IdentityRecord | null>;
    getBalance(identityId: string): Promise<number>;
    clearCache?(identityId: string): MaybePromise<void>;
}
interface UsernamePort {
    resolveUsername(identityId: string): Promise<string | null>;
    resolveIdentity(identityOrUsername: string): Promise<string | null>;
    clearCache?(username?: string, identityId?: string): MaybePromise<void>;
}
interface ProfilePort {
    hasProfile(identityId: string, username?: string): Promise<boolean>;
}
interface ClientIdentityPort {
    setIdentity(identityId: string): MaybePromise<void>;
}
interface SideEffectsPort {
    runPostLogin(identityId: string, context: {
        delayMs: number;
        isSessionActive: () => boolean;
    }): MaybePromise<void>;
    runLogoutCleanup?(identityId: string): MaybePromise<void>;
}
interface LegacyPasswordLoginPort {
    kind: string;
    isConfigured(): boolean;
    loginWithPassword(identityOrUsername: string, password: string): Promise<{
        identityId: string;
        privateKey: string;
    }>;
}
interface PasskeyPort {
    getDefaultRpId(): string;
    createPasskeyWithPrf(options: EnrollPasskeyOptions): Promise<PasskeyPrfAssertionResult & {
        label: string;
    }>;
    getPrfAssertionForCredentials(credentials: PasskeyCredentialDescriptor[]): Promise<PasskeyPrfAssertionResult>;
    selectDiscoverablePasskey(rpId?: string): Promise<DiscoverablePasskeySelectionResult>;
}
interface PlatformAuthCryptoPort {
    parsePrivateKey(privateKeyWif: string): {
        privateKey: Uint8Array;
    };
    privateKeyToWif(privateKey: Uint8Array, network: NetworkName, compressed: boolean): string;
    deriveEncryptionKey(authPrivateKey: Uint8Array, identityId: string): Uint8Array;
    validateDerivedKeyMatchesIdentity(derivedKey: Uint8Array, identityId: string): Promise<boolean>;
    identityHasEncryptionKey(publicKeys: AuthPublicKey[]): boolean;
    decodeIdentityId(identityId: string): Uint8Array;
    deriveAuthKeyFromLogin(loginKey: Uint8Array, identityIdBytes: Uint8Array): Uint8Array;
    deriveEncryptionKeyFromLogin(loginKey: Uint8Array, identityIdBytes: Uint8Array): Uint8Array;
}
type YapprKeyExchangeNetworkName = NetworkName | 'devnet';
interface YapprKeyExchangeConfig {
    appContractId: string;
    keyExchangeContractId: string;
    network: YapprKeyExchangeNetworkName;
    label: string;
    pollIntervalMs: number;
    timeoutMs: number;
}
interface YapprKeyExchangeResponse {
    $id: string;
    $ownerId: string;
    $revision: number;
    contractId: Uint8Array;
    appEphemeralPubKeyHash: Uint8Array;
    walletEphemeralPubKey: Uint8Array;
    encryptedPayload: Uint8Array;
    keyIndex: number;
}
interface YapprDecryptedKeyExchangeResult {
    loginKey: Uint8Array;
    keyIndex: number;
    walletEphemeralPubKey: Uint8Array;
    identityId: string;
}
interface YapprKeyRegistrationRequest {
    identityId: string;
    authPrivateKey: Uint8Array;
    authPublicKey: Uint8Array;
    encryptionPrivateKey: Uint8Array;
    encryptionPublicKey: Uint8Array;
}
interface YapprUnsignedKeyRegistrationResult {
    transitionBytes: Uint8Array;
    authKeyId: number;
    encryptionKeyId: number;
    identityRevision: bigint;
}
interface YapprKeyExchangePort {
    getResponse(contractIdBytes: Uint8Array, appEphemeralPubKeyHash: Uint8Array): Promise<YapprKeyExchangeResponse | null>;
    buildUnsignedKeyRegistrationTransition(request: YapprKeyRegistrationRequest): Promise<YapprUnsignedKeyRegistrationResult>;
    checkKeysRegistered(identityId: string, authPublicKey: Uint8Array, encryptionPublicKey: Uint8Array): Promise<boolean>;
}
interface UnifiedVaultPort {
    isConfigured(): boolean;
    getStatus(identityId: string): Promise<AuthVaultStatus>;
    hasVault(identityId: string): Promise<boolean>;
    resolveIdentityId(identityOrUsername: string): Promise<string | null>;
    createOrUpdateVaultBundle(identityId: string, bundle: AuthVaultBundle, dek?: Uint8Array): Promise<AuthVaultUnlockResult>;
    mergeSecrets(identityId: string, dek: Uint8Array, partialSecrets: {
        loginKey?: Uint8Array;
        authKeyWif?: string;
        encryptionKeyWif?: string;
        transferKeyWif?: string;
        source?: VaultSource;
    }): Promise<AuthVaultUnlockResult | null>;
    unlockWithPassword(identityOrUsername: string, password: string): Promise<AuthVaultUnlockResult>;
    unlockWithPrf(identityId: string, access: PasskeyAccess, prfOutput: Uint8Array): Promise<AuthVaultUnlockResult>;
    getPasskeyAccesses(identityId: string): Promise<PasskeyAccess[]>;
    addPasswordAccess(identityId: string, input: {
        vaultId: string;
        dek: Uint8Array;
        password: string;
        iterations: number;
        label: string;
    }): Promise<void>;
    addPasskeyAccess(identityId: string, input: {
        vaultId: string;
        dek: Uint8Array;
        passkey: PasskeyPrfAssertionResult & {
            label: string;
        };
    }): Promise<void>;
}
interface PlatformAuthFeatures {
    usernameGate: boolean;
    profileGate: boolean;
    passwordLogin: boolean;
    passkeyLogin: boolean;
    keyExchangeLogin: boolean;
    authVault: boolean;
    legacyPasswordLogin: boolean;
    autoDeriveEncryptionKey: boolean;
    postLoginTasks: boolean;
    balanceRefresh: boolean;
}
interface PlatformAuthState {
    user: AuthUser | null;
    isLoading: boolean;
    isAuthRestoring: boolean;
    error: string | null;
}
type PlatformAuthIntent = {
    kind: 'ready';
    identityId: string;
} | {
    kind: 'username-required';
    identityId: string;
} | {
    kind: 'profile-required';
    identityId: string;
    username?: string;
} | {
    kind: 'logged-out';
};
interface PlatformAuthResult {
    user: AuthUser | null;
    intent: PlatformAuthIntent;
}
type PlatformAuthEvent = {
    type: 'session-restored';
    user: AuthUser;
} | {
    type: 'login-succeeded';
    user: AuthUser;
} | {
    type: 'username-required';
    identityId: string;
} | {
    type: 'profile-required';
    identityId: string;
    username?: string;
} | {
    type: 'logout';
    identityId?: string;
} | {
    type: 'background-error';
    operation: string;
    error: unknown;
};
interface PlatformAuthLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
interface PlatformAuthDependencies {
    network: NetworkName;
    sessionStore: SessionStore;
    secretStore: SecretStore;
    identity: IdentityPort;
    usernames?: UsernamePort;
    profiles?: ProfilePort;
    clientIdentity?: ClientIdentityPort;
    sideEffects?: SideEffectsPort;
    crypto?: PlatformAuthCryptoPort;
    yapprKeyExchange?: YapprKeyExchangePort;
    yapprKeyExchangeConfig?: Partial<YapprKeyExchangeConfig>;
    vault?: UnifiedVaultPort;
    passkeys?: PasskeyPort;
    legacyPasswordLogins?: LegacyPasswordLoginPort[];
    features?: Partial<PlatformAuthFeatures>;
    balanceRefreshMs?: number;
    now?: () => number;
    logger?: PlatformAuthLogger;
    onEvent?: (event: PlatformAuthEvent) => MaybePromise<void>;
}

/**
 * Platform identity-key vocabulary shared by the App Connect modules. Numbers
 * match Platform's encodings (`Purpose`, `SecurityLevel`, `KeyType`), so keys
 * read through the SDK can be passed through without translation.
 */
declare const KeyPurpose: {
    readonly AUTHENTICATION: 0;
    readonly ENCRYPTION: 1;
    readonly DECRYPTION: 2;
    readonly TRANSFER: 3;
};
declare const KeySecurityLevel: {
    readonly MASTER: 0;
    readonly CRITICAL: 1;
    readonly HIGH: 2;
    readonly MEDIUM: 3;
};
declare const KeyType: {
    readonly ECDSA_SECP256K1: 0;
    readonly ECDSA_HASH160: 2;
};
/** `contractBounds` of an identity key; ids are base58. */
type AppConnectKeyBounds = {
    kind: 'singleContract';
    contractId: string;
} | {
    kind: 'documentType';
    contractId: string;
    documentTypeName: string;
} | {
    kind: 'contractGroup';
    groupId: string;
};
/** An identity public key as the verifier needs it (V0 or V1). */
interface AppConnectIdentityKey {
    id: number;
    type: number;
    purpose: number;
    securityLevel: number;
    /** 33-byte compressed point (ECDSA_SECP256K1) or 20-byte hash160 (ECDSA_HASH160). */
    data: Uint8Array;
    disabledAt?: number;
    bounds?: AppConnectKeyBounds;
    /** V1 limit: lifetime credit budget. */
    totalBudget?: bigint;
    /** V1 limit: block time (ms) from which the key can no longer sign. */
    expiresAt?: number;
}
/** One member of a contract group; ids are base58. */
type AppConnectGroupMember = {
    kind: 'contract';
    contractId: string;
} | {
    kind: 'documentType';
    contractId: string;
    documentTypeName: string;
} | {
    kind: 'token';
    contractId: string;
    position: number;
};
/** A group whose members are pinned in the app's config (and checked against chain before use). */
interface PinnedGroup {
    groupId: string;
    members: AppConnectGroupMember[];
}
interface AppConnectGroupInfo {
    ownerId: string;
    adminIds: string[];
    members: AppConnectGroupMember[];
}
/**
 * Reads the app needs to verify a grant. Every read should be proved, and
 * `getIdentityFresh` must bypass any identity cache: a key added moments ago is
 * exactly what is being checked.
 */
interface AppConnectIdentityPort {
    getIdentityFresh(identityId: string): Promise<{
        id: string;
        publicKeys: AppConnectIdentityKey[];
    } | null>;
    /** Remaining credits per key id; a key without a budget is absent or undefined. */
    remainingBudgets(identityId: string, keyIds: number[]): Promise<Map<number, bigint | undefined>>;
    /** The keys Platform currently resolves for `contractId` and `purpose` (`identities.contractKeys`). */
    contractKeys(identityId: string, contractId: string, purpose: number): Promise<AppConnectIdentityKey[]>;
    /** The whole group (the port pages the members), or null when it does not exist. */
    groupInfo(groupId: string): Promise<AppConnectGroupInfo | null>;
}
declare function boundsEqual(a: AppConnectKeyBounds, b: AppConnectKeyBounds): boolean;

/**
 * App Connect request v2 (docs/APP_CONNECT_PROFILE.md):
 *
 *   body = 0x02 ‖ appEphPub(33) ‖ appId(32) ‖ labelLen(1) ‖ label ‖ TLV*
 *   TLV  = type(1) ‖ len(1) ‖ value
 *   uri  = dashpay://connect?v=2&n=<m|t|d>&r=<base64url(body)>[&cb=<https URL>]
 *          (the transitional carrier, testnet and devnet only:
 *           dash-key:<base58(body)>?n=<m|t|d>&v=2[&cb=<https URL>])
 *
 * Local divergence from upstream platform-auth: the dashpay://connect carrier
 * and the canonical base64url codec follow DIP dashpay/dips#181.
 *
 * Even TLV types must be understood (a decoder refuses unknown ones); odd
 * types are optional and unknown ones are skipped. TLVs appear in ascending
 * type order and only AUTH_BINDING and ENC_BINDING repeat, so every request
 * has exactly one encoding.
 */
declare const APP_CONNECT_REQUEST_VERSION = 2;
declare const APP_CONNECT_MAX_LABEL_BYTES = 64;
declare const APP_CONNECT_MAX_AUTH_BINDINGS = 4;
declare const APP_CONNECT_MAX_ENC_BINDINGS = 2;
declare const APP_CONNECT_MAX_CALLBACK_LENGTH = 512;
/** A wallet refuses a request created longer ago than this... */
declare const APP_CONNECT_MAX_REQUEST_AGE_MS: number;
/** ...or further in the future than this (clock skew). */
declare const APP_CONNECT_MAX_REQUEST_SKEW_MS: number;
declare const AppConnectTlv: {
    readonly IDENTITY_HINT: 1;
    readonly AUTH_BINDING: 2;
    readonly CONNECTION_ID: 3;
    readonly ENC_BINDING: 4;
    readonly MODE: 5;
    readonly CREATED_AT: 6;
};
/** Wire tags of AUTH_BINDING kinds; equal to Platform's `ContractBounds` bincode tags. */
declare const BINDING_KIND_TAGS: {
    readonly singleContract: 0;
    readonly documentType: 1;
    readonly contractGroup: 2;
};
type AppConnectBindingKind = keyof typeof BINDING_KIND_TAGS;
/** Absent means login; MODE carries only renew. */
type AppConnectMode = 'renew';
interface AppConnectAuthBinding {
    kind: AppConnectBindingKind;
    /** Contract id, or the group id for `contractGroup`. */
    id: Uint8Array;
    /** Required for `documentType`, absent otherwise. */
    documentTypeName?: string;
    /** CRITICAL only on `contractGroup`; HIGH everywhere. */
    securityLevel: number;
    /** Proposed lifetime budget in credits; mandatory on `contractGroup`. Zero on the wire means none. */
    totalBudget?: bigint;
    /** Proposed expiry, block time in ms. Zero on the wire means none. */
    expiresAt?: number;
}
interface AppConnectEncBinding {
    contractId: Uint8Array;
    /** ENCRYPTION or DECRYPTION. */
    purpose: number;
}
interface AppConnectRequest {
    appEphemeralPubKey: Uint8Array;
    appId: Uint8Array;
    label: string;
    /** 1–4; the first is the primary binding a wallet may not decline on its own. */
    authBindings: AppConnectAuthBinding[];
    encBindings: AppConnectEncBinding[];
    /** ms since epoch. */
    createdAt: number;
    identityHint?: Uint8Array;
    connectionId?: Uint8Array;
    mode?: AppConnectMode;
}
interface ParsedAppConnectUri {
    request: AppConnectRequest;
    requestBytes: Uint8Array;
    network: YapprKeyExchangeNetworkName;
    callbackUrl?: string;
}
/**
 * `unsupported`: a version or mandatory field this decoder does not know (a
 * newer app); `invalid`: anything else that breaks the format.
 */
type AppConnectRequestErrorCode = 'unsupported' | 'invalid';
declare class AppConnectRequestError extends Error {
    readonly code: AppConnectRequestErrorCode;
    constructor(code: AppConnectRequestErrorCode, message: string);
}
/** `hash160(appEphPub)`: the `appEphemeralPubKeyHash` responses are stored under. */
declare function appConnectRequestHash(request: Pick<AppConnectRequest, 'appEphemeralPubKey'>): Uint8Array;
/** The key bounds an auth binding asks for, with base58 ids. */
declare function authBindingBounds(binding: AppConnectAuthBinding): AppConnectKeyBounds;
/** The key bounds an encryption binding asks for: `singleContract` on its contract. */
declare function encBindingBounds(binding: AppConnectEncBinding): AppConnectKeyBounds;
/**
 * Checks the protocol rules every request obeys, whoever built it. The encoder
 * runs it before writing and the decoder after reading, so neither side can
 * produce or accept a request the other would refuse.
 */
declare function validateAppConnectRequest(request: AppConnectRequest): void;
declare function encodeAppConnectRequest(request: AppConnectRequest): Uint8Array;
declare function decodeAppConnectRequest(bytes: Uint8Array): AppConnectRequest;
/** Canonical base64url (RFC 4648 section 5) without padding. */
declare function base64urlEncode(bytes: Uint8Array): string;
/**
 * Decodes canonical base64url. Refuses `=`, `+`, `/`, any other character
 * outside the alphabet, a length of 1 mod 4 and non-zero trailing bits, so
 * every value has exactly one encoding.
 */
declare function base64urlDecode(text: string): Uint8Array;
/**
 * Which URI wraps the request: `dashpay://connect` (DIP: App Connect, required
 * on mainnet) or the transitional `dash-key:` (testnet and devnet only).
 */
type AppConnectCarrier = 'dashpay' | 'dash-key';
declare const APP_CONNECT_MAX_URI_BYTES = 4096;
declare const APP_CONNECT_MAX_R_LENGTH = 1366;
declare const APP_CONNECT_MAX_BODY_BYTES = 1024;
declare function buildAppConnectUri(request: AppConnectRequest, network: YapprKeyExchangeNetworkName, callbackUrl?: string, carrier?: AppConnectCarrier): string;
/**
 * Parses an App Connect v2 URI: `dashpay://connect?...` or the transitional
 * `dash-key:<base58>?...` (refused when `n=m`). Throws
 * {@link AppConnectRequestError}; a v1 URI is `unsupported` here (it belongs to
 * the legacy key exchange).
 */
declare function parseAppConnectUri(uri: string): ParsedAppConnectUri;
/**
 * The wallet's freshness rule: `stale` when created more than 10 minutes
 * before `now`, `future` when more than 2 minutes after it.
 */
declare function checkAppConnectRequestAge(createdAt: number, now: number): 'stale' | 'future' | null;

/** A granted key must stay valid this long past `now` to be accepted. */
declare const APP_CONNECT_EXPIRY_MARGIN_MS: number;
type AppConnectRejectReason = 
/** The request named an identity and the candidate is someone else. */
'hint-mismatch' | 'framing'
/** Wrong request, wrong owner (a copied response) or tampered ciphertext. */
 | 'decrypt' | 'invalid-key' | 'identity-not-found'
/** A slot's key is not on the candidate identity (yet). */
 | 'key-not-found' | 'key-disabled' | 'key-master' | 'key-purpose' | 'key-type' | 'key-unbound'
/** Bound to something the request did not ask for (foreign contract, wrong group or document type). */
 | 'key-unmatched' | 'key-level'
/** Missing the budget or expiry the request asked for, or the group key's mandatory budget. */
 | 'key-limits' | 'key-expired' | 'budget-exhausted'
/** Platform returned no remaining budget for a budgeted key (a lagging read). */
 | 'budget-unknown' | 'encryption-key-not-current' | 'duplicate-binding' | 'primary-missing';
type AppConnectKeyRole = 'singleContract' | 'documentType' | 'contractGroup' | 'encryption' | 'decryption';
interface AppConnectGrantedKey {
    role: AppConnectKeyRole;
    /** Position of the matching binding in `authBindings` or `encBindings`. */
    bindingIndex: number;
    privateKey: Uint8Array;
    key: AppConnectIdentityKey;
    remainingBudget?: bigint;
}
interface AppConnectGrant {
    identityId: string;
    authKeys: AppConnectGrantedKey[];
    encryptionKeys: AppConnectGrantedKey[];
}
type AppConnectVerification = {
    ok: true;
    grant: AppConnectGrant;
}
/** `retryable`: the identity read may lag the wallet's update; check again shortly. */
 | {
    ok: false;
    reason: AppConnectRejectReason;
    retryable: boolean;
    slot?: number;
};
interface VerifyAppConnectCandidateInput {
    request: AppConnectRequest;
    appEphemeralPrivateKey: Uint8Array;
    candidate: AppConnectCandidate;
    identity: AppConnectIdentityPort;
    /** Latest block time (ms), or the wall clock when that is unavailable. */
    now: number;
    expiryMarginMs?: number;
}
/**
 * Verifies one `loginKeyResponse` candidate against the request it answers.
 * Accepts only if every slot is a live key on the candidate's `$ownerId` that
 * matches one requested binding exactly (bounds, purpose, level, limits), the
 * primary binding is granted, no key is about to expire or out of budget, and
 * each encryption key is the one Platform currently resolves for its contract.
 * Anything else rejects the whole candidate; there is no partial accept of a
 * response that contains a key the app did not ask for.
 *
 * `ok: true` means a valid grant from `grant.identityId`, not that this is the
 * user: anyone can answer a request with their own identity. Without an
 * identity hint the app must still ask "Continue as @name?".
 */
declare function verifyAppConnectCandidate(input: VerifyAppConnectCandidateInput): Promise<AppConnectVerification>;
/** What a grant is checked against, whether its keys came from a wallet's answer or were kept from one. */
interface VerifyContext {
    request: Pick<AppConnectRequest, 'authBindings' | 'encBindings'>;
    ownerId: string;
    identity: AppConnectIdentityPort;
    now: number;
    expiryMarginMs?: number;
}
interface VerifyAppConnectKeysInput extends VerifyContext {
    /** The private keys of one earlier grant, in any order; wiped when they are refused. */
    privateKeys: Uint8Array[];
}
/**
 * Verifies private keys an app kept from an earlier grant (Yappr's passkey
 * vault) exactly as {@link verifyAppConnectCandidate} verifies a wallet's
 * answer, against the request the app makes today: every key must still be
 * a live key of `ownerId` that matches one binding (bounds, purpose, level,
 * limits), the primary binding must be there, and nothing may be expired,
 * spent or superseded. A refusal says why, so an expired or spent grant can
 * lead to a renewal in the wallet rather than a dead session.
 */
declare function verifyAppConnectKeys(input: VerifyAppConnectKeysInput): Promise<AppConnectVerification>;

declare function getDefaultRpId(): string;
declare function createPasskeyWithPrf(options: EnrollPasskeyOptions): Promise<PasskeyPrfAssertionResult & {
    label: string;
}>;
declare function getPrfAssertionForCredentials(credentials: PasskeyCredentialDescriptor[]): Promise<PasskeyPrfAssertionResult>;
declare function selectDiscoverablePasskey(rpId?: string): Promise<DiscoverablePasskeySelectionResult>;
declare function getPasskeyAllowCredentialIds(credentials: PasskeyCredentialDescriptor[]): Uint8Array[];

type PasskeyPlatformHint = 'apple' | 'android' | 'windows' | 'desktop-other' | 'unknown';
interface PasskeyPrfSupport {
    webauthnAvailable: boolean;
    conditionalUiAvailable: boolean;
    likelyPrfCapable: boolean;
    platformHint: PasskeyPlatformHint;
    blockedReason?: string;
}
declare function getPasskeyPrfSupport(): Promise<PasskeyPrfSupport>;

interface BrowserSecretStoreCrypto {
    parsePrivateKey(privateKey: string): {
        privateKey: Uint8Array;
    };
    privateKeyToWif(privateKey: Uint8Array, network: NetworkName, compressed: boolean): string;
    isLikelyWif(value: string): boolean;
}
interface BrowserSecretStoreOptions {
    prefix?: string;
    network: NetworkName;
    crypto: BrowserSecretStoreCrypto;
}
type BrowserStoredKeyType = EncryptionKeyType;
declare class BrowserStorage {
    private readonly prefix;
    constructor(prefix: string);
    private getKeysWithPrefix;
    private getStorage;
    private getLegacyStorage;
    private isAvailable;
    set(key: string, value: unknown): void;
    get(key: string): unknown;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    keys(): string[];
    size(): number;
}
declare function generatePrfInput(): Uint8Array;
declare function createBrowserSecretStore(options: BrowserSecretStoreOptions): {
    secureStorage: BrowserStorage;
    storePrivateKey: (identityId: string, privateKey: string) => void;
    getPrivateKey: (identityId: string) => string | null;
    clearPrivateKey: (identityId: string) => boolean;
    hasPrivateKey: (identityId: string) => boolean;
    clearAllPrivateKeys: () => void;
    storeLoginKey: (identityId: string, loginKey: Uint8Array) => void;
    getLoginKey: (identityId: string) => string | null;
    getLoginKeyBytes: (identityId: string) => Uint8Array | null;
    hasLoginKey: (identityId: string) => boolean;
    clearLoginKey: (identityId: string) => boolean;
    storeAuthVaultDek: (identityId: string, dek: Uint8Array) => void;
    getAuthVaultDek: (identityId: string) => string | null;
    getAuthVaultDekBytes: (identityId: string) => Uint8Array | null;
    hasAuthVaultDek: (identityId: string) => boolean;
    clearAuthVaultDek: (identityId: string) => boolean;
    storeEncryptionKey: (identityId: string, encryptionKey: string) => void;
    getEncryptionKey: (identityId: string) => string | null;
    getEncryptionKeyBytes: (identityId: string) => Uint8Array | null;
    hasEncryptionKey: (identityId: string) => boolean;
    clearEncryptionKey: (identityId: string) => boolean;
    storeEncryptionKeyType: (identityId: string, type: BrowserStoredKeyType) => void;
    getEncryptionKeyType: (identityId: string) => BrowserStoredKeyType | null;
    clearEncryptionKeyType: (identityId: string) => boolean;
    storeTransferKey: (identityId: string, transferKey: string) => void;
    getTransferKey: (identityId: string) => string | null;
    getTransferKeyBytes: (identityId: string) => Uint8Array | null;
    hasTransferKey: (identityId: string) => boolean;
    clearTransferKey: (identityId: string) => boolean;
};

declare class PlatformAuthController {
    private readonly deps;
    private readonly features;
    private readonly listeners;
    private readonly logger;
    private readonly balanceRefreshMs;
    private state;
    private balanceInterval;
    constructor(deps: PlatformAuthDependencies);
    getState(): PlatformAuthState;
    subscribe(listener: (state: PlatformAuthState) => void): () => void;
    dispose(): void;
    getYapprKeyExchangeConfig(overrides?: Partial<YapprKeyExchangeConfig>): YapprKeyExchangeConfig;
    pollYapprKeyExchangeResponse(appEphemeralPubKeyHash: Uint8Array, appEphemeralPrivateKey: Uint8Array, overrides?: Partial<YapprKeyExchangeConfig>, options?: {
        signal?: AbortSignal;
        onPoll?: () => void;
    }): Promise<YapprDecryptedKeyExchangeResult>;
    checkYapprKeysRegistered(identityId: string, authPublicKey: Uint8Array, encryptionPublicKey: Uint8Array, overrides?: Partial<YapprKeyExchangeConfig>): Promise<boolean>;
    buildYapprUnsignedKeyRegistrationTransition(request: YapprKeyRegistrationRequest, overrides?: Partial<YapprKeyExchangeConfig>): Promise<YapprUnsignedKeyRegistrationResult>;
    completeYapprKeyExchangeLogin(input: {
        identityId: string;
        loginKey: Uint8Array;
        keyIndex: number;
    }): Promise<PlatformAuthResult>;
    restoreSession(): Promise<AuthUser | null>;
    loginWithAuthKey(identityId: string, privateKey: string, options?: {
        skipUsernameCheck?: boolean;
    }): Promise<PlatformAuthResult>;
    loginWithPassword(identityOrUsername: string, password: string): Promise<PlatformAuthResult>;
    loginWithPasskey(identityOrUsername?: string): Promise<PlatformAuthResult>;
    loginWithLoginKey(identityId: string, loginKey: Uint8Array, keyIndex: number): Promise<PlatformAuthResult>;
    createOrUpdateVaultFromLoginKey(identityId: string, loginKey: Uint8Array): Promise<AuthVaultUnlockResult>;
    createOrUpdateVaultFromAuthKey(identityId: string, authKeyWif: string): Promise<AuthVaultUnlockResult>;
    mergeSecretsIntoVault(identityId: string, partialSecrets: {
        loginKey?: Uint8Array;
        authKeyWif?: string;
        encryptionKeyWif?: string;
        transferKeyWif?: string;
        source?: VaultSource;
    }): Promise<AuthVaultUnlockResult | null>;
    addPasswordAccess(password: string, iterations: number, label?: string): Promise<void>;
    addPasskeyAccess(label?: string): Promise<void>;
    logout(): Promise<PlatformAuthResult>;
    refreshUsername(): Promise<void>;
    setUsername(username: string): Promise<void>;
    refreshBalance(): Promise<void>;
    private backfillUsername;
    private ensureVaultForCurrentSession;
    private restoreUnlockedVaultSession;
    private tryAutoDeriveEncryptionKey;
    private runPostLoginTasks;
    private startBalanceRefresh;
    private stopBalanceRefresh;
    private requireYapprKeyExchange;
    private requireUser;
    private isSessionActive;
    private persistSessionUser;
    private updateSessionUser;
    private patchState;
    private now;
    private emit;
}

type YapprKeyExchangeState = 'idle' | 'generating' | 'waiting' | 'decrypting' | 'checking' | 'registering' | 'complete' | 'error' | 'timeout';
interface YapprKeyExchangeLoginResult {
    loginKey: Uint8Array;
    authKey: Uint8Array;
    encryptionKey: Uint8Array;
    keyIndex: number;
    needsKeyRegistration: boolean;
    identityId: string;
}
interface StartYapprKeyExchangeOptions {
    label?: string;
}
interface UseYapprKeyExchangeLoginReturn {
    state: YapprKeyExchangeState;
    uri: string | null;
    remainingTime: number | null;
    keyIndex: number;
    needsKeyRegistration: boolean;
    error: string | null;
    result: YapprKeyExchangeLoginResult | null;
    start: (options?: StartYapprKeyExchangeOptions) => void;
    cancel: () => void;
    retry: () => void;
}
type YapprKeyRegistrationState = 'idle' | 'building' | 'waiting' | 'verifying' | 'complete' | 'error';
interface YapprKeyRegistrationResult {
    authKeyId: number;
    encryptionKeyId: number;
}
interface UseYapprKeyRegistrationReturn {
    state: YapprKeyRegistrationState;
    uri: string | null;
    remainingTime: number | null;
    error: string | null;
    result: YapprKeyRegistrationResult | null;
    start: (identityId: string, authKey: Uint8Array, encryptionKey: Uint8Array) => void;
    cancel: () => void;
    retry: () => void;
}
interface UseYapprKeyExchangeOptions {
    config?: Partial<YapprKeyExchangeConfig>;
}
declare function useYapprKeyExchangeLogin(controller: PlatformAuthController, options?: UseYapprKeyExchangeOptions): UseYapprKeyExchangeLoginReturn;
declare function useYapprKeyRegistration(controller: PlatformAuthController, onComplete?: () => void, options?: UseYapprKeyExchangeOptions): UseYapprKeyRegistrationReturn;

declare const YAPPR_KEY_EXCHANGE_VERSION = 1;
declare const YAPPR_STATE_TRANSITION_VERSION = 1;
declare const YAPPR_NETWORK_IDS: {
    readonly mainnet: "m";
    readonly testnet: "t";
    readonly devnet: "d";
};
declare const DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG: Pick<YapprKeyExchangeConfig, 'label' | 'pollIntervalMs' | 'timeoutMs'>;
interface YapprKeyExchangeRequest {
    appEphemeralPubKey: Uint8Array;
    contractId: Uint8Array;
    label?: string;
}
interface YapprEphemeralKeyPair {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
}
interface PollForYapprKeyExchangeResponseOptions {
    pollIntervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onPoll?: () => void;
    logger?: PlatformAuthLogger;
}
declare function hash160(data: Uint8Array): Uint8Array;
declare function generateYapprEphemeralKeyPair(): YapprEphemeralKeyPair;
/**
 * ECDH x-coordinate → HKDF-SHA256 (salt `dash:key-exchange:v1`). ECDH is
 * symmetric, so the wallet calls this with its private key and the app's
 * public key. The legacy key exchange uses an empty `info`; App Connect v2
 * passes `app-connect:v2`.
 */
declare function deriveYapprSharedSecret(appEphemeralPrivateKey: Uint8Array, walletEphemeralPublicKey: Uint8Array, info?: Uint8Array): Uint8Array;
declare function decryptYapprLoginKey(encryptedPayload: Uint8Array, sharedSecret: Uint8Array): Promise<Uint8Array>;
declare function deriveYapprAuthKeyFromLogin(loginKey: Uint8Array, identityIdBytes: Uint8Array): Uint8Array;
declare function deriveYapprEncryptionKeyFromLogin(loginKey: Uint8Array, identityIdBytes: Uint8Array): Uint8Array;
declare function getYapprPublicKey(privateKey: Uint8Array): Uint8Array;
declare function clearSensitiveBytes(bytes: Uint8Array): void;
declare function decodeYapprIdentityId(identityIdBase58: string): Uint8Array;
declare function decodeYapprContractId(contractIdBase58: string): Uint8Array;
declare function serializeYapprKeyExchangeRequest(request: YapprKeyExchangeRequest): Uint8Array;
declare function buildYapprKeyExchangeUri(request: YapprKeyExchangeRequest, network?: YapprKeyExchangeNetworkName): string;
declare function parseYapprKeyExchangeUri(uri: string): {
    request: YapprKeyExchangeRequest;
    network: YapprKeyExchangeNetworkName;
    version: number;
} | null;
declare function buildYapprStateTransitionUri(transitionBytes: Uint8Array, network?: YapprKeyExchangeNetworkName): string;
declare function parseYapprStateTransitionUri(uri: string): {
    transitionBytes: Uint8Array;
    network: YapprKeyExchangeNetworkName;
    version: number;
} | null;
declare function pollForYapprKeyExchangeResponse(port: YapprKeyExchangePort, contractIdBytes: Uint8Array, appEphemeralPubKeyHash: Uint8Array, appEphemeralPrivateKey: Uint8Array, options?: PollForYapprKeyExchangeResponseOptions): Promise<YapprDecryptedKeyExchangeResult>;
declare function decryptYapprKeyExchangeResponse(response: YapprKeyExchangeResponse, appEphemeralPrivateKey: Uint8Array): Promise<YapprDecryptedKeyExchangeResult>;

interface PlatformAuthContextValue extends PlatformAuthState {
    controller: PlatformAuthController;
    restoreSession(): Promise<AuthUser | null>;
    loginWithAuthKey(identityId: string, privateKey: string, options?: {
        skipUsernameCheck?: boolean;
    }): Promise<PlatformAuthResult>;
    loginWithPassword(identityOrUsername: string, password: string): Promise<PlatformAuthResult>;
    loginWithPasskey(identityOrUsername?: string): Promise<PlatformAuthResult>;
    loginWithLoginKey(identityId: string, loginKey: Uint8Array, keyIndex: number): Promise<PlatformAuthResult>;
    createOrUpdateVaultFromLoginKey(identityId: string, loginKey: Uint8Array): Promise<AuthVaultUnlockResult>;
    createOrUpdateVaultFromAuthKey(identityId: string, authKeyWif: string): Promise<AuthVaultUnlockResult>;
    addPasswordAccess(password: string, iterations: number, label?: string): Promise<void>;
    addPasskeyAccess(label?: string): Promise<void>;
    logout(): Promise<PlatformAuthResult>;
    setUsername(username: string): Promise<void>;
    refreshUsername(): Promise<void>;
    refreshBalance(): Promise<void>;
}
declare function PlatformAuthProvider({ controller, children, }: {
    controller: PlatformAuthController;
    children: React.ReactNode;
}): JSX.Element;
declare function usePlatformAuth(): PlatformAuthContextValue;

export { APP_CONNECT_AAD_PREFIX, APP_CONNECT_ENVELOPE_BYTES, APP_CONNECT_EXPIRY_MARGIN_MS, APP_CONNECT_FAST_POLL_MS, APP_CONNECT_FAST_POLL_WINDOW_MS, APP_CONNECT_HKDF_INFO, APP_CONNECT_MAX_AUTH_BINDINGS, APP_CONNECT_MAX_BODY_BYTES, APP_CONNECT_MAX_CALLBACK_LENGTH, APP_CONNECT_MAX_CANDIDATES, APP_CONNECT_MAX_ENC_BINDINGS, APP_CONNECT_MAX_LABEL_BYTES, APP_CONNECT_MAX_REQUEST_AGE_MS, APP_CONNECT_MAX_REQUEST_SKEW_MS, APP_CONNECT_MAX_R_LENGTH, APP_CONNECT_MAX_SLOTS, APP_CONNECT_MAX_URI_BYTES, APP_CONNECT_NONCE_BYTES, APP_CONNECT_PAGE_SIZE, APP_CONNECT_REQUEST_VERSION, APP_CONNECT_SLOT_BYTES, APP_CONNECT_SLOW_POLL_MS, type AppConnectAuthBinding, type AppConnectBindingKind, type AppConnectCandidate, type AppConnectCarrier, type AppConnectEncBinding, type AppConnectErrorClassification, type AppConnectFailureAction, type AppConnectGrant, type AppConnectGrantedKey, type AppConnectGroupInfo, type AppConnectGroupMember, type AppConnectIdentityKey, type AppConnectIdentityPort, type AppConnectKeyBounds, type AppConnectKeyRole, type AppConnectMode, AppConnectPayloadError, type AppConnectRejectReason, type AppConnectRequest, AppConnectRequestError, type AppConnectRequestErrorCode, type AppConnectResponsePort, type AppConnectSigningFailure, AppConnectTlv, type AppConnectVerification, type AuthPublicKey, type AuthSessionSnapshot, type AuthUser, type AuthVaultBundle, type AuthVaultDocumentRef, type AuthVaultStatus, type AuthVaultUnlockResult, type BrowserSecretStoreCrypto, type BrowserSecretStoreOptions, type BrowserStoredKeyType, type ClientIdentityPort, DEFAULT_YAPPR_KEY_EXCHANGE_CONFIG, type DiscoverablePasskeySelectionResult, type EncryptionKeyType, type EnrollPasskeyOptions, type IdentityPort, type IdentityRecord, KeyPurpose, KeySecurityLevel, KeyType, type LegacyPasswordLoginPort, type ListAppConnectCandidatesOptions, type MaybePromise, type NetworkName, type OpenAppConnectPayloadInput, type ParsedAppConnectUri, type PasskeyAccess, type PasskeyCredentialDescriptor, type PasskeyPlatformHint, type PasskeyPort, type PasskeyPrfAssertionResult, type PasskeyPrfSupport, type PinnedGroup, type PlatformAuthContextValue, PlatformAuthController, type PlatformAuthCryptoPort, type PlatformAuthDependencies, type PlatformAuthEvent, type PlatformAuthFeatures, type PlatformAuthIntent, type PlatformAuthLogger, PlatformAuthProvider, type PlatformAuthResult, type PlatformAuthState, type PollForYapprKeyExchangeResponseOptions, type ProfilePort, type SealAppConnectPayloadInput, type SecretStore, type SessionStore, type SideEffectsPort, type StartYapprKeyExchangeOptions, type UnifiedVaultPort, type UseYapprKeyExchangeLoginReturn, type UseYapprKeyRegistrationReturn, type UsernamePort, type VaultSecretKind, type VaultSource, type VerifyAppConnectCandidateInput, type VerifyAppConnectKeysInput, YAPPR_KEY_EXCHANGE_VERSION, YAPPR_NETWORK_IDS, YAPPR_STATE_TRANSITION_VERSION, type YapprDecryptedKeyExchangeResult, type YapprEphemeralKeyPair, type YapprKeyExchangeConfig, type YapprKeyExchangeLoginResult, type YapprKeyExchangeNetworkName, type YapprKeyExchangePort, type YapprKeyExchangeRequest, type YapprKeyExchangeResponse, type YapprKeyExchangeState, type YapprKeyRegistrationRequest, type YapprKeyRegistrationResult, type YapprKeyRegistrationState, type YapprUnsignedKeyRegistrationResult, appConnectAad, appConnectCandidateKey, appConnectPollDelayMs, appConnectRequestHash, appConnectSlotCount, authBindingBounds, base64urlDecode, base64urlEncode, boundsEqual, buildAppConnectUri, buildYapprKeyExchangeUri, buildYapprStateTransitionUri, checkAppConnectRequestAge, classifyAppConnectError, clearSensitiveBytes, createBrowserSecretStore, createPasskeyWithPrf, decodeAppConnectRequest, decodeYapprContractId, decodeYapprIdentityId, decryptYapprKeyExchangeResponse, decryptYapprLoginKey, deriveYapprAuthKeyFromLogin, deriveYapprEncryptionKeyFromLogin, deriveYapprSharedSecret, encBindingBounds, encodeAppConnectRequest, generatePrfInput, generateYapprEphemeralKeyPair, getDefaultRpId, getPasskeyAllowCredentialIds, getPasskeyPrfSupport, getPrfAssertionForCredentials, getYapprPublicKey, hash160, listAppConnectCandidates, openAppConnectPayload, parseAppConnectUri, parseYapprKeyExchangeUri, parseYapprStateTransitionUri, pollForYapprKeyExchangeResponse, sealAppConnectPayload, selectDiscoverablePasskey, serializeYapprKeyExchangeRequest, usePlatformAuth, useYapprKeyExchangeLogin, useYapprKeyRegistration, validateAppConnectRequest, verifyAppConnectCandidate, verifyAppConnectKeys };
