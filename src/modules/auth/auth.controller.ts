import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { AvatarUrlResponseDto, DeleteAvatarResponseDto } from './dto/avatar-response.dto';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
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
import { DeleteAccountDto, DeleteAccountResponseDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RealtimeTicketDto } from './dto/realtime-ticket.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterParentDto } from './dto/register-parent.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';

@ApiTags('auth')
@ApiExtraModels(
  AuthResponseDto,
  LogoutResponseDto,
  RealtimeTicketDto,
  SafeUserDto,
  AvatarUrlResponseDto,
  DeleteAvatarResponseDto,
  DeleteAccountResponseDto,
)
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
      'Rotates the refresh token and extends the session by JWT_REFRESH_TTL_SECONDS, never past JWT_SESSION_MAX_AGE_SECONDS after login. FE should replace both stored tokens with the returned pair. Reusing an old refresh token revokes that session.',
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
  @ApiOperation({
    summary: 'Verify a parent email address',
    description:
      'Send `email` with the 6-digit `code` from the email. The code expires after 15 minutes and stops working after 5 wrong tries (AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED); only the newest code works. `token` still accepts the long token of emails sent before codes.',
  })
  @ApiOkResponse({ description: 'Email verified.' })
  @ApiBadRequestResponse({
    description:
      'AUTH_INVALID_EMAIL_TOKEN (wrong, used or expired code), AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED, or VALIDATION_ERROR.',
    type: ApiErrorResponseDto,
  })
  verifyEmail(@Body() body: VerifyEmailDto): Promise<{ verified: true }> {
    return this.authService.verifyEmail(body);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Resend parent email verification code',
    description:
      'Issues a new 6-digit code and expires the previous ones. At most 5 codes per account per hour (429 AUTH_VERIFICATION_RATE_LIMITED).',
  })
  @ApiOkResponse({ description: 'Verification email accepted for delivery when configured.' })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests, or AUTH_VERIFICATION_RATE_LIMITED.',
    type: ApiErrorResponseDto,
  })
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

  @Post('realtime-ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Issue a realtime ticket',
    description:
      'Returns a 60-second token for the /notifications socket handshake of the current session. It is not accepted by REST endpoints. Web clients whose access token stays in an httpOnly cookie use this instead of exposing the access token.',
  })
  @ApiOkResponse({
    description: 'Ticket for the current session.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/RealtimeTicketDto' }),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked access token.',
    type: ApiErrorResponseDto,
  })
  realtimeTicket(@CurrentUser() user: AuthenticatedUser): Promise<RealtimeTicketDto> {
    return this.authService.createRealtimeTicket(user);
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

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete the current parent account',
    description:
      'Parent only. Confirms with the current password, then soft deletes the account and removes its personal data (name, phone, avatar, password; the email is replaced so it can register again) and revokes every session. Children, enrollments, grades and registration orders stay with the center. Wrong password returns 400 AUTH_CURRENT_PASSWORD_INVALID; other roles get 403 AUTH_ACCOUNT_DELETE_NOT_ALLOWED.',
  })
  @ApiOkResponse({
    description: 'Account deleted; the access token stops working.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/DeleteAccountResponseDto' }),
  })
  @ApiBadRequestResponse({
    description: 'AUTH_CURRENT_PASSWORD_INVALID or VALIDATION_ERROR.',
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH_ACCOUNT_DELETE_NOT_ALLOWED for non-parent accounts.',
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts.', type: ApiErrorResponseDto })
  deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeleteAccountDto,
  ): Promise<DeleteAccountResponseDto> {
    return this.authService.deleteOwnAccount(user, body.password);
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

  @Get('me/avatar')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user avatar signed URL',
    description:
      'Returns a signed URL for current user avatar (expires in 900 seconds) or null if no avatar is set.',
  })
  @ApiOkResponse({
    description: 'Current user avatar access URL.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/AvatarUrlResponseDto' }),
  })
  getAvatar(@CurrentUser() user: AuthenticatedUser): Promise<AvatarUrlResponseDto> {
    return this.authService.getAvatar(user);
  }

  @Put('me/avatar')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload or update current user avatar',
    description:
      'Uploads a new avatar image (PNG or JPEG, up to 5MB) and replaces the previous avatar.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file (PNG/JPEG up to 5MB)',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Updated avatar signed URL.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/AvatarUrlResponseDto' }),
  })
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer rejects at its limit; validation still caps accepted files at 5 MiB.
      limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 0 },
    }),
  )
  updateAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AvatarUrlResponseDto> {
    return this.authService.updateAvatar(user, file);
  }

  @Delete('me/avatar')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete current user avatar',
    description: 'Removes the avatar for current user account and cleans up storage.',
  })
  @ApiOkResponse({
    description: 'Avatar deleted status.',
    schema: successEnvelopeSchema({ $ref: '#/components/schemas/DeleteAvatarResponseDto' }),
  })
  deleteAvatar(@CurrentUser() user: AuthenticatedUser): Promise<DeleteAvatarResponseDto> {
    return this.authService.deleteAvatar(user);
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
