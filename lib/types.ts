/** Domain types for the forum. Raw documents arrive as `Uint8Array`/`string` mixes;
 *  these are the app's plain shapes. */

export interface SessionData {
  identityId: string
  authKeyWif: string | null
  /** Display id for the header avatar — defaults to identityId. */
  username?: string
}
