import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminReadService } from './admin-read.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminSystemService } from './admin-system.service';
import {
  AdminAccountQueryDto,
  CreateAdminAccountDto,
  CreateAdminStudentDto,
  RECORD_KINDS,
  RecordReasonDto,
  type RecordKind,
  SetAccountStatusDto,
  UpdateAdminAccountDto,
  UpdateCenterDto,
} from './dto/admin.dto';

/** Loại bản ghi hợp lệ cho /admin/records/:kind (lạ → 404). */
const KIND_ENUM = Object.fromEntries(RECORD_KINDS.map((kind) => [kind, kind]));

/**
 * API chỉ dành cho Admin tổng (role ADMIN). Các API vận hành sẵn có (học vụ, tài chính, nhân sự)
 * ADMIN dùng trực tiếp vì được làm mọi việc của MANAGER và STAFF (common/auth/role-access.ts).
 */
@ApiBearerAuth()
@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly system: AdminSystemService,
    private readonly read: AdminReadService,
    private readonly records: AdminRecordsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Admin: system-wide counters for the overview screen' })
  overview(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.system.overview(user);
  }

  @Get('services')
  @ApiOperation({ summary: 'Admin: service status (configured / reachable), never secrets' })
  services(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.system.services(user);
  }

  @Patch('center')
  @ApiOperation({ summary: 'Admin: update the center contact profile' })
  updateCenter(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateCenterDto,
  ): Promise<unknown> {
    return this.system.updateCenter(user, input);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'Admin: list accounts of every role (paginated)' })
  listAccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminAccountQueryDto,
  ): Promise<unknown> {
    return this.accounts.list(user, query);
  }

  @Post('accounts')
  @ApiOperation({
    summary: 'Admin: create an internal account (admin, manager, staff, teacher, designer)',
  })
  createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateAdminAccountDto,
  ): Promise<unknown> {
    return this.accounts.create(user, input);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Admin: read an account with its active sessions' })
  getAccount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.accounts.get(user, id);
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Admin: rename an account' })
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateAdminAccountDto,
  ): Promise<unknown> {
    return this.accounts.update(user, id, input);
  }

  @Patch('accounts/:id/status')
  @ApiOperation({
    summary:
      'Admin: disable / enable an account with a reason (never yourself, never the last admin)',
  })
  setAccountStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: SetAccountStatusDto,
  ): Promise<unknown> {
    return this.accounts.setStatus(user, id, input);
  }

  @Post('accounts/:id/password-reset')
  @ApiOperation({ summary: 'Admin: email a password reset link to an active account' })
  sendPasswordReset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.accounts.sendPasswordReset(user, id);
  }

  @Delete('accounts/:id/sessions')
  @ApiOperation({ summary: 'Admin: revoke every session of an account (keeps your current one)' })
  revokeSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.accounts.revokeSessions(user, id);
  }

  // ---- Xóa mềm / khôi phục (Phase 4) ----

  @Delete('records/:kind/:id')
  @ApiOperation({
    summary:
      'Admin: soft delete a record (account, parent, student, subject, program, class, room); 409 RECORD_IN_USE while live records depend on it',
  })
  deleteRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ParseEnumPipe(KIND_ENUM, { errorHttpStatusCode: HttpStatus.NOT_FOUND }))
    kind: RecordKind,
    @Param('id') id: string,
    @Body() input: RecordReasonDto,
  ): Promise<unknown> {
    return this.records.remove(user, kind, id, input.reason);
  }

  @Post('records/:kind/:id/restore')
  @ApiOperation({ summary: 'Admin: restore a soft-deleted record to its state before deletion' })
  restoreRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ParseEnumPipe(KIND_ENUM, { errorHttpStatusCode: HttpStatus.NOT_FOUND }))
    kind: RecordKind,
    @Param('id') id: string,
    @Body() input: RecordReasonDto,
  ): Promise<unknown> {
    return this.records.restore(user, kind, id, input.reason);
  }

  // ---- Đọc cho web Admin (gồm cả bản ghi đã xóa) ----

  @Get('parents')
  @ApiOperation({ summary: 'Admin: every parent account with children, including deleted ones' })
  parents(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.read.parents(user);
  }

  @Get('parents/:id')
  @ApiOperation({
    summary: 'Admin: parent detail with children and registrations (null if missing)',
  })
  parent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.read.parent(user, id);
  }

  @Get('students')
  @ApiOperation({ summary: 'Admin: every student profile with parent and live classes' })
  students(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.read.students(user);
  }

  @Post('students')
  @ApiOperation({ summary: 'Admin: add a student profile under a parent account' })
  createStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateAdminStudentDto,
  ): Promise<unknown> {
    return this.read.createStudent(user, input);
  }

  @Get('students/:id')
  @ApiOperation({
    summary: 'Admin: student detail with live classes (enrollment ids) and registrations',
  })
  student(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.read.student(user, id);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Admin: subjects and programs, including deleted ones' })
  catalog(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.read.catalog(user);
  }

  @Get('classrooms')
  @ApiOperation({ summary: 'Admin: classes and rooms (including deleted) plus form options' })
  classrooms(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.read.classrooms(user);
  }

  @Get('classes/:id')
  @ApiOperation({ summary: 'Admin: class detail with enrolled students and registrations' })
  classDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.read.classDetail(user, id);
  }

  @Get('registration-options')
  @ApiOperation({ summary: 'Admin: active students and open classes for the registration form' })
  registrationOptions(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.read.registrationOptions(user);
  }
}
