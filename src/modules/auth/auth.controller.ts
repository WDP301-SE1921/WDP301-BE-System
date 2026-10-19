import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SafeUserDto } from '../users/safe-user.dto';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterParentDto } from './dto/register-parent.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';

@ApiTags('auth')
@ApiExtraModels(AuthResponseDto, LogoutResponseDto, SafeUserDto)
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a parent account',
    description:
      'Creates a PARENT user and parent profile, then returns the same token contract as login. Teacher and manager accounts are not self-registered.',
  })
  @ApiCreatedResponse({
    description: 'Parent account created and authenticated.',
    schema: successEnvelopeSchema(authResponseSchema()),
  })
  @ApiBadRequestResponse({ description: 'Validation failed.', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'Email is already registered.', type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'Too many register attempts.',
    type: ApiErrorResponseDto,
  })
  register(@Body() body: RegisterParentDto): Promise<AuthResponseDto> {
    return this.authService.registerParent(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log in',
    description:
      'Returns an access token for Bearer authentication and a refresh token for rotation.',
  })
  @ApiOkResponse({
    description: 'Authenticated successfully.',
    schema: successEnvelopeSchema(authResponseSchema()),
  })
  @ApiBadRequestResponse({ description: 'Validation failed.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.', type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'Too many login attempts.',
    type: ApiErrorResponseDto,
  })
  login(@Body() body: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Refresh token pair',
    description:
      'Rotates the refresh token. FE should replace both stored tokens with the returned pair. Reusing an old refresh token revokes that session.',
  })
  @ApiOkResponse({
    description: 'Token pair refreshed.',
    schema: successEnvelopeSchema(authResponseSchema()),
  })
  @ApiBadRequestResponse({ description: 'Validation failed.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token.', type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'Too many refresh attempts.',
    type: ApiErrorResponseDto,
  })
  refresh(@Body() body: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(body.refreshToken);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a parent email address' })
  @ApiOkResponse({ description: 'Email verified.' })
  verifyEmail(@Body() body: VerifyEmailDto): Promise<{ verified: true }> {
    return this.authService.verifyEmail(body.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend parent email verification token' })
  @ApiOkResponse({ description: 'Verification email accepted for delivery when configured.' })
  resendVerification(@Body() body: ResendVerificationDto): Promise<{ sent: boolean }> {
    return this.authService.resendVerification(body.email);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out',
    description: 'Revokes the current Bearer session. Other device sessions are not affected.',
  })
  @ApiOkResponse({
    description: 'Current session was revoked.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/LogoutResponseDto' }),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked access token.',
    type: ApiErrorResponseDto,
  })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<{ revoked: true }> {
    return this.authService.logout(user.sessionId);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user',
    description: 'Returns the authenticated user linked to the current active session.',
  })
  @ApiOkResponse({
    description: 'Current user.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/SafeUserDto' }),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked access token.',
    type: ApiErrorResponseDto,
  })
  me(@CurrentUser() user: AuthenticatedUser): Promise<SafeUserDto> {
    return this.authService.currentProfile(user);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the current display name and parent phone' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ): Promise<SafeUserDto> {
    return this.authService.updateProfile(user, body);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password and revoke the other sessions',
    description:
      'Wrong current password returns 400 AUTH_CURRENT_PASSWORD_INVALID without revoking this session.',
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
  ): Promise<{ changed: true }> {
    return this.authService.changePassword(user, body);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  forgotPassword(@Body() body: ForgotPasswordDto): Promise<{ accepted: true }> {
    return this.authService.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() body: ResetPasswordDto): Promise<{ reset: true }> {
    return this.authService.resetPassword(body);
  }
}

function successEnvelopeSchema(dataSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: dataSchema,
    },
  };
}

function authResponseSchema(): Record<string, unknown> {
  return { $ref: '#/components/schemas/AuthResponseDto' };
}
