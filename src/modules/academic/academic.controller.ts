import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AcademicStorageService } from '../../integrations/academic-storage.service';
import { ParentGradesResponseDto } from './parent-learning-response.dto';
import { CatalogService } from './catalog.service';
import { EnrollmentWorkflowsService } from './enrollment-workflows.service';
import { AssessmentService } from './assessment.service';
import { OutcomeService } from './outcome.service';
import { StudentGradeQueryDto } from './academic-list.dto';
import { AcademicProgramQueryDto, AcademicClassQueryDto, LessonQueryDto, AcademicSessionQueryDto, FeedbackQueryDto, EnrollmentQueryDto, RosterQueryDto, AssignmentQueryDto, SubmissionQueryDto, MakeupQueryDto, ClassContentQueryDto, OutcomeSetQueryDto } from './academic-list.dto';
import { AssignmentImportService } from './assignment-import.service';
import { GradingWorkerService } from './grading-worker.service';
import { ReportsService } from './reports.service';
import { AnnouncementsService } from './announcements.service';
import { EmailDeliveriesService } from './email-deliveries.service';
import { AnalyticsService } from './analytics.service';
import { AcademicErrorsFilter } from './academic-errors.filter';
import {
  AnnouncementDto,
  AnalyticsQueryDto,
  AttendanceQueryDto,
  AssignmentDto,
  AssignmentImportDto,
  OutcomeSourceReviewDto,
  OutcomeSetCreateDto,
  OutcomeChangeRequestDto,
  LearningOutcomeWriteDto,
  LessonOutcomeWriteDto,
  AttendanceDto,
  ClassDto,
  DecisionDto,
  EndLeaveEarlyDto,
  EmailDeliveryFilterDto,
  FeedbackDto,
  GradeDto,
  LeaveDto,
  LeaveFilterDto,
  MakeupSourceFilterDto,
  LessonDto,
  LessonRevisionDto,
  SubmissionWindowDto,
  MakeupDto,
  ProgramDto,
  RecipientsDto,
  ReactivateStudentDto,
  RescheduleMakeupDto,
  ReminderDto,
  ReportDto,
  ResolveFeedbackDto,
  SessionDto,
  SubmissionDto,
  TransferDto,
} from './academic.dto';

