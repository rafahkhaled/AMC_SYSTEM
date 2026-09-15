/**
 * These moved to @amc/http-kit so that a controller in another module can
 * declare what it needs without that module depending on identity's
 * controllers. Re-exported here because the guards that read them still live
 * in this module, and callers should not have to know they were moved.
 */
export {
  AllowPendingTwoFactor,
  PENDING_TWO_FACTOR_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  Public,
  RequirePermissions,
} from '@amc/http-kit';
