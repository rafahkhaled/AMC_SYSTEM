import type {
  FirmProfile,
  HoursReport,
  InvoiceView,
  Invoices,
  ProfitabilityReport,
  QuotationView,
  Quotations,
  StatementView,
  Statements,
} from '@amc/contracts';
import {
  addQuotationLineRequestSchema,
  draftQuotationRequestSchema,
  generateStatementRequestSchema,
  recordPaymentRequestSchema,
  releaseStatementRequestSchema,
  reviseLineRequestSchema,
  sendQuotationSchema,
} from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { Money, actorFrom } from '@amc/kernel';
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
  Post,
  Query,
} from '@nestjs/common';
import { BillingOperations } from '../application/billing-operations.js';
import { ReadBilling } from '../application/read-billing.js';
import { FirmProfileToken } from './tokens.js';

/**
 * Billing (FR-31 to FR-33).
 *
 * Reads carry `billing.view` *and* are scoped. The permission keeps data entry
 * and the client portal out of the billing screens entirely; the scope decides
 * which clients an accountant sees inside them. Neither does the other's job:
 * `clients.view.all` and `clients.view.assigned` belong to different roles, so
 * naming either one here would lock the other out.
 *
 * Writes use the three permissions the SRS already separates, and they are
 * separate because they are different acts. `billing.approve` settles what a
 * client will be charged; `billing.invoice.issue` sends them the document;
 * `billing.entries.unlink` undoes time they have already been shown.
 */
@Controller('billing')
export class BillingController {
  constructor(
    @Inject(ReadBilling) private readonly read: ReadBilling,
    @Inject(BillingOperations) private readonly billing: BillingOperations,

    @Inject(FirmProfileToken) private readonly firmProfile: FirmProfile,
  ) {}

  /* ------------------------------------------------------- quotations -- */

  @RequirePermissions('billing.view')
  @Get('quotations')
  async listQuotations(
    @CurrentCaller() caller: Caller,
    @Query('clientId') clientId?: string,
  ): Promise<Quotations> {
    return { quotations: await this.read.quotations(caller, clientId) };
  }

  @RequirePermissions('billing.view')
  @Get('quotations/:id')
  async quotation(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    const quotation = await this.read.quotation(caller, id);
    if (!quotation) throw new NotFoundException('No such quotation');
    return quotation;
  }

  @RequirePermissions('billing.approve')
  @Post('quotations')
  async draftQuotation(
    @CurrentCaller() caller: Caller,
    @Body() body: unknown,
  ): Promise<QuotationView> {
    const parsed = draftQuotationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Name a client and a reference');

    const drafted = await this.billing.run(caller, (billing) =>
      billing.quotations.draft(caller.userId, {
        clientId: parsed.data.clientId,
        reference: parsed.data.reference,
        validUntil: parsed.data.validUntil ? day(parsed.data.validUntil) : null,
        notesEn: parsed.data.notesEn ?? null,
        notesAr: parsed.data.notesAr ?? null,
      }),
    );
    if (!drafted.ok) throw new ConflictException(drafted.error.message);

    return this.mustReadQuotation(caller, drafted.value.quotationId);
  }

  @RequirePermissions('billing.approve')
  @Post('quotations/:id/lines')
  async addQuotationLine(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<QuotationView> {
    const parsed = addQuotationLineRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Say what the line is for and what it costs',
      );
    }

    await this.mustReadQuotation(caller, id);
    const added = await this.billing.run(caller, (billing) =>
      billing.quotations.addLine(id, parsed.data),
    );
    if (!added.ok) throw new ConflictException(added.error.message);

