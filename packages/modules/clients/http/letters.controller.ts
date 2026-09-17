import type { Letter, LetterTemplate } from '@amc/contracts';
import { generateLetterSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { GenerateLetter } from '../application/generate-letter.js';

/**
 * Letters the firm sends, filled in from the client's own record (FR-15).
 *
 * Generating one is a POST because it records what was produced. A letter is
 * a thing that was sent, and the copy is kept rather than regenerated later
 * from wording and a client record that may both have moved on.
 */
@Controller()
export class LettersController {
  constructor(@Inject(GenerateLetter) private readonly letters: GenerateLetter) {}

  @Get('letter-templates')
  async templates(): Promise<{ templates: LetterTemplate[] }> {
    return { templates: await this.letters.templates() };
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
