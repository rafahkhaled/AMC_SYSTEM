import {
  type Classification,
  type ClassificationReport,
  type Salesperson,
  addSalespersonSchema,
  classifiedEntities,
  updateClassificationSchema,
} from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { NotFound } from '@amc/kernel';
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
  Query,
} from '@nestjs/common';
import { ClassificationService } from './classification.js';

const day = /^\d{4}-\d{2}-\d{2}$/;

@Controller()
export class ClassificationController {
  constructor(
    @Inject(ClassificationService) private readonly classification: ClassificationService,
  ) {}

  /** Everyone signed in: the field is on every screen that creates something. */
  @Get('salespeople')
  async salespeople(): Promise<{ salespeople: Salesperson[] }> {
    return { salespeople: await this.classification.salespeople() };
  }

  /** Added from the field itself, by whoever is filling in the client or the quotation. */
  @Post('salespeople')
  @RequirePermissions('clients.edit')
  async add(
    @CurrentCaller() caller: Caller,
    @Body() body: unknown,
  ): Promise<{ salespeople: Salesperson[]; id: string }> {
    const parsed = addSalespersonSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Give a name');
    const added = await this.classification.addSalesperson(caller, parsed.data.name);
    if (!added.ok) throw new ConflictException(added.error.message);
    return { salespeople: await this.classification.salespeople(), id: added.value };
  }

  @Patch('salespeople/:id')
  @RequirePermissions('users.manage')
  async retire(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: { retired?: unknown },
  ): Promise<{ salespeople: Salesperson[] }> {
    if (typeof body?.retired !== 'boolean') throw new BadRequestException('Say yes or no');
    const done = await this.classification.retireSalesperson(caller, id, body.retired);
    if (!done.ok) throw new NotFoundException(done.error.message);
    return { salespeople: await this.classification.salespeople() };
  }

  @Get('classification/report')
  @RequirePermissions('billing.view')
  async report(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ClassificationReport> {
    if (!from || !to || !day.test(from) || !day.test(to) || to < from) {
      throw new BadRequestException('That date range runs backwards');
    }
    return this.classification.report(from, to);
  }

  @Get('classification/:entity/:id')
  async read(
    @CurrentCaller() caller: Caller,
    @Param('entity') entity: string,
    @Param('id') id: string,
  ): Promise<Classification> {
    if (!(classifiedEntities as readonly string[]).includes(entity))
      throw new NotFoundException('Not found');
    const found = await this.classification.read(caller, entity as never, id);
    if (!found) throw new NotFoundException('Not found');
    return found;
  }

  @Patch('classification/:entity/:id')
  async change(
    @CurrentCaller() caller: Caller,
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Classification> {
    if (!(classifiedEntities as readonly string[]).includes(entity))
      throw new NotFoundException('Not found');
    const parsed = updateClassificationSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Check the branch, salesperson and who did the work');
    const done = await this.classification.change(caller, entity as never, id, parsed.data);
    if (!done.ok) {
      if (done.error instanceof NotFound) throw new NotFoundException(done.error.message);
      throw new ConflictException(done.error.message);
    }
    const found = await this.classification.read(caller, entity as never, id);
    if (!found) throw new NotFoundException('Not found');
    return found;
  }
}
