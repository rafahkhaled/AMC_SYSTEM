import { type CampaignView, createCampaignSchema, updateCampaignSchema } from '@amc/contracts';
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
import { Campaigns } from './campaigns.repository.js';

/**
 * Advertising campaigns.
 *
 * Anybody signed in may read them: an enquiry is attributed to one while it is
 * being captured, by whoever is on the phone. Creating one and changing what it
 * cost is `users.manage`, the manager's, like the other lists in Settings.
 */
@Controller('campaigns')
export class CampaignsController {
  constructor(@Inject(Campaigns) private readonly campaigns: Campaigns) {}

  @Get()
  async all(): Promise<{ campaigns: CampaignView[] }> {
    return { campaigns: await this.campaigns.all() };
  }

  @Post()
  @RequirePermissions('users.manage')
  async add(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<CampaignView> {
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a campaign');
    }
    const added = await this.campaigns.add(caller, parsed.data);
    if (!added.ok) throw new ConflictException(added.error.message);
    return this.mustFind(added.value);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  async change(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CampaignView> {
    const parsed = updateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That is not a change');
    }
    const changed = await this.campaigns.change(caller, id, parsed.data);
    if (!changed.ok) {
      if (changed.error.message === 'No such campaign') {
        throw new NotFoundException(changed.error.message);
      }
      throw new ConflictException(changed.error.message);
    }
    return this.mustFind(id);
  }

  private async mustFind(id: string): Promise<CampaignView> {
    const found = await this.campaigns.find(id);
    if (!found) throw new NotFoundException('No such campaign');
    return found;
  }
}
