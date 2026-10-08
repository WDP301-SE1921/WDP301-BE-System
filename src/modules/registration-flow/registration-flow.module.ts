import { Module } from '@nestjs/common';

import { RegistrationFlowController } from './registration-flow.controller';
import { RegistrationFlowService } from './registration-flow.service';
import { SubjectsController } from './subjects.controller';

@Module({
  controllers: [RegistrationFlowController, SubjectsController],
  providers: [RegistrationFlowService],
})
export class RegistrationFlowModule {}
