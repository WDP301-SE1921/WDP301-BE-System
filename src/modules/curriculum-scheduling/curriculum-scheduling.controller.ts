import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AcademicErrorsFilter } from '../academic/academic-errors.filter';
import {
  CreateCurriculumUnitDto,
  CurriculumLessonDto,
  CurriculumUnitFilterDto,
  MonthlyTestDto,
  ScheduleRangeDto,
  SessionQueryDto,
  UpdateCurriculumUnitDto,
} from './curriculum-scheduling.dto';
import { CurriculumSchedulingService } from './curriculum-scheduling.service';

@ApiTags('curriculum-scheduling')
@ApiBearerAuth()
@UseFilters(AcademicErrorsFilter)
@Controller({ path: 'academic', version: '1' })
export class CurriculumSchedulingController {
  constructor(private readonly service: CurriculumSchedulingService) {}

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
}
