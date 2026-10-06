import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppConfigModule } from './config/config.module';
import type { AppConfiguration } from './config/configuration';
import { DatabaseModule } from './database/orm/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { AcademicModule } from './modules/academic/academic.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { RegistrationFlowModule } from './modules/registration-flow/registration-flow.module';
import { CurriculumSchedulingModule } from './modules/curriculum-scheduling/curriculum-scheduling.module';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>) => [
        { ttl: 60_000, limit: config.get('throttleLimitPerMinute', { infer: true }) },
      ],
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    AcademicModule,
    CurriculumSchedulingModule,
    RegistrationFlowModule,
    // After RegistrationFlowModule so static parents/search and parents/lookup win over parents/:id.
    DirectoryModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
