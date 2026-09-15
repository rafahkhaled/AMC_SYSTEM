import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../domain/index.js';

export const PERMISSIONS_KEY = 'amc:permissions';
export const PUBLIC_KEY = 'amc:public';
export const PENDING_TWO_FACTOR_KEY = 'amc:pending-two-factor';

/**
 * Says what a route needs. All of the listed permissions are required, not any
 * of them, because "any" is the kind of default that quietly grants too much.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Marks a route reachable without signing in. Routes are protected by default,
 * so forgetting this decorator makes a route unreachable, which someone
 * notices immediately. Forgetting the opposite would expose one silently.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Marks the few routes a half-authenticated session may reach: presenting the
 * code, and signing out. Everything else is closed until the second factor has
 * been shown, which is what makes the factor worth having.
 */
export const AllowPendingTwoFactor = () => SetMetadata(PENDING_TWO_FACTOR_KEY, true);
