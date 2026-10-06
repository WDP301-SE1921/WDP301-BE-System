import { Module } from '@nestjs/common';
import { CurriculumSchedulingController } from './curriculum-scheduling.controller';
import { CurriculumSchedulingService } from './curriculum-scheduling.service';

@Module({
  controllers: [CurriculumSchedulingController],
  providers: [CurriculumSchedulingService],
})
export class CurriculumSchedulingModule {}
