import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DirectoryService } from './directory.service';
import {
  CreateStaffAccountDto,
  DirectoryPageDto,
  AuditLogQueryDto,
  AcceptAccountInvitationDto,
  CreateAccountInvitationDto,
  DashboardQueryDto,
  ListAccountsDto,
  UpdateParentAccountDto,
  UpdateStaffAccountDto,
  ReviewAccountInvitationDto,
} from './dto/directory.dto';

@ApiBearerAuth()
@ApiTags('directory')
@Controller({ version: '1' })
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('staff')
  @ApiOperation({ summary: 'Manager: list staff accounts' })
  listStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAccountsDto,
  ): Promise<unknown> {
    return this.directory.listAccounts(user, 'STAFF', query);
  }

  @Post('staff')
  @ApiOperation({ summary: 'Manager: create a staff account with an initial password' })
  createStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateStaffAccountDto,
  ): Promise<unknown> {
    return this.directory.createAccount(user, 'STAFF', input);
  }

  @Get('staff/:id')
  @ApiOperation({ summary: 'Manager: read a staff account' })
  getStaff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.directory.getAccount(user, 'STAFF', id);
  }

  @Patch('staff/:id')
  @ApiOperation({
    summary: 'Manager: rename or disable/enable a staff account (never hard-deleted)',
  })
  updateStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateStaffAccountDto,
  ): Promise<unknown> {
    return this.directory.updateAccount(user, 'STAFF', id, input);
  }

  @Get('teachers')
  @ApiOperation({ summary: 'Manager/staff: list teachers, e.g. ?status=ACTIVE&search=nguyen' })
  listTeachers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAccountsDto,
  ): Promise<unknown> {
    return this.directory.listAccounts(user, 'TEACHER', query);
  }

  @Post('teachers')
  @ApiOperation({ summary: 'Deprecated: use teacher invitations and review (returns 410)' })
  createTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateStaffAccountDto,
  ): Promise<unknown> {
    return this.directory.createAccount(user, 'TEACHER', input);
  }

  @Get('teachers/:id')
  @ApiOperation({ summary: 'Manager/staff: read a teacher account' })
  getTeacher(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.directory.getAccount(user, 'TEACHER', id);
  }

  @Patch('teachers/:id')
  @ApiOperation({
    summary: 'Manager: rename or disable/enable a teacher account (never hard-deleted)',
  })
  updateTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateStaffAccountDto,
  ): Promise<unknown> {
    return this.directory.updateAccount(user, 'TEACHER', id, input);
  }

  @Get('curriculum-designers')
  @ApiOperation({ summary: 'Manager: list curriculum designer accounts (BE-10)' })
  listDesigners(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAccountsDto,
  ): Promise<unknown> {
    return this.directory.listAccounts(user, 'CURRICULUM_DESIGNER', query);
  }

  @Post('curriculum-designers')
  @ApiOperation({ summary: 'Manager: create a curriculum designer account' })
  createDesigner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateStaffAccountDto,
  ): Promise<unknown> {
    return this.directory.createAccount(user, 'CURRICULUM_DESIGNER', input);
  }

  @Get('curriculum-designers/:id')
  getDesigner(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.directory.getAccount(user, 'CURRICULUM_DESIGNER', id);
  }

  @Patch('curriculum-designers/:id')
  @ApiOperation({ summary: 'Manager: rename or disable/enable a curriculum designer' })
  updateDesigner(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateStaffAccountDto,
  ): Promise<unknown> {
    return this.directory.updateAccount(user, 'CURRICULUM_DESIGNER', id, input);
  }

  @Get('parents')
  @ApiOperation({ summary: 'Manager/staff: list parent accounts' })
  listParents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAccountsDto,
  ): Promise<unknown> {
    return this.directory.listParents(user, query);
  }

  @Get('parents/:id')
  @ApiOperation({ summary: 'Manager: read a parent account with children' })
  getParent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.directory.getParent(user, id);
  }

  @Patch('parents/:id')
  @ApiOperation({ summary: 'Manager: update parent name, phone or status (no password/email)' })
  updateParent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateParentAccountDto,
  ): Promise<unknown> {
    return this.directory.updateParent(user, id, input);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Manager: confirmed tuition and active account counts' })
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<unknown> {
    return this.directory.dashboard(user, query);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Manager: search immutable audit history' })
  auditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditLogQueryDto,
  ): Promise<unknown> {
    return this.directory.auditLogs(user, query);
  }

  @Get('managers')
  @ApiOperation({ summary: 'Manager: list manager accounts' })
  managers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAccountsDto,
  ): Promise<unknown> {
    return this.directory.listManagers(user, query);
  }

  @Post('teacher-invitations')
  inviteTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateAccountInvitationDto,
  ): Promise<unknown> {
    return this.directory.invite(user, 'TEACHER', input);
  }

  @Get('teacher-invitations')
  teacherInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: DirectoryPageDto,
  ): Promise<unknown> {
    return this.directory.invitations(user, 'TEACHER', page);
  }

  @Post('manager-invitations')
  inviteManager(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateAccountInvitationDto,
  ): Promise<unknown> {
    return this.directory.invite(user, 'MANAGER', input);
  }

  @Get('manager-invitations')
  managerInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: DirectoryPageDto,
  ): Promise<unknown> {
    return this.directory.invitations(user, 'MANAGER', page);
  }

  @Public()
  @Post('account-invitations/accept')
  acceptInvitation(@Body() input: AcceptAccountInvitationDto): Promise<unknown> {
    return this.directory.acceptInvitation(input);
  }

  @Post('account-invitations/:id/review')
  reviewInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ReviewAccountInvitationDto,
  ): Promise<unknown> {
    return this.directory.reviewInvitation(user, id, input);
  }

  @Post('account-invitations/:id/revoke')
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.directory.revokeInvitation(user, id);
  }

  @Post('account-invitations/:id/resend')
  @ApiOperation({ summary: 'Manager: rotate token and resend an unused invitation' })
  resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.directory.resendInvitation(user, id);
  }
}
