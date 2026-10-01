import { Module } from '@nestjs/common';

import { RegistrationFlowController } from './registration-flow.controller';
import { RegistrationFlowService } from './registration-flow.service';

@Module({
  controllers: [RegistrationFlowController],
  providers: [RegistrationFlowService],
})
export class RegistrationFlowModule {}
