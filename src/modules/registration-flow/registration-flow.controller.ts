import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  ClassDto,
  ClassFilterDto,
  ConfirmPaymentDto,
  CreateRegistrationDto,
  CreateStudentDto,
  PageDto,
  ParentLookupDto,
  ProgramDto,
  ReplaceClassSchedulesDto,
  UpdateClassDto,
  UpdateStudentDto,
} from './dto/registration-flow.dto';
import { RegistrationFlowService } from './registration-flow.service';

@ApiBearerAuth()
@ApiTags('parent-registration-flow')
@Controller({ version: '1' })
export class RegistrationFlowController {
  constructor(private readonly flow: RegistrationFlowService) {}

  @Get('me/students')
  @ApiOperation({ summary: 'Parent: list own student profiles' })
  myStudents(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.flow.listMyStudents(user);
  }

  @Post('me/students')
  @ApiOperation({ summary: 'Parent: create a student profile after email verification' })
  createStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateStudentDto,
  ): Promise<unknown> {
    return this.flow.createMyStudent(user, input);
  }

  @Patch('me/students/:id')
  @ApiOperation({ summary: 'Parent: update own student profile' })
  updateStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateStudentDto,
  ): Promise<unknown> {
    return this.flow.updateMyStudent(user, id, input);
  }

  @Get('me/students/:id/enrollments')
  @ApiOperation({ summary: 'Parent: view a child enrollments and receipts' })
  myStudentEnrollments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.myStudentEnrollments(user, id);
  }

  @Get('me/students/:id/schedule')
  @ApiOperation({ summary: 'Parent: view a child fixed weekly class schedule' })
  myStudentSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.myStudentSchedule(user, id);
  }

  @Get('parents/lookup')
  @ApiOperation({ summary: 'Staff/manager: look up a parent by exact email' })
  lookupParent(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentLookupDto,
  ): Promise<unknown> {
    return this.flow.lookupParent(user, query.email);
  }

  @Post('programs')
  @ApiOperation({ summary: 'Manager: create a grade/subject program' })
  createProgram(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ProgramDto,
  ): Promise<unknown> {
    return this.flow.createProgram(user, input);
  }

  @Get('programs')
  @ApiOperation({ summary: 'List grade/subject programs' })
  programs(@CurrentUser() user: AuthenticatedUser, @Query() page: PageDto): Promise<unknown> {
    return this.flow.listPrograms(user, page);
  }

  @Post('classes')
  @ApiOperation({ summary: 'Manager: create a class' })
  createClass(@CurrentUser() user: AuthenticatedUser, @Body() input: ClassDto): Promise<unknown> {
    return this.flow.createClass(user, input);
  }

  @Patch('classes/:id')
  @ApiOperation({ summary: 'Manager: update a class and open/close registration' })
  updateClass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateClassDto,
  ): Promise<unknown> {
    return this.flow.updateClass(user, id, input);
  }

  @Get('classes')
  @ApiOperation({ summary: 'List classes, optionally filtered by student and subject' })
  classes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ClassFilterDto,
  ): Promise<unknown> {
    return this.flow.listClasses(user, query);
  }

  @Post('classes/:id/schedules')
  @ApiOperation({ summary: 'Manager: replace fixed weekly schedules for a class' })
  replaceClassSchedules(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ReplaceClassSchedulesDto,
  ): Promise<unknown> {
    return this.flow.replaceClassSchedules(user, id, input);
  }

  @Post('registrations')
  @ApiOperation({ summary: 'Staff/manager: create an offline registration draft' })
  createRegistration(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateRegistrationDto,
  ): Promise<unknown> {
    return this.flow.createRegistration(user, input);
  }

  @Get('registrations/:id')
  @ApiOperation({ summary: 'Read a registration' })
  registration(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.registration(user, id);
  }

  @Post('registrations/:id/cancel')
  @ApiOperation({ summary: 'Staff/manager: cancel a draft registration' })
  cancelRegistration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.cancelRegistration(user, id);
  }

  @Post('registrations/:id/confirm-payment')
  @ApiOperation({ summary: 'Staff/manager: confirm full offline payment and activate enrollment' })
  confirmPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ConfirmPaymentDto,
  ): Promise<unknown> {
    return this.flow.confirmPayment(user, id, idempotencyKey, input.receiptNumber);
  }

  @Get('registrations/:id/receipt')
  @ApiOperation({ summary: 'Read a registration receipt' })
  receipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.receipt(user, id);
  }
}
