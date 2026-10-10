import type { ServiceView, Services } from '@amc/contracts';
import { createServiceSchema, updateServiceSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ManageServices } from '../application/manage-services.js';
import type { ServiceCatalogue } from '../application/ports.js';
import type { ServiceTemplate } from '../domain/index.js';
import { isCustomServiceCode } from '../domain/index.js';
import { ServiceCatalogueToken } from './tokens.js';

/**
 * The services the firm offers (feedback item 8).
 *
 * Reading is open to anybody signed in: every screen that names a project's
 * service needs the label, and the list of services is not a secret. Adding or
 * changing one is \`users.manage\`, the manager's, like the other lists.
 */
@Controller('services')
export class ServicesController {
  constructor(
    @Inject(ServiceCatalogueToken) private readonly catalogue: ServiceCatalogue,
    @Inject(ManageServices) private readonly manage: ManageServices,
  ) {}

  /**
   * Everything, retired included.
   *
   * A project opened under a service that has since been retired still has to
   * show its name, so the caller gets the retired ones flagged and decides:
   * a picker filters them out and a label does not.
   */
  @Get()
  async all(): Promise<Services> {
    return { services: await this.views() };
  }

  @Post()
  @RequirePermissions('users.manage')
  async add(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<ServiceView> {
    const parsed = createServiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a service');
    }

    const added = await this.manage.add(caller, parsed.data);
    if (!added.ok) throw new ConflictException(added.error.message);
    return this.mustFind(added.value);
  }

  @Patch(':code')
  @RequirePermissions('users.manage')
  async change(
    @CurrentCaller() caller: Caller,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<ServiceView> {
    if (!isCustomServiceCode(code)) {
      throw new ConflictException('Only a service the firm added can be changed here');
    }
    const parsed = updateServiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a change');
    }

    const changed = await this.manage.change(caller, code, parsed.data);
    if (!changed.ok) throw new ConflictException(changed.error.message);
    return this.mustFind(code);
  }

  private async mustFind(code: string): Promise<ServiceView> {
    const found = (await this.views()).find((view) => view.code === code);
    if (!found) throw new NotFoundException('No such service');
    return found;
  }

  private async views(): Promise<ServiceView[]> {
    const [offered, retired] = await Promise.all([
      this.catalogue.offered(),
      this.catalogue.retired(),
    ]);
    return [
      ...offered.map((template) => view(template, false)),
      ...retired.map((template) => view(template, true)),
    ];
  }
}

function view(template: ServiceTemplate, retired: boolean): ServiceView {
  return {
    code: template.code,
    nameEn: template.nameEn,
    nameAr: template.nameAr,
    builtIn: !isCustomServiceCode(template.code),
    recurring: template.recurrence !== 'once',
    deadlineDays: template.deadline.kind === 'days_from_start' ? template.deadline.days : null,
    steps: template.tasks.map(({ nameEn, nameAr }) => ({ nameEn, nameAr })),
    requiredDocuments: template.requiredDocuments.map(({ type, mandatory }) => ({
      type,
      mandatory,
    })),
    retired,
  };
}
