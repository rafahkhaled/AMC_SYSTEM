import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'amc:permissions';
export const PUBLIC_KEY = 'amc:public';
export const PENDING_TWO_FACTOR_KEY = 'amc:pending-two-factor';

/**
 * What a route needs. All of the listed permissions are required, not any of
 * them, because "any" is the sort of default that quietly grants too much.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Reachable without signing in. Routes are closed by default, so forgetting
 * this makes a route unreachable, which someone notices immediately.
 * Forgetting the opposite would open one silently.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Reachable by a session that has shown a password but not yet a second
 * factor. Only two routes should ever carry it: presenting the code, and
 * signing out.
 */
export const AllowPendingTwoFactor = () => SetMetadata(PENDING_TWO_FACTOR_KEY, true);
