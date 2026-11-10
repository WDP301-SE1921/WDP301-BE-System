import { Module } from '@nestjs/common';
import { CurriculumSchedulingController } from './curriculum-scheduling.controller';
import { CurriculumSchedulingService } from './curriculum-scheduling.service';
import { CurriculumLifecycleWorker } from './curriculum-lifecycle.worker';
import { SessionCancellationService } from './session-cancellation.service';
import { SessionCancellationRepository } from './session-cancellation.repository';
import { CenterClosureService } from './center-closure.service';

@Module({
  controllers: [CurriculumSchedulingController],
  providers: [
    CurriculumSchedulingService,
    CurriculumLifecycleWorker,
    SessionCancellationService,
    SessionCancellationRepository,
    CenterClosureService,
  ],
})
export class CurriculumSchedulingModule {}
