import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Delete,
  Put,
  UploadedFile,
  UseInterceptors,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ParentCurriculumResponseDto } from '../academic/parent-learning-response.dto';
import { PageDto } from '../academic/academic.dto';
import { AcademicErrorsFilter } from '../academic/academic-errors.filter';
import {
  CreateCurriculumUnitDto,
  CurriculumLessonDto,
  CurriculumUnitFilterDto,
  MonthlyTestDto,
  ScheduleRangeDto,
  SessionQueryDto,
  UpdateCurriculumUnitDto,
  ReviewNoteDto,
  LessonOrderDto,
  SessionRescheduleDto,
  SessionCancelDto,
  ImportCommitDto,
} from './curriculum-scheduling.dto';
import { CurriculumSchedulingService } from './curriculum-scheduling.service';

@ApiExtraModels(ParentCurriculumResponseDto)
@ApiTags('curriculum-scheduling')
@ApiBearerAuth()
@UseFilters(AcademicErrorsFilter)
@Controller({ path: 'academic', version: '1' })
export class CurriculumSchedulingController {
  constructor(private readonly service: CurriculumSchedulingService) {}

  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { $ref: getSchemaPath(ParentCurriculumResponseDto) },
      },
    },
  })
  @Get('me/students/:id/curriculum')
  @ApiOperation({
    summary:
      'Parent: approved curriculum outline for a currently enrolled child, without lesson content',
  })
  studentCurriculum(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() page: PageDto,
  ): Promise<unknown> {
    return this.service.studentCurriculum(user, id, page);
  }

  @Post('curriculum-units')
  @ApiOperation({ summary: 'Designer: create a shared subject/grade curriculum unit' })
  createUnit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateCurriculumUnitDto,
  ): Promise<unknown> {
    return this.service.createUnit(user, input);
  }

  @Get('curriculum-units')
  @ApiOperation({ summary: 'List curriculum units visible to this user' })
  units(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CurriculumUnitFilterDto,
  ): Promise<unknown> {
    return this.service.listUnits(user, query);
  }

  @Get('curriculum-units/:id')
  @ApiOperation({ summary: 'Get a curriculum unit and its lesson/test content' })
  unit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.service.unit(user, id);
  }

  @Patch('curriculum-units/:id')
  @ApiOperation({ summary: 'Designer: update a draft curriculum unit' })
  updateUnit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateCurriculumUnitDto,
  ): Promise<unknown> {
    return this.service.updateUnit(user, id, input);
  }

  @Post('curriculum-units/:id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.service.submitUnit(user, id);
  }

  @Post('curriculum-units/:id/validation')
  validation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.service.validation(user, id);
  }

  @Post('curriculum-units/:id/request-changes')
  requestChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ReviewNoteDto,
  ): Promise<unknown> {
    return this.service.requestChanges(user, id, input.reason);
  }

  @Delete('curriculum-units/:id')
  deleteUnit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.service.deleteUnit(user, id);
  }

  @Post('curriculum-units/:id/lessons')
  @ApiOperation({ summary: 'Designer: add an ordered lesson to a draft unit' })
  addLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: CurriculumLessonDto,
  ): Promise<unknown> {
    return this.service.addLesson(user, id, input);
  }

  @Patch('curriculum-units/:id/lessons/:lessonId')
  @ApiOperation({ summary: 'Designer: update a lesson in a draft unit' })
  updateLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
    @Body() input: CurriculumLessonDto,
  ): Promise<unknown> {
    return this.service.updateLesson(user, id, lessonId, input);
  }

  @Delete('curriculum-units/:id/lessons/:lessonId')
  deleteLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
  ): Promise<unknown> {
    return this.service.deleteLesson(user, id, lessonId);
  }

  @Put('curriculum-units/:id/lesson-order')
  reorderLessons(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: LessonOrderDto,
  ): Promise<unknown> {
    return this.service.reorderLessons(user, id, input.orderedLessonIds, input.expectedRevision);
  }

  @Post('curriculum-units/:id/import-preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mode') mode: string,
  ): Promise<unknown> {
    return this.service.importPreview(user, id, file, mode);
  }

  @Post('curriculum-units/:id/import-commit')
  importCommit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ImportCommitDto,
  ): Promise<unknown> {
    return this.service.importCommit(user, id, input, key);
  }

  @Post('curriculum-units/:id/monthly-tests')
  @ApiOperation({ summary: 'Designer: create or replace a monthly test in a draft unit' })
  monthlyTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: MonthlyTestDto,
  ): Promise<unknown> {
    return this.service.setMonthlyTest(user, id, input);
  }

  @Post('curriculum-units/:id/approve')
  @ApiOperation({ summary: 'Manager: approve a complete curriculum unit' })
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.service.approveUnit(user, id);
  }

  @Post('curriculum-units/:id/revisions')
  @ApiOperation({ summary: 'Designer: copy an approved unit into a new draft version' })
  revise(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.service.reviseUnit(user, id);
  }

  @Post('classes/:id/session-preview')
  @ApiOperation({ summary: 'Manager: preview weekly sessions, lessons, tests and conflicts' })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: ScheduleRangeDto,
  ): Promise<unknown> {
    return this.service.preview(user, id, input);
  }

  @Post('classes/:id/session-generations')
  @ApiOperation({ summary: 'Manager: generate sessions atomically from the approved unit' })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ScheduleRangeDto,
  ): Promise<unknown> {
    return this.service.generate(user, id, input, key);
  }

  @Get('scheduled-sessions')
  @ApiOperation({ summary: 'List sessions by class and date, with curriculum metadata' })
  sessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SessionQueryDto,
  ): Promise<unknown> {
    return this.service.sessions(user, query);
  }

  @Get('scheduled-sessions/:id')
  sessionDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('studentId') studentId?: string,
  ): Promise<unknown> {
    return this.service.sessionDetail(user, id, studentId);
  }

  @Get('classes/:id/session-generations')
  generationList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.service.generationList(user, id);
  }

  @Get('session-generations/:id')
  generationDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.service.generationDetail(user, id);
  }

  @Post('sessions/:id/reschedule-preview')
  reschedulePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: SessionRescheduleDto,
  ): Promise<unknown> {
    return this.service.reschedulePreview(user, id, input);
  }

  @Post('sessions/:id/reschedule')
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: SessionRescheduleDto,
  ): Promise<unknown> {
    return this.service.reschedule(user, id, input, key);
  }

  @Post('sessions/:id/cancel')
  cancelSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: SessionCancelDto,
  ): Promise<unknown> {
    return this.service.cancelSession(user, id, input.reason, input.expectedRevision, key);
  }
}
