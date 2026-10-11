import type { BranchView } from '@amc/contracts';
import { createBranchSchema, updateBranchSchema } from '@amc/contracts';
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
import { Branches } from './branches.repository.js';

/**
 * The firm's branches (feedback item 12b).
 *
 * Reading is open to anybody signed in: a quotation screen has to offer them,
 * and a printed document needs the letterhead. Changing one is `users.manage`,
 * the manager's, like the other lists — which branch's bank account an
 * invoice prints is not something every accountant should be able to edit.
 */
@Controller('branches')
export class BranchesController {
  constructor(@Inject(Branches) private readonly branches: Branches) {}

  @Get()
  async all(): Promise<{ branches: BranchView[] }> {
    return { branches: await this.branches.all() };
  }

  @Post()
  @RequirePermissions('users.manage')
  async add(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<BranchView> {
    const parsed = createBranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a branch');
    }
    const added = await this.branches.add(caller, parsed.data);
    if (!added.ok) throw new ConflictException(added.error.message);
    return this.mustFind(added.value);
  }

  @Patch(':code')
  @RequirePermissions('users.manage')
  async change(
    @CurrentCaller() caller: Caller,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<BranchView> {
    const parsed = updateBranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a change');
    }
    const changed = await this.branches.change(caller, code, parsed.data);
    if (!changed.ok) throw new NotFoundException(changed.error.message);
    return this.mustFind(code);
  }

  private async mustFind(code: string): Promise<BranchView> {
    const found = (await this.branches.all()).find((branch) => branch.code === code);
    if (!found) throw new NotFoundException('No such branch');
    return found;
  }
}
