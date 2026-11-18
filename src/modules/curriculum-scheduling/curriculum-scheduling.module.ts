import { Module } from '@nestjs/common';
import { CurriculumSchedulingController } from './curriculum-scheduling.controller';
import { CurriculumSchedulingService } from './curriculum-scheduling.service';
import { CurriculumLifecycleWorker } from './curriculum-lifecycle.worker';
import { SessionRowsRepository } from './session-rows.repository';

@Module({
  controllers: [CurriculumSchedulingController],
  providers: [CurriculumSchedulingService, CurriculumLifecycleWorker, SessionRowsRepository],
})
export class CurriculumSchedulingModule {}
