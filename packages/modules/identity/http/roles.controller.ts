import { type RolePermissions, chooseRolePermissionsSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { BadRequestException, Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { IdentityOperations } from '../application/identity-operations.js';

/**
 * What each role may do (Settings → Roles and permissions).
 *
 * The manager's, because changing what roles can do is changing what everyone
 * can do. Reading is the manager's too: it is the screen that changes it.
 */
@Controller('roles')
export class RolesController {
  constructor(@Inject(IdentityOperations) private readonly identity: IdentityOperations) {}

  @Get()
  @RequirePermissions('users.manage')
  all(): Promise<RolePermissions> {
    return this.identity.rolePermissions();
  }

  @Put(':role/permissions')
  @RequirePermissions('users.manage')
  async choose(
    @CurrentCaller() caller: Caller,
    @Param('role') role: string,
    @Body() body: unknown,
  ): Promise<RolePermissions> {
    const parsed = chooseRolePermissionsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Send the list of permissions');

    const done = await this.identity.setRolePermissions(
      { userId: caller.userId, roles: caller.roles, label: caller.displayName },
      role,
      parsed.data.permissions,
    );
    if (!done.ok) throw new BadRequestException(done.error.message);
    return this.identity.rolePermissions();
  }
}
