import type { StaffDirectory } from '@amc/contracts';
import { type Caller, CurrentCaller } from '@amc/http-kit';
import { Controller, Get, Inject } from '@nestjs/common';
import { ReadStaff } from '../application/read-staff.js';

/**
 * Who works here (X-01).
 *
 * No permission on the route beyond being signed in: a firm's own staff list
 * is not a secret from the people on it, and a directory nobody but the
 * manager can open is a directory nobody uses. What is guarded is the hours,
 * and that is guarded in the use case rather than here — a route that
 * returns different things to different callers should say so in one place,
 * and the place that decides is the place that knows the rule.
 */
@Controller('staff')
export class StaffController {
  constructor(@Inject(ReadStaff) private readonly staff: ReadStaff) {}

  @Get()
  async directory(@CurrentCaller() caller: Caller): Promise<StaffDirectory> {
    return { staff: await this.staff.directory(caller) };
  }
}