@ApiExtraModels(ParentGradesResponseDto)
@ApiTags('academic')
@UseFilters(AcademicErrorsFilter)
@ApiBearerAuth()
@Controller({ path: 'academic', version: '1' })
export class AcademicController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly workflows: EnrollmentWorkflowsService,
    private readonly assessment: AssessmentService,
    private readonly outcomes: OutcomeService,
    private readonly assignmentImport: AssignmentImportService,
    private readonly grading: GradingWorkerService,
    private readonly reports: ReportsService,
    private readonly storage: AcademicStorageService,
    private readonly announcements: AnnouncementsService,
    private readonly emailDeliveries: EmailDeliveriesService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Manager/teacher/designer: role-scoped activity statistics' })
  analyticsDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<unknown> {
    return this.analytics.dashboard(user, query);
  }

  @Get('analytics/export')
  @ApiOperation({ summary: 'Manager/teacher/designer: export the selected statistics as XLSX' })
  async exportAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.analytics.exportDashboard(user, query);
    res.type(file.type).attachment(file.name).send(file.buffer);
  }

  @Get('email-deliveries')
  @ApiOperation({
    summary: 'Manager/staff: inspect persisted email deliveries',
    description:
      'Delivery metadata omits payloads that may contain account tokens. Optional status filters one state; total counts the filtered rows.',
  })
  deliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmailDeliveryFilterDto,
  ): Promise<unknown> {
    return this.emailDeliveries.list(user, query);
  }

  @Post('email-deliveries/:id/retry')
  @ApiOperation({
    summary: 'Manager/staff: retry a failed or pending email delivery',
    description: 'SMTP failure returns 502 EMAIL_DELIVERY_FAILED and preserves the failed attempt.',
  })
  retryDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.emailDeliveries.retry(user, id);
  }

  @Post('programs')
  @ApiOperation({ summary: 'Manager: create prerequisite program' })
  program(@CurrentUser() user: AuthenticatedUser, @Body() input: ProgramDto): Promise<unknown> {
    return this.catalog.createProgram(user, input);
  }

  @Get('programs/:id/outcome-sets')
  @ApiOperation({ summary: 'List sourced CLO drafts and approved sets for one program' })
  outcomeSets(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query() query: OutcomeSetQueryDto): Promise<unknown> {
    return this.outcomes.list(user, id, query);
  }

  @Post('outcome-sets')
  @ApiOperation({ summary: 'Curriculum designer: create a new versioned CLO set' })
  createOutcomeSet(@CurrentUser() user: AuthenticatedUser, @Body() input: OutcomeSetCreateDto): Promise<unknown> {
    return this.outcomes.createSet(user, input.programId, input.level, input.copyFromId);
  }

  @Post('outcome-sets/:id/request-changes')
  @ApiOperation({ summary: 'Manager: send a teacher-reviewed CLO set back to draft' })
  requestOutcomeChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: OutcomeChangeRequestDto,
  ): Promise<unknown> {
    return this.outcomes.requestChanges(user, id, input.reason);
  }

  @Post('outcome-sets/:id/outcomes')
  @ApiOperation({ summary: 'Curriculum designer: add a sourced CLO to a draft set' })
  addOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: LearningOutcomeWriteDto,
  ): Promise<unknown> {
    return this.outcomes.writeOutcome(user, id, input);
  }

  @Patch('outcome-sets/:setId/outcomes/:outcomeId')
  @ApiOperation({ summary: 'Curriculum designer: edit a draft CLO and reset source verification' })
  editOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('setId') setId: string,
    @Param('outcomeId') outcomeId: string,
    @Body() input: LearningOutcomeWriteDto,
  ): Promise<unknown> {
    return this.outcomes.writeOutcome(user, setId, input, outcomeId);
  }

  @Patch('lessons/:id/outcomes')
  @ApiOperation({ summary: 'Curriculum designer: map a draft lesson to draft CLOs' })
  mapLessonOutcomes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: LessonOutcomeWriteDto,
  ): Promise<unknown> {
    return this.outcomes.setLessonOutcomes(user, id, input.outcomeIds);
  }

  @Post('outcomes/:id/verify-source')
  @ApiOperation({ summary: 'Assigned teacher: verify exact source requirement for a draft CLO' })
  verifyOutcomeSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: OutcomeSourceReviewDto,
  ): Promise<unknown> {
    return this.outcomes.verifySource(user, id, input.sourceLocator, input.sourceNote);
  }

  @Post('outcome-sets/:id/technical-approve')
  @ApiOperation({ summary: 'Assigned teacher: approve a verified CLO set' })
  technicalApproveOutcomes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.outcomes.technicalApprove(user, id);
  }

  @Post('outcome-sets/:id/approve')
  @ApiOperation({ summary: 'Manager: approve a teacher-reviewed CLO set' })
  approveOutcomes(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.outcomes.approve(user, id);
  }
  @Patch('assignments/:id') updateAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: AssignmentDto,
  ): Promise<unknown> {
    return this.assessment.updateDraft(user, id, input);
  }

  @Post('lessons/:id/revisions') reviseLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: LessonRevisionDto,
  ): Promise<unknown> {
    return this.catalog.reviseLesson(user, id, input);
  }
  @Get('enrollments') enrollments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: EnrollmentQueryDto,
  ): Promise<unknown> {
    return this.catalog.enrollments(user, page);
  }
  @Get('sessions/:id/roster') readRoster(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: RosterQueryDto,
  ): Promise<unknown> {
    return this.catalog.roster(user, id, page);
  }
  @Get('makeups') makeups(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: MakeupQueryDto,
  ): Promise<unknown> {
    return this.workflows.makeups(user, page);
  }
  @Post('assignments/:id/reopen') reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: SubmissionWindowDto,
  ): Promise<unknown> {
    return this.assessment.reopen(user, id, input);
  }
  @Get('programs') programs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: AcademicProgramQueryDto,
  ): Promise<unknown> {
    return this.catalog.programs(user, page);
  }
  @Post('classes') classroom(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ClassDto,
  ): Promise<unknown> {
    return this.catalog.createClass(user, input);
  }
  @Get('classes') classes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: AcademicClassQueryDto,
  ): Promise<unknown> {
    return this.catalog.classes(user, page);
  }
  @Post('lessons') lesson(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: LessonDto,
  ): Promise<unknown> {
    return this.catalog.createLesson(user, input);
  }
  @Get('lessons') lessons(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: LessonQueryDto,
  ): Promise<unknown> {
    return this.catalog.lessons(user, page);
  }
  @Post('lessons/:id/approve') approveLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.catalog.approveLesson(user, id);
  }
  @Post('lessons/:id/feedback') feedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: FeedbackDto,
  ): Promise<unknown> {
    return this.catalog.feedback(user, id, input);
  }
  @Get('feedback') feedbackList(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: FeedbackQueryDto,
  ): Promise<unknown> {
    return this.catalog.listFeedback(user, page);
  }
  @Post('feedback/:id/resolve') resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ResolveFeedbackDto,
  ): Promise<unknown> {
    return this.catalog.resolveFeedback(user, id, input);
  }
  @Post('sessions') session(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: SessionDto,
  ): Promise<unknown> {
    return this.catalog.createSession(user, input);
  }
  @Get('sessions') sessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: AcademicSessionQueryDto,
  ): Promise<unknown> {
    return this.catalog.sessions(user, page);
  }
  @Post('sessions/:id/roster') roster(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.catalog.prepareRoster(user, id);
  }
  @Post('sessions/:id/finalize-attendance') attendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: AttendanceDto,
  ): Promise<unknown> {
    return this.workflows.finalizeAttendance(user, id, input);
  }
  @Post('leaves') leave(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: LeaveDto,
  ): Promise<unknown> {
    return this.workflows.requestLeave(user, input);
  }
  @Get('leaves') leaves(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LeaveFilterDto,
  ): Promise<unknown> {
    return this.workflows.leaves(user, query);
  }
  @Get('makeup-sources') makeupSources(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MakeupSourceFilterDto,
  ): Promise<unknown> {
    return this.workflows.makeupSources(user, query);
  }
  @Post('leaves/:id/decide') decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: DecisionDto,
  ): Promise<unknown> {
    return this.workflows.decideLeave(user, id, input);
  }
  @Post('leaves/:id/cancel') cancelLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.workflows.cancelLeave(user, id);
  }
  @Post('leaves/:id/end-early')
  @ApiOperation({ summary: 'Staff: end an approved period pause early' })
  endLeaveEarly(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: EndLeaveEarlyDto,
  ): Promise<unknown> {
    return this.workflows.endLeaveEarly(user, id, input);
  }
  @Get('participants/:id/makeup-candidates') candidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: AcademicSessionQueryDto,
  ): Promise<unknown> {
    return this.workflows.makeupCandidates(user, id, page);
  }
  @Get('classes/:id/attendance-summary')
  @ApiOperation({
    summary:
      'Teacher (assigned class), manager or staff: attendance summary and history for a class',
    description:
      'YYYY-MM-DD bounds include the whole local day (UTC+7). Optional studentId filters one student. Response includes students[] with counts and attendancePercent.',
  })
  attendanceSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: AttendanceQueryDto,
  ): Promise<unknown> {
    return this.workflows.attendanceSummary(user, { ...query, classId: id });
  }
  @Get('me/students/:id/attendance')
  @ApiOperation({ summary: 'Parent: attendance summary and history for one owned student' })
  studentAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: AttendanceQueryDto,
  ): Promise<unknown> {
    return this.workflows.attendanceSummary(user, { ...query, studentId: id });
  }
  @Post('makeups') makeup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: MakeupDto,
  ): Promise<unknown> {
    return this.workflows.bookMakeup(user, input);
  }
  @Post('makeups/:id/cancel') cancelMakeup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.workflows.cancelMakeup(user, id);
  }
  @Post('makeups/:id/reschedule')
  @ApiOperation({ summary: 'Staff: atomically move a booked makeup seat' })
  rescheduleMakeup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: RescheduleMakeupDto,
  ): Promise<unknown> {
    return this.workflows.rescheduleMakeup(user, id, input);
  }
  @Post('enrollments/:id/transfer') transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: TransferDto,
  ): Promise<unknown> {
    return this.workflows.transfer(user, id, input);
  }
  @Post('enrollments/:id/end') end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.workflows.endEnrollment(user, id);
  }
  @Get('students/:id/grades')
  @ApiOperation({
    summary: 'Manager/staff: assignments of one student with the latest published grade',
  })
  backOfficeStudentGrades(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: StudentGradeQueryDto,
  ): Promise<unknown> {
    return this.assessment.backOfficeStudentGrades(user, id, query);
  }
  @Post('students/:id/end-study') endStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.workflows.endStudent(user, id);
  }
  @Post('students/:id/reactivate')
  @ApiOperation({ summary: 'Staff: reactivate an inactive student profile for a new registration' })
  reactivateStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ReactivateStudentDto,
  ): Promise<unknown> {
    return this.workflows.reactivateStudent(user, id, input);
  }
  @Post('assignments') assignment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AssignmentDto,
  ): Promise<unknown> {
    return this.assessment.create(user, input);
  }
  @Post('assignments/import-preview')
  @ApiOperation({
    summary: 'Assigned teacher: preview questions from CSV, DOCX or a text PDF; no draft is saved',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'classId'],
      properties: { file: { type: 'string', format: 'binary' }, classId: { type: 'string' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 191 },
    }),
  )
  importAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AssignmentImportDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<unknown> {
    return this.assignmentImport.preview(user, input.classId, file);
  }
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { $ref: getSchemaPath(ParentGradesResponseDto) },
      },
    },
  })
  @Get('me/students/:id/grades')
  @ApiOperation({ summary: 'Parent: published grade history and averages by subject' })
  studentGrades(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: StudentGradeQueryDto,
  ): Promise<unknown> {
    return this.assessment.studentGrades(user, id, page);
  }

  @ApiOperation({
    summary: 'Assignments visible to the current teacher or parent',
    description:
      'Optional studentId selects one owned child. paginated=true returns { items, page, limit, total }; otherwise returns an array. Includes class, session, question counts and each visible recipient latest submission with published grade only.',
  })
  @Get('assignments')
  assignments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: AssignmentQueryDto,
  ): Promise<unknown> {
    return this.assessment.list(user, page);
  }
  @Get('assignments/:id') assignmentDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.assessment.detail(user, id);
  }
  @Post('assignments/:id/publish') publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: RecipientsDto,
  ): Promise<unknown> {
    return this.assessment.publish(user, id, input);
  }
  @Post('assignments/:id/close') close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.assessment.close(user, id);
  }
  @Post('assignments/:id/publish-answers') answers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.assessment.publishAnswers(user, id);
  }
  @Get('assignments/:id/submissions') submissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: SubmissionQueryDto,
  ): Promise<unknown> {
    return this.assessment.submissions(user, id, page);
  }
  @Post('submissions') submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: SubmissionDto,
  ): Promise<unknown> {
    return this.assessment.submit(user, input);
  }
  @Post('submissions/:id/grades') grade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: GradeDto,
  ): Promise<unknown> {
    return this.assessment.grade(user, id, input);
  }
  @Post('submissions/:id/grade-objective') objective(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.assessment.objectiveGrade(user, id);
  }
  @Post('submissions/:id/grade-ai') ai(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.grading.enqueue(user, id);
  }
  @Get('grading-jobs/:id') job(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.grading.result(user, id);
  }
  @Post('grades/:id/approve') approveGrade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.assessment.approveGrade(user, id);
  }
  @Post('grades/:id/publish') publishGrade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.assessment.publishGrade(user, id);
  }
  @Post('reports') report(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ReportDto,
  ): Promise<unknown> {
    return this.reports.create(user, input);
  }
  @Get('reports') reportsList(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: ClassContentQueryDto,
  ): Promise<unknown> {
    return this.reports.list(user, page);
  }
  @Get('reports/:id/download') async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.export(user, id, format);
    res.type(file.type).attachment(file.name).send(file.buffer);
  }
  @Post('files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<unknown> {
    return this.storage.upload(user, file);
  }
  @Get('files/:id/download') file(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.storage.download(user, id);
  }

  @Get('files/:id/preview') previewFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.storage.preview(user, id);
  }
  @Post('announcements') announcement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AnnouncementDto,
  ): Promise<unknown> {
    return this.announcements.create(user, input);
  }
  @Get('announcements') announcementsList(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: ClassContentQueryDto,
  ): Promise<unknown> {
    return this.announcements.list(user, page);
  }
  @Post('announcements/:id/send-email') sendAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.announcements.sendAnnouncement(user, id);
  }
  @Post('tuition-reminders/send-email') reminders(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ReminderDto,
  ): Promise<unknown> {
    return this.announcements.reminders(user, input);
  }
}
