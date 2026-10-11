/**
 * Whether a value is on one of the lists an administrator maintains.
 *
 * Document types, issuing authorities, how a payment arrived, which portals
 * the firm keeps logins for: each is a list somebody adds to from Settings. The
 * use cases that store one of those values ask here, so a code that is not on
 * the list — a typo, an option since retired — is refused with a reason
 * instead of being stored and found wrong months later.
 *
 * Lives in the kernel because the modules that ask are different ones and none
 * may reach into another's tables; they are told the answer, not the list.
 */
export interface ReferenceLookup {
  /** Whether `code` is on `list` and still offered. Retired options are not. */
  isLive(list: string, code: string): Promise<boolean>;
}
