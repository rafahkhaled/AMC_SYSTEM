import type { ReferenceList, ReferenceOption } from '@amc/contracts';
import {
  addReferenceOptionSchema,
  referenceLists,
  updateReferenceOptionSchema,
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
import { ReferenceOptions } from './reference-options.repository.js';

function asList(name: string): ReferenceList {
  if (!(referenceLists as readonly string[]).includes(name)) {
    // Naming the lists that do exist, because the ones that cannot be edited
    // are a deliberate decision and somebody asking deserves to know.
    throw new NotFoundException(`No such list. Editable lists are: ${referenceLists.join(', ')}`);
  }
  return name as ReferenceList;
}

/**
 * The dropdowns an administrator can extend (FR-03).
 *
 * Reading is open to anybody signed in — every screen with a dropdown needs
 * it, and a list of document types is not a secret. Changing one is
 * `users.manage`, the manager's.
 */
@Controller('lists')
export class ListsController {
  constructor(@Inject(ReferenceOptions) private readonly options: ReferenceOptions) {}

  @Get()
  async all(): Promise<{ options: ReferenceOption[] }> {
    return { options: await this.options.all() };
  }

  @Get(':list')
  async one(@Param('list') list: string): Promise<{ options: ReferenceOption[] }> {
    return { options: await this.options.all(asList(list)) };
  }

  @Post(':list')
  @RequirePermissions('users.manage')
  async add(
    @CurrentCaller() caller: Caller,
    @Param('list') list: string,
    @Body() body: unknown,
  ): Promise<{ options: ReferenceOption[] }> {
    const parsed = addReferenceOptionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not an option');
    }

    const name = asList(list);
    const added = await this.options.add(name, parsed.data, caller.userId);
    if (!added) {
      // Already there, possibly retired. Saying so is more use than a silent
      // success that appears to do nothing.
      throw new ConflictException('That code is already in this list');
    }
    return { options: await this.options.all(name) };
  }

  @Patch(':list/:code')
  @RequirePermissions('users.manage')
  async update(
    @Param('list') list: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<{ options: ReferenceOption[] }> {
    const parsed = updateReferenceOptionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Nothing to change');

    const name = asList(list);
    const changed = await this.options.update(name, code, parsed.data);
    if (!changed) throw new NotFoundException('No such option');
    return { options: await this.options.all(name) };
  }
}
