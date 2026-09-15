import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '../domain/index.js';
import { CALLER_KEY, type RequestWithCaller } from './caller.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';

/**
 * Turns the role matrix from SRS 2.2 into something the API enforces rather
 * than something the user interface merely hides.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    const caller = request[CALLER_KEY];
    if (!caller) throw new ForbiddenException('Please sign in');

    const missing = required.filter((permission) => !caller.permissions.has(permission));
    if (missing.length > 0) {
      // The response says only that it is not allowed. Naming the missing
      // permission would map out the system for anyone probing it.
      throw new ForbiddenException('You do not have access to this');
    }
    return true;
  }
}
