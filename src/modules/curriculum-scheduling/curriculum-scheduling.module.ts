import { Module } from '@nestjs/common';
import { CurriculumSchedulingController } from './curriculum-scheduling.controller';
import { CurriculumSchedulingService } from './curriculum-scheduling.service';
import { CurriculumLifecycleWorker } from './curriculum-lifecycle.worker';

@Module({
  controllers: [CurriculumSchedulingController],
  providers: [CurriculumSchedulingService, CurriculumLifecycleWorker],
})
export class CurriculumSchedulingModule {}
