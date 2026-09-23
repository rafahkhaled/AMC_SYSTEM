import type { StaffDirectory } from '@amc/contracts';
import { addStaffSchema, staffStatusSchema, updateStaffSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IdentityOperations } from '../application/identity-operations.js';
import { ReadStaff, type WorkingHoursWriter } from '../application/read-staff.js';
import { WORKING_HOURS_WRITER } from './tokens.js';

/**
 * Who works here, and who may change it (X-01, FR-03).
 *
 * Reading is open to anybody signed in: a firm's own staff list is not a
 * secret from the people on it, and a directory only the manager can open is
 * a directory nobody uses. What the hours columns show is decided in the use
 * case, because a route that returns different things to different callers
 * should say so in one place.
 *
 * Changing anything is `users.manage`, which is the manager's.
 */
@Controller('staff')
export class StaffController {
  constructor(
    @Inject(ReadStaff) private readonly staff: ReadStaff,
    @Inject(IdentityOperations) private readonly identity: IdentityOperations,
    @Inject(WORKING_HOURS_WRITER) private readonly hours: WorkingHoursWriter,
  ) {}

  @Get()
  async directory(@CurrentCaller() caller: Caller): Promise<StaffDirectory> {
    return { staff: await this.staff.directory(caller) };
  }

  @Post()
  @RequirePermissions('users.manage')
  async add(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<StaffDirectory> {
    const parsed = addStaffSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not enough');
    }

    const added = await this.identity.addStaff(actorFrom(caller), parsed.data);
    if (!added.ok) throw new ConflictException(added.error.message);

    return { staff: await this.staff.directory(caller) };
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  async update(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<StaffDirectory> {
    const parsed = updateStaffSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Nothing to change');
    }

    const { workingHours, ...identityChanges } = parsed.data;
    if (Object.keys(identityChanges).length > 0) {
      const changed = await this.identity.updateStaff(actorFrom(caller), id, identityChanges);
      if (!changed.ok) throw new ConflictException(changed.error.message);
    }

    /*
     * The hours are written second and separately, because they belong to
     * another module's table. That means a failure here leaves the name
     * changed and the hours not — visible on the next screen refresh, and a
     * better outcome than identity reaching into a table it does not own.
     */
    if (workingHours) {
      await this.hours.set({ userId: id, ...workingHours });
    }

    return { staff: await this.staff.directory(caller) };
  }

  /**
   * Taking somebody off the system, or putting them back.
   *
   * Suspension rather than deletion. A person's id is on every hour they
   * recorded, every project they were assigned and every audit row they
   * caused; removing the row would orphan all of it or cascade it away, and a
   * practice that cannot say who did the work it invoiced has a worse problem
   * than a long staff list.
   */
  @Post(':id/status')
  @RequirePermissions('users.manage')
  async setStatus(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<StaffDirectory> {
    const parsed = staffStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Say whether they are active or suspended');
    }

    const done = await this.identity.setStaffStatus(actorFrom(caller), id, parsed.data.status);
    if (!done.ok) throw new ConflictException(done.error.message);

    return { staff: await this.staff.directory(caller) };
  }
}

/** The caller as the audit trail wants them named. */
function actorFrom(caller: Caller) {
  return {
    userId: caller.userId,
    roles: caller.roles,
    label: caller.displayName,
  };
}
