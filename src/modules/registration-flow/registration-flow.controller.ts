import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  ClassDto,
  ClassFilterDto,
  ConfirmPaymentDto,
  CreateRegistrationDto,
  CreateStudentDto,
  ListPaymentsDto,
  ListRegistrationsDto,
  ListStudentsDto,
  PageDto,
  ParentLookupDto,
  ParentSearchDto,
  ParentSuggestionDto,
  ProgramDto,
  ReplaceClassSchedulesDto,
  UpdateClassDto,
  UpdateProgramDto,
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

  @Get('students')
  @ApiOperation({ summary: 'Staff/manager: search student profiles with their parent' })
  students(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListStudentsDto,
  ): Promise<unknown> {
    return this.flow.listStudents(user, query);
  }

  @Get('students/:id/enrollments')
  @ApiOperation({ summary: 'Staff/manager: view a student enrollments and receipts' })
  studentEnrollments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.studentEnrollments(user, id);
  }

  @Get('students/:id/schedule')
  @ApiOperation({ summary: 'Staff/manager: view a student current weekly schedule by placement' })
  studentSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.studentSchedule(user, id);
  }

  @Get('parents/lookup')
  @ApiOperation({ summary: 'Staff/manager: look up a parent by exact email' })
  lookupParent(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentLookupDto,
  ): Promise<unknown> {
    return this.flow.lookupParent(user, query.email);
  }

  @Get('parents/search')
  @ApiOperation({ summary: 'Staff: suggest parent accounts matching a partial email' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string', format: 'email' },
              displayName: { type: 'string', nullable: true },
              status: { type: 'string', enum: ['ACTIVE', 'DISABLED'] },
            },
          },
        },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Only STAFF can search parent account suggestions.' })
  searchParents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentSearchDto,
  ): Promise<ParentSuggestionDto[]> {
    return this.flow.searchParents(user, query);
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

  @Patch('programs/:id')
  @ApiOperation({ summary: 'Manager: update a program; grade/subject lock once it is in use' })
  updateProgram(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateProgramDto,
  ): Promise<unknown> {
    return this.flow.updateProgram(user, id, input);
  }

  @Delete('programs/:id')
  @ApiOperation({ summary: 'Manager: delete a program that has no classes or lessons' })
  deleteProgram(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.deleteProgram(user, id);
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

  @Get('classes/:id')
  @ApiOperation({ summary: 'Class detail with program, teacher, weekly schedule and enrollments' })
  classDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: PageDto,
  ): Promise<unknown> {
    return this.flow.getClass(user, id, page);
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
  @ApiOperation({
    summary: 'Staff: create an offline registration draft; Idempotency-Key makes retries safe',
  })
  createRegistration(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateRegistrationDto,
  ): Promise<unknown> {
    return this.flow.createRegistration(user, input, idempotencyKey);
  }

  @Get('registrations')
  @ApiOperation({ summary: 'Staff/manager: list registrations by status, date and search text' })
  registrations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRegistrationsDto,
  ): Promise<unknown> {
    return this.flow.listRegistrations(user, query);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Staff/manager: center-wide payment history with the real total' })
  payments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPaymentsDto,
  ): Promise<unknown> {
    return this.flow.listPayments(user, query);
  }

  @Get('registrations/:id')
  @ApiOperation({ summary: 'Staff or owning parent: read a registration' })
  registration(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.registration(user, id);
  }

  @Post('registrations/:id/cancel')
  @ApiOperation({ summary: 'Staff: cancel a draft registration' })
  cancelRegistration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.cancelRegistration(user, id);
  }

  @Post('registrations/:id/confirm-payment')
  @ApiOperation({ summary: 'Staff: confirm full offline payment and enroll the selected child' })
  confirmPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ConfirmPaymentDto,
  ): Promise<unknown> {
    return this.flow.confirmPayment(user, id, idempotencyKey, input.receiptNumber);
  }

  @Get('registrations/:id/receipt')
  @ApiOperation({ summary: 'Staff or owning parent: read a registration receipt' })
  receipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.receipt(user, id);
  }
}
