import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../../database/orm/database.module';
import { UsersModule } from '../users/users.module';
import { AuthSessionsRepository } from './auth-sessions.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [DatabaseModule, JwtModule.register({}), PassportModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthSessionsRepository, AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
