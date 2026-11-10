import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { mayReviewProgramOutcomes } from '../curriculum-scheduling/reviewer-eligibility';
import { assertRule, roles } from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import { LearningOutcomeWriteDto } from './academic.dto';
import { OutcomeSetQueryDto } from './academic-list.dto';
import { pageResult } from '../../common/pagination';
import { AppError } from '../../common/errors/app.error';
import { Prisma } from '@prisma/client';

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
      await this.assertParentProgram(user, programId);
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

  async getSet(user: AuthenticatedUser, setId: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT');
    const set = await this.repo.db.outcomeSet.findUnique({
      where: { id: setId },
      include: {
        program: { select: { id: true, name: true, subject: true, grade: true } },
        outcomes: {
          orderBy: { code: 'asc' },
          include: {
            lessonLinks: {
              select: {
                lessonId: true,
                lesson: { select: { id: true, title: true, sequence: true, kind: true } },
              },
            },
          },
        },
      },
    });
    assertRule(set, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
    if (user.role === 'PARENT') {
      assertRule(
        set.status === 'APPROVED',
        'FORBIDDEN',
        'Outcome set is not approved',
        HttpStatus.FORBIDDEN,
      );
      await this.assertParentProgram(user, set.programId);
      return {
        id: set.id,
        programId: set.programId,
        program: set.program,
        level: set.level,
        version: set.version,
        status: set.status,
        outcomes: set.outcomes.map((outcome) => ({
          id: outcome.id,
          code: outcome.code,
          title: outcome.title,
          statement: outcome.statement,
          required: outcome.required,
        })),
      };
    }
    if (user.role === 'TEACHER' && set.status !== 'APPROVED') {
      await this.assertProgramTeacher(user, set.programId);
    }
    return set;
  }

  async getOutcome(
    user: AuthenticatedUser,
    outcomeId: string,
    expectedSetId?: string,
  ): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT');
    const outcome = await this.repo.db.learningOutcome.findUnique({
      where: { id: outcomeId },
      include: {
        outcomeSet: {
          include: { program: { select: { id: true, name: true, subject: true, grade: true } } },
        },
        lessonLinks: {
          include: { lesson: { select: { id: true, title: true, sequence: true, kind: true } } },
        },
      },
    });
    assertRule(outcome, 'OUTCOME_NOT_FOUND', 'Outcome not found', HttpStatus.NOT_FOUND);
    if (expectedSetId) {
      assertRule(
        outcome.outcomeSetId === expectedSetId,
        'OUTCOME_NOT_FOUND',
        'Outcome does not belong to this set',
        HttpStatus.NOT_FOUND,
      );
    }
    const set = outcome.outcomeSet;
    if (user.role === 'PARENT') {
      assertRule(
        set.status === 'APPROVED',
        'FORBIDDEN',
        'Outcome set is not approved',
        HttpStatus.FORBIDDEN,
      );
      await this.assertParentProgram(user, set.programId);
      return {
        id: outcome.id,
        outcomeSetId: outcome.outcomeSetId,
        code: outcome.code,
        title: outcome.title,
        statement: outcome.statement,
        required: outcome.required,
      };
    }
    if (user.role === 'TEACHER' && set.status !== 'APPROVED') {
      await this.assertProgramTeacher(user, set.programId);
    }
    return outcome;
  }

  async createSet(
    user: AuthenticatedUser,
    programId: string,
    level: string,
    copyFromId?: string,
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    await this.assertWritableProgram(programId);
    return this.repo.transaction(async (tx) => {
      const source = copyFromId
        ? await tx.outcomeSet.findUnique({
            where: { id: copyFromId },
            include: { outcomes: { include: { lessonLinks: true } } },
          })
        : null;
      if (copyFromId)
        assertRule(
          source?.programId === programId,
          'INVALID_OUTCOME_SET',
          'Copy CLOs from a set in the same program',
        );
      const latest = await tx.outcomeSet.findFirst({
        where: { programId, level: level.trim() },
        orderBy: { version: 'desc' },
      });
      const created = await tx.outcomeSet.create({
        data: {
          programId,
          level: level.trim(),
          version: (latest?.version ?? 0) + 1,
          designerId: user.id,
        },
      });
      // A new version is reviewed again: copied CLOs restart as unverified candidates.
      for (const outcome of source?.outcomes ?? []) {
        const copy = await tx.learningOutcome.create({
          data: {
            outcomeSetId: created.id,
            code: outcome.code,
            title: outcome.title,
            statement: outcome.statement,
            sourceTitle: outcome.sourceTitle,
            sourceUrl: outcome.sourceUrl,
            sourceLocator: outcome.sourceLocator,
            sourceNote: outcome.sourceNote,
            required: outcome.required,
            sourceStatus: 'CANDIDATE',
            verifiedById: null,
            verifiedAt: null,
          },
        });
        if (outcome.lessonLinks.length)
          await tx.lessonOutcome.createMany({
            data: outcome.lessonLinks.map((link) => ({
              lessonId: link.lessonId,
              outcomeId: copy.id,
            })),
          });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'OUTCOME_SET_CREATED',
          entityType: 'OutcomeSet',
          entityId: created.id,
          afterData: { programId, level: created.level, version: created.version, copyFromId: copyFromId ?? null },
        },
      });
      return created;
    });
  }

  async deleteSet(user: AuthenticatedUser, setId: string): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER', 'MANAGER');
    return this.repo.transaction(async (tx) => {
      // Locked reads: a concurrent technical approval or CLO write is seen, not an old snapshot.
      const set = await this.lockSet(tx, setId);
      assertRule(set.status === 'DRAFT', 'OUTCOME_SET_LOCKED', 'Only draft outcome sets can be deleted');
      const outcomes = await this.lockSetOutcomes(tx, setId);
      const assignmentCount = await tx.assignment.count({ where: { outcomeSetId: setId } });
      assertRule(
        assignmentCount === 0,
        'OUTCOME_SET_IN_USE',
        'Cannot delete an outcome set used in assignments',
        HttpStatus.CONFLICT,
      );
      const outcomeIds = outcomes.map((o) => o.id);
      if (outcomeIds.length > 0) {
        const questionCount = await tx.assignmentQuestion.count({
          where: { outcomeId: { in: outcomeIds } },
        });
        assertRule(
          questionCount === 0,
          'OUTCOME_IN_USE',
          'Cannot delete an outcome set containing outcomes used in assignments',
          HttpStatus.CONFLICT,
        );
        await tx.lessonOutcome.deleteMany({ where: { outcomeId: { in: outcomeIds } } });
        await tx.learningOutcome.deleteMany({ where: { outcomeSetId: setId } });
      }
      await tx.outcomeSet.delete({ where: { id: setId } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'OUTCOME_SET_DELETED',
          entityType: 'OutcomeSet',
          entityId: setId,
          afterData: { programId: set.programId, level: set.level, version: set.version },
        },
      });
      return { id: setId, deleted: true };
    });
  }

  async requestChanges(user: AuthenticatedUser, setId: string, reason: string): Promise<unknown> {
    roles(user, 'MANAGER');
    return this.repo.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM outcome_sets WHERE id = ${setId} FOR UPDATE`;
      const set = await tx.outcomeSet.findUnique({ where: { id: setId } });
      assertRule(set, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
      assertRule(
        set.status === 'APPROVED',
        'OUTCOME_SET_NOT_REVIEWED',
        'Only an approved set can receive a revision request',
      );
      const result = await tx.outcomeSet.update({
        where: { id: setId },
        data: { reviewNote: reason.trim() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'OUTCOME_SET_CHANGES_REQUESTED',
          entityType: 'OutcomeSet',
          entityId: setId,
          afterData: { reason: reason.trim() },
        },
      });
      return result;
    });
  }

  async writeOutcome(
    user: AuthenticatedUser,
    setId: string,
    input: LearningOutcomeWriteDto,
    outcomeId?: string,
  ): Promise<unknown> {
    // Any curriculum designer edits a draft set (Q6); the CLO revision stops overwrites.
    roles(user, 'CURRICULUM_DESIGNER');
    return this.repo.transaction(async (tx) => {
      await this.lockDraftSet(tx, setId, 'Only a draft set can be edited');
      const data = {
        code: input.code.trim(),
        title: input.title.trim(),
        statement: input.statement.trim(),
        // Omitted keeps the stored value on update; null or blank clears it.
        sourceTitle: cleanOptional(input.sourceTitle),
        sourceUrl: cleanOptional(input.sourceUrl),
        sourceLocator: cleanOptional(input.sourceLocator),
        sourceNote: cleanOptional(input.sourceNote),
        required: input.required ?? true,
        sourceStatus: 'CANDIDATE' as const,
        verifiedById: null,
        verifiedAt: null,
      };
      if (!outcomeId) {
        const created = await tx.learningOutcome.create({ data: { ...data, outcomeSetId: setId } });
        await this.auditOutcome(tx, user, 'OUTCOME_CREATED', created.id, setId);
        return created;
      }
      const existing = await this.lockOutcome(tx, outcomeId);
      assertRule(
        existing?.outcomeSetId === setId,
        'OUTCOME_NOT_FOUND',
        'Outcome does not belong to this set',
        HttpStatus.NOT_FOUND,
      );
      assertRule(
        input.expectedRevision === undefined || existing.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        'Outcome changed; reload it',
      );
      const updated = await tx.learningOutcome.update({
        where: { id: outcomeId },
        data: { ...data, revision: { increment: 1 } },
      });
      await this.auditOutcome(tx, user, 'OUTCOME_UPDATED', outcomeId, setId);
      return updated;
    });
  }

  async deleteOutcome(user: AuthenticatedUser, setId: string, outcomeId: string): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    return this.repo.transaction(async (tx) => {
      await this.lockDraftSet(tx, setId, 'Only draft outcomes can be deleted');
      const outcome = await tx.learningOutcome.findUnique({ where: { id: outcomeId } });
      assertRule(
        outcome?.outcomeSetId === setId,
        'OUTCOME_NOT_FOUND',
        'Outcome does not belong to this set',
        HttpStatus.NOT_FOUND,
      );
      const questionCount = await tx.assignmentQuestion.count({ where: { outcomeId } });
      assertRule(
        questionCount === 0,
        'OUTCOME_IN_USE',
        'Cannot delete an outcome used in assignments',
        HttpStatus.CONFLICT,
      );
      await tx.lessonOutcome.deleteMany({ where: { outcomeId } });
      await tx.learningOutcome.delete({ where: { id: outcomeId } });
      await this.auditOutcome(tx, user, 'OUTCOME_DELETED', outcomeId, setId);
      return { id: outcomeId, outcomeSetId: setId, deleted: true };
    });
  }

  async deleteOutcomeById(user: AuthenticatedUser, outcomeId: string): Promise<unknown> {
    const outcome = await this.repo.db.learningOutcome.findUnique({ where: { id: outcomeId } });
    assertRule(outcome, 'OUTCOME_NOT_FOUND', 'Outcome not found', HttpStatus.NOT_FOUND);
    return this.deleteOutcome(user, outcome.outcomeSetId, outcomeId);
  }

  /**
   * Replaces the CLO links of a lesson and returns the links it has afterwards.
   * Lessons of the applied curriculum only change links to CLOs of draft sets: a link to a
   * reviewed or approved set is kept even when the request omits it, so a stale screen
   * cannot silently drop a published mapping. Any curriculum designer may remap (Q6).
   */
  async setLessonOutcomes(
    user: AuthenticatedUser,
    lessonId: string,
    outcomeIds: string[],
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    return this.repo.transaction(async (tx) => {
      // Serializes writers of this lesson and the manager's curriculum approval.
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${lessonId} FOR UPDATE`;
      const lesson = await tx.lesson.findUnique({
        where: { id: lessonId },
        include: { unit: { select: { status: true } } },
      });
      assertRule(lesson, 'LESSON_NOT_FOUND', 'Lesson not found', HttpStatus.NOT_FOUND);
      const unitStatus = lesson.unit?.status ?? null;
      assertRule(
        unitStatus !== 'ARCHIVED',
        'LESSON_LOCKED',
        'Lessons of an archived curriculum cannot be remapped',
      );
      assertRule(
        lesson.status === 'DRAFT' || unitStatus === 'APPROVED',
        'LESSON_LOCKED',
        'An approved lesson can only be remapped while its curriculum is applied',
      );
      const requested = await tx.learningOutcome.findMany({
        where: { id: { in: outcomeIds } },
        select: { id: true, outcomeSetId: true, outcomeSet: { select: { programId: true } } },
      });
      // A new curriculum period re-links its draft lessons to the CLO set already in use.
      assertRule(
        requested.length === outcomeIds.length &&
          requested.every((item) => item.outcomeSet.programId === lesson.programId),
        'INVALID_OUTCOME_MAPPING',
        'Outcomes must belong to a set in the same program',
      );
      const current = await tx.lessonOutcome.findMany({
        where: { lessonId },
        select: { outcomeId: true, outcome: { select: { outcomeSetId: true } } },
      });
      const wanted = new Set(outcomeIds);
      const linked = new Set(current.map((link) => link.outcomeId));
      const added = outcomeIds.filter((outcomeId) => !linked.has(outcomeId));
      let removed = current.filter((link) => !wanted.has(link.outcomeId));
      if (added.length || removed.length) {
        const setOf = new Map<string, string>([
          ...requested.map((item): [string, string] => [item.id, item.outcomeSetId]),
          ...current.map((link): [string, string] => [link.outcomeId, link.outcome.outcomeSetId]),
        ]);
        // Every set whose links change is locked, draft lessons included, so a concurrent
        // technical approval never approves a set from links that are being removed.
        const statuses = await this.lockOutcomeSetStatuses(tx, [
          ...added.map((outcomeId) => setOf.get(outcomeId) ?? ''),
          ...removed.map((link) => link.outcome.outcomeSetId),
        ]);
        // Monthly tests stay DRAFT after approval, so the unit status decides what is published.
        if (unitStatus === 'APPROVED') {
          const lockedAdds = added.filter(
            (outcomeId) => statuses.get(setOf.get(outcomeId) ?? '') !== 'DRAFT',
          );
          if (lockedAdds.length)
            throw new AppError(
              'OUTCOME_SET_LOCKED',
              'An approved lesson can only be linked to CLOs of a draft set',
              HttpStatus.CONFLICT,
              { outcomeIds: lockedAdds },
            );
          removed = removed.filter((link) => statuses.get(link.outcome.outcomeSetId) === 'DRAFT');
        }
      }
      if (removed.length)
        await tx.lessonOutcome.deleteMany({
          where: { lessonId, outcomeId: { in: removed.map((link) => link.outcomeId) } },
        });
      if (added.length)
        await tx.lessonOutcome.createMany({
          data: added.map((outcomeId) => ({ lessonId, outcomeId })),
        });
      const removedIds = new Set(removed.map((link) => link.outcomeId));
      const kept = current
        .map((link) => link.outcomeId)
        .filter((outcomeId) => !wanted.has(outcomeId) && !removedIds.has(outcomeId));
      return { lessonId, outcomeIds: [...outcomeIds, ...kept] };
    });
  }

  /** Locking reads return the committed status even when the transaction snapshot is older. */
  private async lockOutcomeSetStatuses(
    tx: Prisma.TransactionClient,
    setIds: string[],
  ): Promise<Map<string, string>> {
    const statuses = new Map<string, string>();
    // One fixed order for every writer avoids deadlocks between two remaps.
    for (const setId of [...new Set(setIds)].filter(Boolean).sort()) {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM outcome_sets WHERE id = ${setId} FOR UPDATE`;
      if (rows[0]) statuses.set(setId, rows[0].status);
    }
    return statuses;
  }

  async verifySource(
    user: AuthenticatedUser,
    outcomeId: string,
    sourceLocator: string,
    sourceNote: string,
    expectedRevision?: number,
  ): Promise<unknown> {
    roles(user, 'TEACHER');
    assertRule(
      sourceLocator.trim().length >= 2 && sourceNote.trim().length >= 5,
      'SOURCE_REVIEW_INCOMPLETE',
      'Provide the exact source section/page and a review note',
      HttpStatus.BAD_REQUEST,
    );
    return this.repo.transaction(async (tx) => {
      await tx.$queryRaw`SELECT s.id FROM outcome_sets AS s INNER JOIN learning_outcomes AS o ON o.outcomeSetId = s.id WHERE o.id = ${outcomeId} FOR UPDATE`;
      const outcome = await tx.learningOutcome.findUnique({
        where: { id: outcomeId },
        include: { outcomeSet: true },
      });
      assertRule(outcome, 'OUTCOME_NOT_FOUND', 'Outcome not found', HttpStatus.NOT_FOUND);
      await this.assertProgramTeacher(user, outcome.outcomeSet.programId);
      // Optional step: a CLO without a source may still be verified, which confirms its content.
      await this.lockDraftSet(tx, outcome.outcomeSetId, 'Only draft outcomes can be reviewed');
      if (expectedRevision !== undefined) {
        // Locking read: a plain read would use the snapshot taken before the lock wait (TiDB).
        const locked = await this.lockOutcome(tx, outcomeId);
        assertRule(
          locked?.revision === expectedRevision,
          'REVISION_CONFLICT',
          'Outcome changed; reload it',
        );
      }
      return tx.learningOutcome.update({
        where: { id: outcomeId },
        data: {
          sourceLocator: sourceLocator.trim(),
          sourceNote: sourceNote.trim(),
          sourceStatus: 'VERIFIED',
          verifiedById: user.id,
          verifiedAt: new Date(),
          revision: { increment: 1 },
        },
      });
    });
  }

  async technicalApprove(user: AuthenticatedUser, setId: string): Promise<unknown> {
    roles(user, 'TEACHER');
    return this.repo.transaction(async (tx) => {
      // Every CLO write and lesson remap of this set locks the same row first. All reads below
      // are locking reads: on TiDB a plain read uses the snapshot taken before the lock wait,
      // so it could miss a CLO or a link removal committed while this approval waited.
      const set = await this.lockSet(tx, setId);
      await this.assertProgramTeacher(user, set.programId);
      assertRule(set.status === 'DRAFT', 'OUTCOME_SET_LOCKED', 'Only draft sets can be reviewed');
      const outcomes = await this.lockSetOutcomes(tx, setId);
      const linked = new Set(
        outcomes.length
          ? (
              await tx.$queryRaw<Array<{ outcomeId: string }>>`
                SELECT outcomeId FROM lesson_outcomes
                WHERE outcomeId IN (${Prisma.join(outcomes.map((outcome) => outcome.id))})
                FOR UPDATE`
            ).map((row) => row.outcomeId)
          : [],
      );
      // Light CLOs (Q2): sources are optional, but every CLO must be taught by a lesson.
      const unlinked = outcomes.filter((outcome) => !linked.has(outcome.id));
      if (!outcomes.length || unlinked.length)
        throw new AppError(
          'OUTCOME_SET_INCOMPLETE',
          'The set needs at least one outcome and every outcome needs a linked lesson',
          HttpStatus.CONFLICT,
          {
            outcomeIds: unlinked.map((outcome) => outcome.id),
            codes: unlinked.map((outcome) => outcome.code),
          },
        );
      const now = new Date();
      // Approving the set verifies its CLOs; earlier verifications keep the teacher who did them.
      await tx.learningOutcome.updateMany({
        where: { outcomeSetId: setId, sourceStatus: { not: 'VERIFIED' } },
        data: {
          sourceStatus: 'VERIFIED',
          verifiedById: user.id,
          verifiedAt: now,
          revision: { increment: 1 },
        },
      });
      // Teacher review is the final approval: the set is usable in assignments right away.
      return tx.outcomeSet.update({
        where: { id: setId },
        data: {
          status: 'APPROVED',
          reviewerId: user.id,
          reviewedAt: now,
          approvedById: user.id,
          approvedAt: now,
          reviewNote: null,
        },
      });
    });
  }

  /** The child's registration class or any class they were moved to belongs to the program. */
  private async assertParentProgram(user: AuthenticatedUser, programId: string): Promise<void> {
    const child = await this.repo.db.enrollment.findFirst({
      where: {
        OR: [{ class: { programId } }, { placements: { some: { class: { programId } } } }],
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
  }

  /** Teachers of the program or subject, or the teacher chosen for one of its curricula (Q3). */
  private async assertProgramTeacher(user: AuthenticatedUser, programId: string): Promise<void> {
    assertRule(
      await mayReviewProgramOutcomes(this.repo.db, user.id, programId, new Date()),
      'FORBIDDEN',
      'Teacher may not review this program',
      HttpStatus.FORBIDDEN,
    );
  }

  /**
   * CLO sets no longer wait for a curriculum (Q2): the program only has to be in use. A program
   * the ADMIN soft-deleted keeps `isActive`, so `deletedAt` is checked too and reads as not found,
   * like the program list that hides it.
   */
  private async assertWritableProgram(programId: string): Promise<void> {
    const program = await this.repo.db.program.findUnique({
      where: { id: programId },
      include: { subjectRecord: { select: { isActive: true, deletedAt: true } } },
    });
    assertRule(
      program && !program.deletedAt,
      'PROGRAM_NOT_FOUND',
      'Program not found',
      HttpStatus.NOT_FOUND,
    );
    assertRule(program.isActive, 'PROGRAM_INACTIVE', 'Program is inactive');
    assertRule(
      !program.subjectId || (program.subjectRecord?.isActive && !program.subjectRecord.deletedAt),
      'SUBJECT_INACTIVE',
      'Subject is inactive',
    );
  }

  /**
   * Locks the set row that technical approval also locks, so an edit never lands in a set that
   * is being approved. The locking read returns the committed status, not an older snapshot.
   */
  private async lockDraftSet(
    tx: Prisma.TransactionClient,
    setId: string,
    lockedMessage: string,
  ): Promise<void> {
    const status = (await this.lockOutcomeSetStatuses(tx, [setId])).get(setId);
    assertRule(status, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
    assertRule(status === 'DRAFT', 'OUTCOME_SET_LOCKED', lockedMessage);
  }

  private async lockSet(
    tx: Prisma.TransactionClient,
    setId: string,
  ): Promise<{ status: string; programId: string; level: string; version: number }> {
    const rows = await tx.$queryRaw<
      Array<{ status: string; programId: string; level: string; version: number | bigint }>
    >`SELECT status, programId, level, version FROM outcome_sets WHERE id = ${setId} FOR UPDATE`;
    const row = rows[0];
    assertRule(row, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
    return { ...row, version: Number(row.version) };
  }

  private async lockSetOutcomes(
    tx: Prisma.TransactionClient,
    setId: string,
  ): Promise<Array<{ id: string; code: string }>> {
    return tx.$queryRaw<Array<{ id: string; code: string }>>`
      SELECT id, code FROM learning_outcomes WHERE outcomeSetId = ${setId} ORDER BY code FOR UPDATE`;
  }

  private async lockOutcome(
    tx: Prisma.TransactionClient,
    outcomeId: string,
  ): Promise<{ outcomeSetId: string; revision: number } | undefined> {
    const rows = await tx.$queryRaw<Array<{ outcomeSetId: string; revision: number | bigint }>>`
      SELECT outcomeSetId, revision FROM learning_outcomes WHERE id = ${outcomeId} FOR UPDATE`;
    return rows[0] && { outcomeSetId: rows[0].outcomeSetId, revision: Number(rows[0].revision) };
  }

  private async auditOutcome(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    action: 'OUTCOME_CREATED' | 'OUTCOME_UPDATED' | 'OUTCOME_DELETED',
    outcomeId: string,
    setId: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action,
        entityType: 'LearningOutcome',
        entityId: outcomeId,
        afterData: { outcomeSetId: setId },
      },
    });
  }
}

function cleanOptional(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value?.trim() || null;
}
