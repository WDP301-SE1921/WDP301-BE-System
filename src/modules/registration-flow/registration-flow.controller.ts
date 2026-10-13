import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
  ClassRosterQueryDto,
  ClassScheduleSlotDto,
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
  ProgramFilterDto,
  ReplaceClassSchedulesDto,
  RoomDto,
  SessionSubstitutionDto,
  ScheduleConfirmationDto,
  TeacherAssignmentDto,
  UpdateClassDto,
  UpdateProgramDto,
  UpdateRoomDto,
  UpdateStudentDto,
} from './dto/registration-flow.dto';
import { RegistrationFlowService } from './registration-flow.service';

@ApiBearerAuth()
@ApiTags('parent-registration-flow')
@Controller({ version: '1' })
export class RegistrationFlowController {
  constructor(private readonly flow: RegistrationFlowService) {}

  @Get('me/bills')
  @ApiOperation({ summary: 'Parent: list own registration bills, including unpaid drafts' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'object' } },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
      },
    },
  })
  myBills(@CurrentUser() user: AuthenticatedUser, @Query() page: PageDto): Promise<unknown> {
    return this.flow.myBills(user, page);
  }

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
  programs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filter: ProgramFilterDto,
  ): Promise<unknown> {
    return this.flow.listPrograms(user, filter);
  }

  @Get('programs/:id')
  programDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.getProgram(user, id);
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

  @Get('rooms')
  @ApiOperation({ summary: 'List rooms used by classes and sessions' })
  rooms(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.flow.listRooms(user);
  }

  @Post('rooms')
  @ApiOperation({ summary: 'Manager: create a room' })
  createRoom(@CurrentUser() user: AuthenticatedUser, @Body() input: RoomDto): Promise<unknown> {
    return this.flow.createRoom(user, input);
  }

  @Patch('rooms/:id')
  @ApiOperation({ summary: 'Manager: update or deactivate a room' })
  updateRoom(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateRoomDto,
  ): Promise<unknown> {
    return this.flow.updateRoom(user, id, input);
  }

  @Post('classes/:id/teacher-assignments')
  @ApiOperation({ summary: 'Manager: replace a class teacher from an effective time' })
  assignTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: TeacherAssignmentDto,
  ): Promise<unknown> {
    return this.flow.assignTeacher(user, id, input);
  }

  @Get('academic/sessions/:id/substitute-candidates')
  @ApiOperation({ summary: 'Manager: list active teachers available for a session' })
  substituteCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.substituteCandidates(user, id);
  }

  @Post('academic/sessions/:id/substitutions')
  @ApiOperation({ summary: 'Manager: assign a substitute to one scheduled session' })
  substitute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: SessionSubstitutionDto,
  ): Promise<unknown> {
    return this.flow.substitute(user, id, input);
  }

  @Put('classes/:id/schedule-confirmation')
  @ApiOperation({ summary: 'Assigned teacher confirms; manager may unlock a class schedule' })
  confirmSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ScheduleConfirmationDto,
  ): Promise<unknown> {
    return this.flow.confirmSchedule(user, id, input);
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
  @ApiOperation({
    summary: 'Class detail with program, room, teacher and placement roster',
    description: 'Future teacher changes appear as pendingTeacher and pendingTeacherFrom.',
  })
  classDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: ClassRosterQueryDto,
  ): Promise<unknown> {
    return this.flow.getClass(user, id, page);
  }

  @Delete('classes/:id')
  deleteClass(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.deleteClass(user, id);
  }

  @Get('classes/:id/schedules')
  classSchedules(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.flow.classSchedules(user, id);
  }

  @Put('classes/:id/schedules')
  putClassSchedules(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ReplaceClassSchedulesDto,
  ): Promise<unknown> {
    return this.flow.replaceClassSchedules(user, id, input);
  }

  @Patch('classes/:id/schedules/:scheduleId')
  patchClassSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
    @Body() input: ClassScheduleSlotDto,
  ): Promise<unknown> {
    return this.flow.updateClassSchedule(user, id, scheduleId, input);
  }

  @Delete('classes/:id/schedules/:scheduleId')
  deleteClassSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
  ): Promise<unknown> {
    return this.flow.deleteClassSchedule(user, id, scheduleId);
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

  @Get('registrations/:id/bill')
  @ApiOperation({
    summary: 'Staff or owning parent: view a registration bill before or after payment',
    description:
      'The bill has no QR. Pricing and registration details come from the order snapshot. Payment is null until staff confirms collection.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            billNumber: { type: 'string' },
            registrationId: { type: 'string' },
            status: { type: 'string', enum: ['UNPAID', 'PAID', 'CANCELLED'] },
            issuedAt: { type: 'string', format: 'date-time' },
            parent: { type: 'object' },
            student: { type: 'object' },
            class: { type: 'object' },
            term: { type: 'object' },
            pricing: { type: 'object' },
            payment: { type: 'object', nullable: true },
          },
        },
      },
    },
  })
  bill(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.flow.bill(user, id);
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
