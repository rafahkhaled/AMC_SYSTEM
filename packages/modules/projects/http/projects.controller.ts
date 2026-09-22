import type { ProjectBoard, ProjectDetail, Workload } from '@amc/contracts';
import { attachDocumentSchema, completeTaskSchema, moveProjectSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ProjectWorkflow } from '../application/project-workflow.js';
import { ReadProjects } from '../application/read-projects.js';
import { ReadWorkload } from '../application/read-workload.js';

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
  ) {}

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

    const outcome = await this.workflow.move(caller, id, parsed.data.to);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.mustRead(caller, id);
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
