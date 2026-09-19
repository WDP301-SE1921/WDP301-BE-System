import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/orm/database.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
