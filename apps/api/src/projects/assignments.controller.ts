import { assignProjectSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ProjectAssignments } from './assignments.js';

/** Putting people on a job, and taking them off. The manager's. */
@Controller('projects/:id/assignees')
export class ProjectAssignmentsController {
  constructor(@Inject(ProjectAssignments) private readonly assignments: ProjectAssignments) {}

  @Post()
  @RequirePermissions('projects.assign')
  async assign(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = assignProjectSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Choose the person and their part');
    const done = await this.assignments.assign(caller, id, parsed.data.userId, parsed.data.role);
    if (!done.ok) {
      if (done.error.message === 'No such project') throw new NotFoundException(done.error.message);
      throw new ConflictException(done.error.message);
    }
    return { ok: true };
  }

  @Delete(':userId')
  @RequirePermissions('projects.assign')
  async unassign(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<{ ok: true }> {
    const done = await this.assignments.unassign(caller, id, userId);
    if (!done.ok) throw new NotFoundException(done.error.message);
    return { ok: true };
  }
}
