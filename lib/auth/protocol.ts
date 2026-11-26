/**
 * Re-export the App Connect v2 protocol helpers from the vendored
 * platform-auth package, so app code never deep-imports vendor paths.
 */
export {
  hash160,
  deriveYapprAuthKeyFromLogin,
  deriveYapprEncryptionKeyFromLogin,
  deriveYapprSharedSecret,
  decryptYapprLoginKey,
  decodeYapprContractId,
  decodeYapprIdentityId,
  getYapprPublicKey,
  buildYapprKeyExchangeUri,
  buildYapprStateTransitionUri,
  generateYapprEphemeralKeyPair,
  clearSensitiveBytes,
} from 'platform-auth'
