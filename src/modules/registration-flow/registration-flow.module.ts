import { Module } from '@nestjs/common';

import { RegistrationFlowController } from './registration-flow.controller';
import { PaymentRefundsService } from './payment-refunds.service';
import { RegistrationFlowService } from './registration-flow.service';
import { SubjectsController } from './subjects.controller';

@Module({
  controllers: [RegistrationFlowController, SubjectsController],
  providers: [RegistrationFlowService, PaymentRefundsService],
})
export class RegistrationFlowModule {}
