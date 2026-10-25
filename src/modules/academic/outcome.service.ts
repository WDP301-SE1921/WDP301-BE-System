import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherAt } from '../registration-flow/class-teacher';
import { assertRule, roles } from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import { LearningOutcomeWriteDto } from './academic.dto';
import { OutcomeSetQueryDto } from './academic-list.dto';
import { pageResult } from '../../common/pagination';
import type { Prisma } from '@prisma/client';

@Injectable()
export class OutcomeService {
  constructor(private readonly repo: AcademicRepository) {}

  async list(
    user: AuthenticatedUser,
    programId: string,
    query = new OutcomeSetQueryDto(),
  ): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT');
    const program = await this.repo.db.program.findUnique({ where: { id: programId } });
    assertRule(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
    const where: Prisma.OutcomeSetWhereInput = {
      programId,
      ...(user.role === 'PARENT' ? { status: 'APPROVED' } : {}),
      ...(user.role === 'CURRICULUM_DESIGNER' ? { designerId: user.id } : {}),
      AND: [
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.level ? { level: query.level } : {}),
          ...(query.version ? { version: query.version } : {}),
          ...(query.search
            ? {
                outcomes: {
                  some: {
                    OR: [
                      { title: { contains: query.search } },
                      { code: { contains: query.search } },
                    ],
                  },
                },
              }
            : {}),
        },
      ],
    };
    const sets = await this.repo.db.outcomeSet.findMany({
      where,
      take: query.limit,
      skip: (query.page - 1) * query.limit,
      include: {
        outcomes: {
          orderBy: { code: 'asc' },
          include: { lessonLinks: { select: { lessonId: true } } },
        },
      },
      orderBy: [{ version: 'desc' }, { id: 'asc' }],
    });
    if (user.role === 'PARENT') {
      const child = await this.repo.db.enrollment.findFirst({
        where: {
          class: { programId },
          status: { not: 'PENDING_LINK' },
          studentProfile: { parentProfile: { userId: user.id } },
        },
        select: { id: true },
      });
      assertRule(
        child,
        'FORBIDDEN',
        'Program does not belong to a linked child',
        HttpStatus.FORBIDDEN,
      );
      return pageResult(
        query,
        Promise.resolve(
          sets.map((set) => ({
            id: set.id,
            programId: set.programId,
            level: set.level,
            version: set.version,
            outcomes: set.outcomes.map((outcome) => ({
              id: outcome.id,
              code: outcome.code,
              title: outcome.title,
              statement: outcome.statement,
              required: outcome.required,
            })),
          })),
        ),
        () => this.repo.db.outcomeSet.count({ where }),
      );
    }
    if (user.role === 'TEACHER') await this.assertProgramTeacher(user, programId);
    return pageResult(query, Promise.resolve(sets), () => this.repo.db.outcomeSet.count({ where }));
  }

  async createSet(user: AuthenticatedUser, programId: string, level: string): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    await this.assertProgramDesigner(user, programId);
    return this.repo.transaction(async (tx) => {
      const latest = await tx.outcomeSet.findFirst({
        where: { programId, level: level.trim() },
        orderBy: { version: 'desc' },
      });
      return tx.outcomeSet.create({
        data: {
          programId,
          level: level.trim(),
          version: (latest?.version ?? 0) + 1,
          designerId: user.id,
        },
      });
    });
  }

  async writeOutcome(
    user: AuthenticatedUser,
    setId: string,
    input: LearningOutcomeWriteDto,
    outcomeId?: string,
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    return this.repo.transaction(async (tx) => {
      const set = await tx.outcomeSet.findUnique({ where: { id: setId } });
      assertRule(set, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
      assertRule(
        set.designerId === user.id,
        'FORBIDDEN',
        'Only the set designer can edit it',
        HttpStatus.FORBIDDEN,
      );
      assertRule(set.status === 'DRAFT', 'OUTCOME_SET_LOCKED', 'Only a draft set can be edited');
      const data = {
        code: input.code.trim(),
        title: input.title.trim(),
        statement: input.statement.trim(),
        sourceTitle: input.sourceTitle.trim(),
        sourceUrl: input.sourceUrl.trim(),
        sourceLocator: input.sourceLocator.trim(),
        sourceNote: input.sourceNote?.trim() ?? null,
        required: input.required ?? true,
        sourceStatus: 'CANDIDATE' as const,
        verifiedById: null,
        verifiedAt: null,
      };
      if (!outcomeId) return tx.learningOutcome.create({ data: { ...data, outcomeSetId: set.id } });
      const existing = await tx.learningOutcome.findUnique({ where: { id: outcomeId } });
      assertRule(
        existing?.outcomeSetId === set.id,
        'OUTCOME_NOT_FOUND',
        'Outcome does not belong to this set',
        HttpStatus.NOT_FOUND,
      );
      return tx.learningOutcome.update({ where: { id: outcomeId }, data });
    });
  }

  async setLessonOutcomes(
    user: AuthenticatedUser,
    lessonId: string,
    outcomeIds: string[],
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    return this.repo.transaction(async (tx) => {
      const lesson = await tx.lesson.findUnique({ where: { id: lessonId } });
      assertRule(lesson, 'LESSON_NOT_FOUND', 'Lesson not found', HttpStatus.NOT_FOUND);
      assertRule(
        lesson.designerId === user.id,
        'FORBIDDEN',
        'Only the lesson designer can edit it',
        HttpStatus.FORBIDDEN,
      );
      assertRule(lesson.status === 'DRAFT', 'LESSON_LOCKED', 'Only a draft lesson can be remapped');
      const outcomes = await tx.learningOutcome.findMany({
        where: { id: { in: outcomeIds } },
        include: { outcomeSet: true },
      });
      assertRule(
        outcomes.length === outcomeIds.length &&
          outcomes.every(
            (item) =>
              item.outcomeSet.programId === lesson.programId && item.outcomeSet.status === 'DRAFT',
          ),
        'INVALID_OUTCOME_MAPPING',
        'Outcomes must belong to a draft set in the same program',
      );
      await tx.lessonOutcome.deleteMany({ where: { lessonId } });
      await tx.lessonOutcome.createMany({
        data: outcomeIds.map((outcomeId) => ({ lessonId, outcomeId })),
      });
      return { lessonId, outcomeIds };
    });
  }

  async verifySource(
    user: AuthenticatedUser,
    outcomeId: string,
    sourceLocator: string,
    sourceNote: string,
  ): Promise<unknown> {
    roles(user, 'TEACHER');
    assertRule(
      sourceLocator.trim().length >= 12 && sourceNote.trim().length >= 12,
      'SOURCE_REVIEW_INCOMPLETE',
      'Provide the exact source section/page and a review note',
      HttpStatus.BAD_REQUEST,
    );
    return this.repo.transaction(async (tx) => {
      const outcome = await tx.learningOutcome.findUnique({
        where: { id: outcomeId },
        include: { outcomeSet: true },
      });
      assertRule(outcome, 'OUTCOME_NOT_FOUND', 'Outcome not found', HttpStatus.NOT_FOUND);
      await this.assertProgramTeacher(user, outcome.outcomeSet.programId);
      assertRule(
        outcome.outcomeSet.status === 'DRAFT',
        'OUTCOME_SET_LOCKED',
        'Only draft outcomes can be reviewed',
      );
      return tx.learningOutcome.update({
        where: { id: outcomeId },
        data: {
          sourceLocator: sourceLocator.trim(),
          sourceNote: sourceNote.trim(),
          sourceStatus: 'VERIFIED',
          verifiedById: user.id,
          verifiedAt: new Date(),
        },
      });
    });
  }

  async technicalApprove(user: AuthenticatedUser, setId: string): Promise<unknown> {
    roles(user, 'TEACHER');
    return this.repo.transaction(async (tx) => {
      const set = await tx.outcomeSet.findUnique({
        where: { id: setId },
        include: { outcomes: { include: { lessonLinks: true } } },
      });
      assertRule(set, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
      await this.assertProgramTeacher(user, set.programId);
      assertRule(set.status === 'DRAFT', 'OUTCOME_SET_LOCKED', 'Only draft sets can be reviewed');
      assertRule(
        set.outcomes.length > 0 &&
          set.outcomes.every(
            (outcome) =>
              outcome.sourceStatus === 'VERIFIED' &&
              outcome.verifiedById === user.id &&
              outcome.lessonLinks.length > 0,
          ),
        'OUTCOME_SET_INCOMPLETE',
        'Every outcome needs a verified source and at least one linked lesson',
      );
      return tx.outcomeSet.update({
        where: { id: setId },
        data: { status: 'TECHNICALLY_APPROVED', reviewerId: user.id, reviewedAt: new Date() },
      });
    });
  }

  async approve(user: AuthenticatedUser, setId: string): Promise<unknown> {
    roles(user, 'MANAGER');
    return this.repo.transaction(async (tx) => {
      const set = await tx.outcomeSet.findUnique({ where: { id: setId } });
      assertRule(set, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
      assertRule(
        set.status === 'TECHNICALLY_APPROVED' && set.reviewerId,
        'TECHNICAL_REVIEW_REQUIRED',
        'Teacher review is required before approval',
      );
      return tx.outcomeSet.update({
        where: { id: setId },
        data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
      });
    });
  }

  private async assertProgramTeacher(user: AuthenticatedUser, programId: string): Promise<void> {
    const classes = await this.repo.db.class.findMany({ where: { programId } });
    assertRule(
      classes.some((item) => assignedTeacherAt(item, new Date()) === user.id),
      'FORBIDDEN',
      'Teacher is not assigned to this program',
      HttpStatus.FORBIDDEN,
    );
  }

  private async assertProgramDesigner(user: AuthenticatedUser, programId: string): Promise<void> {
    const count = await this.repo.db.curriculumUnit.count({
      where: { programId, designerId: user.id },
    });
    assertRule(
      count > 0,
      'FORBIDDEN',
      'Designer is not assigned to this program',
      HttpStatus.FORBIDDEN,
    );
  }
}
