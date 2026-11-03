import { Module } from '@nestjs/common';

import { CenterController } from './center.controller';

@Module({
  controllers: [CenterController],
})
export class CenterModule {}
