import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminController } from './admin.controller';
import { AdminReadService } from './admin-read.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminSystemService } from './admin-system.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminAccountsService, AdminSystemService, AdminRecordsService, AdminReadService],
})
export class AdminModule {}
