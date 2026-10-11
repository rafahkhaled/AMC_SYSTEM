import type { Letter, LetterTemplate, LetterTemplateDetail } from '@amc/contracts';
import {
  createLetterTemplateSchema,
  generateLetterSchema,
  updateLetterTemplateSchema,
} from '@amc/contracts';
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
import { GenerateLetter } from '../application/generate-letter.js';
import { ManageLetterTemplates } from '../application/manage-letter-templates.js';

/**
 * Letters the firm sends, filled in from the client's own record (FR-15).
 *
 * Generating one is a POST because it records what was produced. A letter is
 * a thing that was sent, and the copy is kept rather than regenerated later
 * from wording and a client record that may both have moved on.
 */
@Controller()
export class LettersController {
  constructor(
    @Inject(GenerateLetter) private readonly letters: GenerateLetter,
    @Inject(ManageLetterTemplates) private readonly manage: ManageLetterTemplates,
  ) {}

  @Get('letter-templates')
  async templates(): Promise<{ templates: LetterTemplate[] }> {
    return { templates: await this.letters.templates() };
  }

  /**
   * Every letter with its wording, retired ones included (feedback item 6).
   *
   * The manager's, like the other lists: the wording of a letter that goes out
   * under the firm's name is not for every account to rewrite.
   */
  @Get('letter-templates/all')
  @RequirePermissions('users.manage')
  async all(): Promise<{ templates: LetterTemplateDetail[] }> {
    return { templates: await this.manage.all() };
  }

  @Post('letter-templates')
  @RequirePermissions('users.manage')
  async add(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<LetterTemplateDetail> {
    const parsed = createLetterTemplateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a letter');
    }
    const added = await this.manage.add(caller, parsed.data);
    if (!added.ok) throw new ConflictException(added.error.message);
    return this.mustFind(added.value);
  }

  @Patch('letter-templates/:code')
  @RequirePermissions('users.manage')
  async change(
    @CurrentCaller() caller: Caller,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<LetterTemplateDetail> {
    const parsed = updateLetterTemplateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a change');
    }
    const changed = await this.manage.change(caller, code, parsed.data);
    if (!changed.ok) {
      if (changed.error.message === 'No such letter') {
        throw new NotFoundException(changed.error.message);
      }
      throw new ConflictException(changed.error.message);
    }
    return this.mustFind(code);
  }

  private async mustFind(code: string): Promise<LetterTemplateDetail> {
    const found = (await this.manage.all()).find((template) => template.code === code);
    if (!found) throw new NotFoundException('No such letter');
    return found;
  }

  @Get('clients/:clientId/letters')
  async history(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
  ): Promise<{ letters: Letter[] }> {
    return { letters: await this.letters.history(caller, clientId) };
  }

  @Post('clients/:clientId/letters')
  @RequirePermissions('clients.edit')
  async generate(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ): Promise<Letter> {
    const parsed = generateLetterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Which letter, and in which language?');

    const outcome = await this.letters.generate(caller, { clientId, ...parsed.data });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return outcome.value;
  }
}