    return this.mustReadQuotation(caller, id);
  }

  @RequirePermissions('billing.approve')
  @Delete('quotations/:id/lines/:lineId')
  async removeQuotationLine(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ): Promise<QuotationView> {
    await this.mustReadQuotation(caller, id);
    const removed = await this.billing.run(caller, (billing) =>
      billing.quotations.removeLine(id, lineId),
    );
    if (!removed.ok) throw new ConflictException(removed.error.message);
    return this.mustReadQuotation(caller, id);
  }

  /**
   * Sending, and the client's answer.
   *
   * One route with the act in the path rather than a state in the body: the
   * three are different decisions with different consequences, and a body
   * saying {"state": "accepted"} invites a screen to send whichever one it
   * happens to hold.
   */
  @RequirePermissions('billing.approve')
  @Post('quotations/:id/:act')
  async answerQuotation(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('act') act: string,
    @Body() body?: unknown,
  ): Promise<QuotationView> {
    await this.mustReadQuotation(caller, id);

    // `deliver` says whether the system sends it or only records that
    // somebody did. Absent means by hand, which is the safer default: it
    // claims less.
    const deliver = sendQuotationSchema.safeParse(body ?? {}).data?.deliver === true;

    if (act !== 'send' && act !== 'accept' && act !== 'decline') {
      throw new BadRequestException('That is not something to do to a quotation');
    }

    const done = await this.billing.run(caller, async (billing) => {
      // `send` reports which channel it went by; the three answers are the
      // same shape to this route, which only needs to know whether it worked.
      if (act === 'send') {
        const sent = await billing.quotations.send(id, { deliver });
        return sent.ok ? sent : sent;
      }
      return act === 'accept' ? billing.quotations.accept(id) : billing.quotations.decline(id);
    });

    if (!done.ok) throw new ConflictException(done.error.message);

    return this.mustReadQuotation(caller, id);
  }

  private async mustReadQuotation(caller: Caller, id: string): Promise<QuotationView> {
    const quotation = await this.read.quotation(caller, id);
    if (!quotation) throw new NotFoundException('No such quotation');
    return quotation;
  }

  /**
   * What the firm puts on its own paper (FR-30, FR-32).
   *
   * Served rather than built into the bundle because it is configuration: a
   * firm that changes bank should not need a deploy, and this repository is
   * public, so the values cannot live in it at all.
   */
  @RequirePermissions('billing.view')
  @Get('documents/profile')
  documentProfile(): FirmProfile {
    return this.firmProfile;
  }

  /**
   * Emailing a quotation again, with a fresh link (FR-30).
   *
   * For the one that went to the wrong address or that the client has lost.
   * The previous link stops working, which is the point.
   */
  @RequirePermissions('billing.view')
  @Post('quotations/:id/resend')
  async resendQuotation(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    await this.mustReadQuotation(caller, id);
    const again = await this.billing.run(caller, (billing) => billing.quotations.sendAgain(id));
    if (!again.ok) throw new ConflictException(again.error.message);
    return this.mustReadQuotation(caller, id);
  }

  /* ---------------------------------------------------------- reports -- */

  /**
   * Hours, and what became of them (FR-35).
   *
   * The split between billed and unbilled is the point of it: a large
   * unbilled figure is either work in progress or work quietly given away,
   * and a practice cannot tell which without looking.
   */
  @RequirePermissions('billing.view')
  @Get('reports/hours')
  async hoursReport(
    @CurrentCaller() caller: Caller,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('by') by?: string,
  ): Promise<HoursReport> {
    const period = readPeriod(from, to);
    const grouping = by === 'person' || by === 'service' ? by : 'client';
    return this.read.hours(caller, { ...period, by: grouping });
  }

  @RequirePermissions('billing.view')
  @Get('reports/profitability')
  async profitabilityReport(
    @CurrentCaller() caller: Caller,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ProfitabilityReport> {
    return this.read.profitability(caller, readPeriod(from, to));
  }

  /* ------------------------------------------------------- statements -- */

  @RequirePermissions('billing.view')
  @Get('statements')
  async listStatements(
    @CurrentCaller() caller: Caller,
    @Query('clientId') clientId?: string,
  ): Promise<Statements> {
    return { statements: await this.read.statements(caller, clientId) };
  }

  @RequirePermissions('billing.view')
  @Get('statements/:id')
  async statement(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<StatementView> {
    const statement = await this.read.statement(caller, id);
    // Out of scope answers as not found: a 403 would confirm it exists.
    if (!statement) throw new NotFoundException('No such statement');
    return statement;
  }

  @RequirePermissions('billing.approve')
  @Post('statements')
  async generateStatement(
    @CurrentCaller() caller: Caller,
    @Body() body: unknown,
  ): Promise<StatementView> {
    const parsed = generateStatementRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Name a client and a period');

    const made = await this.billing.run(caller, (billing) =>
      billing.generate.execute(caller.userId, {
        clientId: parsed.data.clientId,
        from: day(parsed.data.from),
        to: day(parsed.data.to),
      }),
    );
    if (!made.ok) throw new ConflictException(made.error.message);

    return this.mustRead(caller, made.value.statementId);
  }

  /**
   * Excluding or adjusting a line (FR-32).
   *
   * One route for both, because they are the same act from the reviewer's
   * side — "this line is not what the client should pay" — and both are
   * refused without a reason.
   */
  @RequirePermissions('billing.approve')
  @Post('statements/:id/lines/:lineId/revise')
  async reviseLine(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
  ): Promise<StatementView> {
    const parsed = reviseLineRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Say why, in a few words');

    // Scoped first: the repository is unscoped, so the read is what proves
    // this caller may touch this client's billing at all.
    const visible = await this.read.statement(caller, id);
    if (!visible) throw new NotFoundException('No such statement');

    const revised = await this.billing.run(caller, async (billing) => {
      const statement = await billing.statements.findById(id);
      if (!statement) return null;

      const now = new Date();
      const outcome =
        parsed.data.adjustToMinor === undefined
          ? statement.exclude(lineId, parsed.data.reason, now)
          : statement.adjust(
              lineId,
              // The aggregate's own currency, not the one off the wire.
              Money.ofMinor(parsed.data.adjustToMinor, statement.currency),
              parsed.data.reason,
              now,
            );
      if (!outcome.ok) return outcome;

      await billing.statements.save(statement);
      return outcome;
    });

    if (revised === null) throw new NotFoundException('No such statement');
    if (!revised.ok) throw new ConflictException(revised.error.message);
    return this.mustRead(caller, id);
  }

  @RequirePermissions('billing.approve')
  @Post('statements/:id/approve')
  async approve(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<StatementView> {
    const visible = await this.read.statement(caller, id);
    if (!visible) throw new NotFoundException('No such statement');

    const approved = await this.billing.run(caller, async (billing) => {
      const statement = await billing.statements.findById(id);
      if (!statement) return null;

      const outcome = statement.approve(caller.userId, new Date());
      if (!outcome.ok) return outcome;

      await billing.statements.save(statement);
      return outcome;
    });

    if (approved === null) throw new NotFoundException('No such statement');
    if (!approved.ok) throw new ConflictException(approved.error.message);
    return this.mustRead(caller, id);
  }

  @RequirePermissions('billing.invoice.issue')
  @Post('statements/:id/invoice')
  async invoiceIt(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<InvoiceView> {
    const visible = await this.read.statement(caller, id);
    if (!visible) throw new NotFoundException('No such statement');

    const raised = await this.billing.run(caller, (billing) =>
      billing.raise.execute(caller.userId, id),
    );
    if (!raised.ok) throw new ConflictException(raised.error.message);

    const invoice = await this.read.invoice(caller, raised.value.invoiceId);
    if (!invoice) throw new NotFoundException('No such invoice');
    return invoice;
  }

  /**
   * Taking billed hours back (FR-26).
   *
   * Its own permission, and the use case checks it again. A permission
   * enforced only on the route is one a later caller — a job, a script,
   * another use case — reaches around without noticing.
   */
  @RequirePermissions('billing.entries.unlink')
  @Post('statements/:id/release')
  async releaseHours(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ released: number }> {
    const parsed = releaseStatementRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Say why these hours are being released');

    const visible = await this.read.statement(caller, id);
    if (!visible) throw new NotFoundException('No such statement');

    const released = await this.billing.run(caller, (billing) =>
      billing.release.execute(caller, {
        statementId: id,
        reason: parsed.data.reason,
      }),
    );
    if (!released.ok) throw new ConflictException(released.error.message);
    return released.value;
  }

  @RequirePermissions('billing.view')
  @Get('invoices')
  async listInvoices(
    @CurrentCaller() caller: Caller,
    @Query('outstanding') outstanding?: string,
  ): Promise<Invoices> {
    return {
      invoices: await this.read.invoices(caller, { outstandingOnly: outstanding === 'true' }),
    };
  }

  @RequirePermissions('billing.view')
  @Get('invoices/:id')
  async invoice(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<InvoiceView> {
    const invoice = await this.read.invoice(caller, id);
    if (!invoice) throw new NotFoundException('No such invoice');
    return invoice;
  }

  @RequirePermissions('billing.approve')
  @Post('invoices/:id/payments')
  async recordPayment(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = recordPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Say how much arrived, when, and how');

    const visible = await this.read.invoice(caller, id);
    if (!visible) throw new NotFoundException('No such invoice');

    const recorded = await this.billing.run(caller, (billing) =>
      billing.settle.record(actorFrom(caller), {
        invoiceId: id,
        amountMinor: parsed.data.amountMinor,
        receivedOn: new Date(parsed.data.receivedOn),
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
      }),
    );
    if (!recorded.ok) throw new ConflictException(recorded.error.message);

    const invoice = await this.read.invoice(caller, id);
    if (!invoice) throw new NotFoundException('No such invoice');
    return invoice;
  }

  /**
   * The statement after a change, so the screen never has to guess.
   *
   * Returning the new state rather than 204 keeps the browser from holding its
   * own copy of the totals, the state and what each line is worth — three
   * things it would get wrong the first time somebody adjusted a line.
   */
  private async mustRead(caller: Caller, id: string): Promise<StatementView> {
    const statement = await this.read.statement(caller, id);
    if (!statement) throw new NotFoundException('No such statement');
    return statement;
  }
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * The period a report covers, defaulting to the current month.
 *
 * `to` is exclusive and the caller gives an inclusive date, so a request for
 * 1 to 30 September has to reach the query as "before 1 October". Getting
 * that wrong drops the last day of every month, which is exactly the day a
 * practice does its filing.
 */
function readPeriod(from?: string, to?: string): { from: Date; to: Date } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const start =
    from && iso.test(from)
      ? day(from)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const inclusiveEnd =
    to && iso.test(to)
      ? day(to)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  if (inclusiveEnd.getTime() < start.getTime()) {
    throw new BadRequestException('A report period has to end after it starts');
  }
  return { from: start, to: new Date(inclusiveEnd.getTime() + 86_400_000) };
}
