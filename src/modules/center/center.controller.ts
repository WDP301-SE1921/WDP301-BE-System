import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { DatabaseService } from '../../database/orm/database.service';
import { CenterInfoDto } from './center-info.dto';
import { CENTER_PROFILE_ID } from './center-profile';

@Public()
@ApiTags('center')
@Controller({ path: 'center', version: '1' })
export class CenterController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({
    summary: 'Center contact details',
    description:
      'Public. Read from the center_profiles row that `pnpm seed` creates (demo values in demo mode, CENTER_* environment values applied on every seed). Every field is null when the row is missing or the value is not set.',
  })
  @ApiOkResponse({ type: CenterInfoDto })
  async info(): Promise<CenterInfoDto> {
    const profile = await this.db.centerProfile.findUnique({ where: { id: CENTER_PROFILE_ID } });
    return {
      name: profile?.name ?? null,
      address: profile?.address ?? null,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      openingHours: profile?.openingHours ?? null,
    };
  }
}
