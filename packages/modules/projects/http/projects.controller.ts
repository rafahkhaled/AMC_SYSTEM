import type { ProjectBoard, ProjectDetail, Workload } from '@amc/contracts';
import {
  attachDocumentSchema,
  completeTaskSchema,
  moveProjectSchema,
  startProjectSchema,
  taskDueSchema,
} from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ContinueWork } from '../application/continue-work.js';
import { ProjectWorkflow, scopeFor } from '../application/project-workflow.js';
import { ReadProjects } from '../application/read-projects.js';
import { ReadWorkload } from '../application/read-workload.js';
import { StartProject } from '../application/start-project.js';

/**
 * The work.
 *
 * Reading is not permission-guarded for the same reason the client screens are
 * not: `projects.view.all` and the assigned view are alternatives, so naming
 * either would lock out the other role. The scope decides, and someone with
 * neither sees an empty board.
 *
 * Writing is guarded, because there is one permission for it and no
 * alternative.
 */
@Controller('projects')
export class ProjectsController {
  constructor(
    @Inject(ReadProjects) private readonly projects: ReadProjects,
    @Inject(ProjectWorkflow) private readonly workflow: ProjectWorkflow,
    @Inject(ReadWorkload) private readonly workload: ReadWorkload,
    @Inject(StartProject) private readonly start: StartProject,
    @Inject(ContinueWork) private readonly continuing: ContinueWork,
  ) {}

  /**
   * Opening a piece of work (FR-10, FR-11).
   *
   * The recurring services arrive on their own; these are the ones somebody
   * asks for on the phone. `projects.edit`, which an accountant already has —
   * taking the call and opening the job is the same act.
   */
  @Post()
  @RequirePermissions('projects.edit')
  async create(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<ProjectDetail> {
    const parsed = startProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'That is not enough to start work',
      );
    }
    /*
     * Not checked against the eleven here. A service the firm added is as
     * real as the ones in code, and only the catalogue knows which exist, so
     * the use case refuses what it cannot find.
     */

    const started = await this.start.execute({
      clientId: parsed.data.clientId,
      service: parsed.data.service,
      scope: scopeFor(caller),
      ...(parsed.data.dueOn ? { dueAt: new Date(`${parsed.data.dueOn}T00:00:00.000Z`) } : {}),
      ...(parsed.data.periodKey ? { periodKey: parsed.data.periodKey } : {}),
    });
    if (!started.ok) throw new ConflictException(started.error.message);

    const detail = await this.projects.detail(caller, started.value.id);
    if (!detail) throw new NotFoundException('No such project');
    return detail;
  }

  /**
   * Carry straight on with the next one (feedback item 9).
   *
   * The sweep opens work for the period that has just closed, so the one
   * after is not made for weeks. This opens it now, for the same client, with
   * the key and due date the sweep would have given it.
   */
  @Post(':id/open-next')
  @RequirePermissions('projects.edit')
  async openNext(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<ProjectDetail> {
    const opened = await this.continuing.openNext(caller, id);
    if (!opened.ok) throw new ConflictException(opened.error.message);
    return this.mustDetail(caller, opened.value.projectId);
  }

  /** This was a one-time job: stop it coming round again. */
  @Post(':id/stop-repeating')
  @RequirePermissions('projects.edit')
  async stopRepeating(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<ProjectDetail> {
    const stopped = await this.continuing.stopRepeating(caller, id);
    if (!stopped.ok) throw new ConflictException(stopped.error.message);
    return this.mustDetail(caller, id);
  }

  @Post(':id/resume-repeating')
  @RequirePermissions('projects.edit')
  async resumeRepeating(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<ProjectDetail> {
    const resumed = await this.continuing.resumeRepeating(caller, id);
    if (!resumed.ok) throw new ConflictException(resumed.error.message);
    return this.mustDetail(caller, id);
  }

  private async mustDetail(caller: Caller, id: string): Promise<ProjectDetail> {
    const detail = await this.projects.detail(caller, id);
    if (!detail) throw new NotFoundException('No such project');
    return detail;
  }

  @Get()
  async board(@CurrentCaller() caller: Caller): Promise<ProjectBoard> {
    return this.projects.board(caller);
  }

  /**
   * What is on each person's desk (FR-13).
   *
   * Declared before `:id`, or Nest would read "workload" as a project id. Only
   * somebody who can assign work sees anything: the point of the screen is to
   * move work between people, and a list of how loaded your colleagues are is
   * no use to somebody who cannot act on it.
   */
  @Get('workload')
  async people(@CurrentCaller() caller: Caller): Promise<Workload> {
    return this.workload.forCaller(caller);
  }

  @Get(':id')
  async detail(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<ProjectDetail> {
    const project = await this.projects.detail(caller, id);
    // Out of scope reads as not found. Anything else confirms that a
    // particular client has a particular piece of work in progress.
    if (!project) throw new NotFoundException('No such project');
    return project;
  }

  @Post(':id/move')
  @RequirePermissions('projects.edit')
  async move(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectDetail> {
    const parsed = moveProjectSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Move it to what?');

    const outcome = await this.workflow.move(caller, id, parsed.data.to, parsed.data.reason);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.mustRead(caller, id);
  }

  /**
   * When a step should be finished (FR-11).
   *
   * A PATCH, not a POST: this corrects a date rather than recording that
   * something happened, and the same step can be re-dated as often as the
   * client moves it.
   */
  @Patch(':id/tasks/:order/due')
  @RequirePermissions('projects.edit')
  async setTaskDue(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('order') order: string,
    @Body() body: unknown,
  ): Promise<ProjectDetail> {
    const parsed = taskDueSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Give a date, or null to clear it');

    const outcome = await this.workflow.setTaskDue(
      caller,
      id,
      Number(order),
      parsed.data.dueOn ? new Date(`${parsed.data.dueOn}T00:00:00.000Z`) : null,
    );
    if (!outcome.ok) throw new ConflictException(outcome.error.message);

    const detail = await this.projects.detail(caller, id);
    if (!detail) throw new NotFoundException('No such project');
    return detail;
  }

  @Post(':id/tasks/:order')
  @RequirePermissions('projects.edit')
  async completeTask(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('order') order: string,
  ): Promise<ProjectDetail> {
    const parsed = completeTaskSchema.safeParse({ order: Number(order) });
    if (!parsed.success) throw new BadRequestException('Which task?');

    const outcome = await this.workflow.completeTask(caller, id, parsed.data.order);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.mustRead(caller, id);
  }

  @Post(':id/documents')
  @RequirePermissions('projects.edit')
  async attach(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectDetail> {
    const parsed = attachDocumentSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Which document, against which requirement?');

    const outcome = await this.workflow.attachDocument(
      caller,
      id,
      parsed.data.type,
      parsed.data.documentId,
    );
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.mustRead(caller, id);
  }

  @Delete(':id/documents/:type')
  @RequirePermissions('projects.edit')
  async detach(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('type') type: string,
  ): Promise<ProjectDetail> {
    const outcome = await this.workflow.detachDocument(caller, id, type);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.mustRead(caller, id);
  }

  /**
   * Reads back what the change produced.
   *
   * A write that succeeded and then could not be read is a real possibility —
   * moving a project to a state you cannot see, for one — and returning a stale
   * body would be worse than saying so.
   */
  private async mustRead(caller: Caller, id: string): Promise<ProjectDetail> {
    const project = await this.projects.detail(caller, id);
    if (!project) throw new NotFoundException('No such project');
    return project;
  }
}
