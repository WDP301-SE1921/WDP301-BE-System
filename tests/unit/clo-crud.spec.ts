import { OutcomeService } from '../../src/modules/academic/outcome.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('CLO CRUD operations', () => {
  const designer = { id: 'designer-1', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
  const manager = { id: 'manager-1', role: 'MANAGER' } as AuthenticatedUser;
  const otherDesigner = { id: 'designer-2', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;

  function outcomeService(db: unknown): OutcomeService {
    return new OutcomeService({
      db: db as never,
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(db),
    } as unknown as never);
  }

  /** $queryRaw for the set row lock: returns the committed status of every locked set. */
  function lockedDraft(
    status = 'DRAFT',
    revision = 1,
    outcomes: Array<{ id: string; code: string }> = [],
  ): jest.Mock {
    return jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM outcome_sets'))
        return Promise.resolve([
          { id: values[0], status, programId: 'program-1', level: 'Lớp 8', version: 2 },
        ]);
      if (sql.includes('FROM learning_outcomes WHERE outcomeSetId')) return Promise.resolve(outcomes);
      if (sql.includes('FROM learning_outcomes'))
        return Promise.resolve([{ outcomeSetId: 'set-1', revision }]);
      return Promise.resolve([]);
    });
  }

  /** The teacher runs an active class of program-1 (reviewer group PROGRAM). */
  function programTeacherDb(teacherId: string): Record<string, unknown> {
    return {
      program: {
        findMany: jest.fn().mockResolvedValue([{ id: 'program-1', subject: 'Toán', subjectId: null }]),
      },
      class: {
        findMany: jest.fn().mockResolvedValue([
          { programId: 'program-1', teacherId, pendingTeacherId: null, pendingTeacherFrom: null },
        ]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: teacherId }),
        findMany: jest.fn().mockResolvedValue([{ id: teacherId }]),
      },
      curriculumUnit: { count: jest.fn().mockResolvedValue(0) },
    };
  }

  describe('getSet & getOutcome', () => {
    it('returns single outcome set with outcomes and program info', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            programId: 'program-1',
            status: 'APPROVED',
            level: 'Lớp 8 - Cơ bản',
            version: 1,
            outcomes: [{ id: 'clo-1', code: 'M8-EQ-01', title: 'Nhận biết phương trình' }],
          }),
        },
      };

      const result = (await outcomeService(db).getSet(manager, 'set-1')) as {
        id: string;
        level: string;
      };
      expect(result.id).toBe('set-1');
      expect(result.level).toBe('Lớp 8 - Cơ bản');
    });

    it('returns single learning outcome with linked lessons and set info', async () => {
      const db = {
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'clo-1',
            outcomeSetId: 'set-1',
            code: 'M8-EQ-01',
            title: 'Nhận biết phương trình',
            outcomeSet: { id: 'set-1', programId: 'program-1', status: 'APPROVED' },
            lessonLinks: [],
          }),
        },
      };

      const result = (await outcomeService(db).getOutcome(manager, 'clo-1')) as {
        id: string;
        code: string;
      };
      expect(result.id).toBe('clo-1');
      expect(result.code).toBe('M8-EQ-01');
    });
  });

  describe('parent access', () => {
    const parent = { id: 'parent-1', role: 'PARENT' } as AuthenticatedUser;
    const approvedSet = {
      id: 'set-1',
      programId: 'program-1',
      status: 'APPROVED',
      program: { id: 'program-1', name: 'Toán 8', subject: 'Toán', grade: 8 },
      level: 'Lớp 8',
      version: 1,
      outcomes: [
        {
          id: 'clo-1',
          code: 'M8-01',
          title: 'A',
          statement: 'S',
          required: false,
          lessonLinks: [],
        },
      ],
    };

    it('accepts a child moved to a class of the program, not only the registration class', async () => {
      const findFirst = jest.fn<Promise<{ id: string }>, [{ where: unknown }]>(() =>
        Promise.resolve({ id: 'enrollment-1' }),
      );
      const db = {
        outcomeSet: { findUnique: jest.fn().mockResolvedValue(approvedSet) },
        enrollment: { findFirst },
      };

      const result = (await outcomeService(db).getSet(parent, 'set-1')) as {
        outcomes: { required: boolean }[];
      };
      expect(result.outcomes[0].required).toBe(false);
      expect(findFirst.mock.calls[0]?.[0].where).toMatchObject({
        OR: [
          { class: { programId: 'program-1' } },
          { placements: { some: { class: { programId: 'program-1' } } } },
        ],
        studentProfile: { parentProfile: { userId: 'parent-1' } },
      });
    });

    it('refuses a parent whose children never studied the program', async () => {
      const db = {
        outcomeSet: { findUnique: jest.fn().mockResolvedValue(approvedSet) },
        enrollment: { findFirst: jest.fn().mockResolvedValue(null) },
      };

      await expect(outcomeService(db).getSet(parent, 'set-1')).rejects.toThrow(
        'Program does not belong to a linked child',
      );
    });
  });

  describe('deleteOutcome', () => {
    it('allows the set designer to delete a draft outcome not used in assignments', async () => {
      const deleteLinks = jest.fn().mockResolvedValue({ count: 1 });
      const deleteOutcome = jest.fn().mockResolvedValue({ id: 'clo-1' });
      const db = {
        $queryRaw: lockedDraft(),
        auditLog: { create: jest.fn() },
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({ id: 'clo-1', outcomeSetId: 'set-1' }),
          delete: deleteOutcome,
        },
        assignmentQuestion: {
          count: jest.fn().mockResolvedValue(0),
        },
        lessonOutcome: {
          deleteMany: deleteLinks,
        },
      };

      const result = (await outcomeService(db).deleteOutcome(designer, 'set-1', 'clo-1')) as {
        id: string;
        deleted: boolean;
      };
      expect(result.deleted).toBe(true);
      expect(deleteLinks).toHaveBeenCalledWith({ where: { outcomeId: 'clo-1' } });
      expect(deleteOutcome).toHaveBeenCalledWith({ where: { id: 'clo-1' } });
    });

    it('lets another designer delete a draft outcome and audits who did it (Q6)', async () => {
      const audit = jest.fn();
      const db = {
        $queryRaw: lockedDraft(),
        auditLog: { create: audit },
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({ id: 'clo-1', outcomeSetId: 'set-1' }),
          delete: jest.fn(),
        },
        assignmentQuestion: { count: jest.fn().mockResolvedValue(0) },
        lessonOutcome: { deleteMany: jest.fn() },
      };

      await expect(
        outcomeService(db).deleteOutcome(otherDesigner, 'set-1', 'clo-1'),
      ).resolves.toMatchObject({ deleted: true });
      expect(audit).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: otherDesigner.id,
          action: 'OUTCOME_DELETED',
        }) as unknown,
      });
    });

    it('refuses a teacher and a set that is no longer a draft', async () => {
      const teacher = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;
      await expect(
        outcomeService({}).deleteOutcome(teacher, 'set-1', 'clo-1'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      await expect(
        outcomeService({ $queryRaw: lockedDraft('TECHNICALLY_APPROVED') }).deleteOutcome(
          designer,
          'set-1',
          'clo-1',
        ),
      ).rejects.toMatchObject({ code: 'OUTCOME_SET_LOCKED', statusCode: 409 });
    });

    it('blocks deletion if outcome is in use in assignments', async () => {
      const db = {
        $queryRaw: lockedDraft(),
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({ id: 'clo-1', outcomeSetId: 'set-1' }),
        },
        assignmentQuestion: {
          count: jest.fn().mockResolvedValue(2),
        },
      };

      await expect(outcomeService(db).deleteOutcome(designer, 'set-1', 'clo-1')).rejects.toThrow(
        'Cannot delete an outcome used in assignments',
      );
    });
  });

  describe('deleteSet', () => {
    it('allows designer to delete an empty draft outcome set', async () => {
      const deleteSet = jest.fn().mockResolvedValue({ id: 'set-1' });
      const audit = jest.fn();
      const db = {
        $queryRaw: lockedDraft(),
        outcomeSet: { findUnique: jest.fn(), delete: deleteSet },
        assignment: {
          count: jest.fn().mockResolvedValue(0),
        },
        auditLog: { create: audit },
      };

      const result = (await outcomeService(db).deleteSet(otherDesigner, 'set-1')) as {
        id: string;
        deleted: boolean;
      };
      expect(result.deleted).toBe(true);
      expect(deleteSet).toHaveBeenCalledWith({ where: { id: 'set-1' } });
      // The set row is locked and read in one statement, never through an older snapshot.
      const [lock] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(lock.join('?')).toContain('FROM outcome_sets');
      expect(lock.join('?')).toContain('FOR UPDATE');
      expect(db.outcomeSet.findUnique).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledWith({
        data: {
          actorUserId: otherDesigner.id,
          action: 'OUTCOME_SET_DELETED',
          entityType: 'OutcomeSet',
          entityId: 'set-1',
          afterData: { programId: 'program-1', level: 'Lớp 8', version: 2 },
        },
      });
    });

    it('deletes the CLOs found by the locked read, with their lesson links', async () => {
      const db = {
        $queryRaw: lockedDraft('DRAFT', 1, [{ id: 'clo-1', code: 'M8-01' }]),
        outcomeSet: { delete: jest.fn() },
        assignment: { count: jest.fn().mockResolvedValue(0) },
        assignmentQuestion: { count: jest.fn().mockResolvedValue(0) },
        lessonOutcome: { deleteMany: jest.fn() },
        learningOutcome: { deleteMany: jest.fn() },
        auditLog: { create: jest.fn() },
      };
      await outcomeService(db).deleteSet(designer, 'set-1');
      expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({
        where: { outcomeId: { in: ['clo-1'] } },
      });
      expect(db.learningOutcome.deleteMany).toHaveBeenCalledWith({ where: { outcomeSetId: 'set-1' } });
    });

    it('refuses to delete an approved outcome set', async () => {
      const db = { $queryRaw: lockedDraft('APPROVED') };

      await expect(outcomeService(db).deleteSet(designer, 'set-1')).rejects.toThrow(
        'Only draft outcome sets can be deleted',
      );
    });
  });

  describe('setLessonOutcomes', () => {
    interface RemapDb {
      $queryRaw: jest.Mock;
      lesson: { findUnique: jest.Mock };
      learningOutcome: { findMany: jest.Mock };
      lessonOutcome: Record<'findMany' | 'deleteMany' | 'createMany', jest.Mock>;
    }
    // CLO id → set id; set statuses below cover draft, teacher-reviewed and approved sets.
    const catalog: Record<string, string> = {
      'clo-draft': 'set-draft',
      'clo-draft-2': 'set-draft',
      'clo-approved': 'set-approved',
      'clo-reviewed': 'set-reviewed',
    };
    const setStatus: Record<string, string> = {
      'set-draft': 'DRAFT',
      'set-approved': 'APPROVED',
      'set-reviewed': 'TECHNICALLY_APPROVED',
    };

    function remapDb(
      options: {
        lessonStatus?: string;
        unitStatus?: string | null;
        designerId?: string;
        current?: string[];
        setStatus?: Record<string, string>;
      } = {},
    ): RemapDb {
      const statuses = { ...setStatus, ...options.setStatus };
      return {
        $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
          const id = String(values[0]);
          return Promise.resolve(
            strings.join('?').includes('outcome_sets') && statuses[id]
              ? [{ id, status: statuses[id] }]
              : [],
          );
        }),
        lesson: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'lesson-1',
            programId: 'program-1',
            designerId: options.designerId ?? designer.id,
            status: options.lessonStatus ?? 'APPROVED',
            unit: options.unitStatus === null ? null : { status: options.unitStatus ?? 'APPROVED' },
          }),
        },
        learningOutcome: {
          findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
            Promise.resolve(
              where.id.in
                .filter((id) => catalog[id])
                .map((id) => ({
                  id,
                  outcomeSetId: catalog[id],
                  outcomeSet: { programId: 'program-1' },
                })),
            ),
          ),
        },
        lessonOutcome: {
          findMany: jest.fn().mockResolvedValue(
            (options.current ?? []).map((outcomeId) => ({
              outcomeId,
              outcome: { outcomeSetId: catalog[outcomeId] },
            })),
          ),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };
    }

    function lockedSets(db: RemapDb): string[] {
      const calls = db.$queryRaw.mock.calls as Array<[TemplateStringsArray, ...unknown[]]>;
      return calls
        .filter(([strings]) => strings.join('?').includes('outcome_sets'))
        .map(([, id]) => String(id));
    }
    const lockedLessons: Array<[string, string | null]> = [
      ['DRAFT', 'ARCHIVED'],
      ['APPROVED', 'ARCHIVED'],
      ['APPROVED', null],
    ];

    it('links a CLO of a draft set to a lesson of the applied curriculum', async () => {
      const db = remapDb();
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']),
      ).resolves.toEqual({ lessonId: 'lesson-1', outcomeIds: ['clo-draft'] });
      expect(db.lessonOutcome.createMany).toHaveBeenCalledWith({
        data: [{ lessonId: 'lesson-1', outcomeId: 'clo-draft' }],
      });
      expect(db.lessonOutcome.deleteMany).not.toHaveBeenCalled();
      const [firstLock] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(firstLock.join('?')).toContain('FROM lessons');
      expect(lockedSets(db)).toEqual(['set-draft']);
    });

    it('keeps links to reviewed or approved sets that the request omits', async () => {
      const db = remapDb({ current: ['clo-approved', 'clo-reviewed', 'clo-draft'] });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft-2']),
      ).resolves.toEqual({
        lessonId: 'lesson-1',
        outcomeIds: ['clo-draft-2', 'clo-approved', 'clo-reviewed'],
      });
      expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({
        where: { lessonId: 'lesson-1', outcomeId: { in: ['clo-draft'] } },
      });
      expect(db.lessonOutcome.createMany).toHaveBeenCalledWith({
        data: [{ lessonId: 'lesson-1', outcomeId: 'clo-draft-2' }],
      });
      expect(lockedSets(db)).toEqual(['set-approved', 'set-draft', 'set-reviewed']);
    });

    it.each(['clo-approved', 'clo-reviewed'])(
      'refuses to add %s to a lesson of the applied curriculum',
      async (outcomeId) => {
        const db = remapDb({ current: ['clo-draft'] });
        await expect(
          outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft', outcomeId]),
        ).rejects.toMatchObject({
          code: 'OUTCOME_SET_LOCKED',
          statusCode: 409,
          details: { outcomeIds: [outcomeId] },
        });
        expect(db.lessonOutcome.deleteMany).not.toHaveBeenCalled();
        expect(db.lessonOutcome.createMany).not.toHaveBeenCalled();
      },
    );

    it('applies the applied-curriculum rule to draft monthly tests of an approved unit', async () => {
      const db = remapDb({ lessonStatus: 'DRAFT', unitStatus: 'APPROVED' });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-approved']),
      ).rejects.toMatchObject({ code: 'OUTCOME_SET_LOCKED' });
    });

    it('lets the designer remap again once the manager returns the set to draft', async () => {
      // requestChanges puts the set back to DRAFT, which makes its links editable again.
      const db = remapDb({
        current: ['clo-draft', 'clo-approved'],
        setStatus: { 'set-approved': 'DRAFT' },
      });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']),
      ).resolves.toEqual({ lessonId: 'lesson-1', outcomeIds: ['clo-draft'] });
      expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({
        where: { lessonId: 'lesson-1', outcomeId: { in: ['clo-approved'] } },
      });
      expect(lockedSets(db)).toEqual(['set-approved']);
    });

    it('treats a reordered request as no change', async () => {
      const db = remapDb({ current: ['clo-approved', 'clo-draft'] });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft', 'clo-approved']),
      ).resolves.toEqual({ lessonId: 'lesson-1', outcomeIds: ['clo-draft', 'clo-approved'] });
      expect(db.lessonOutcome.deleteMany).not.toHaveBeenCalled();
      expect(db.lessonOutcome.createMany).not.toHaveBeenCalled();
      expect(lockedSets(db)).toEqual([]);
    });

    it('keeps the old rule for draft lessons: any set of the program, links may be removed', async () => {
      const db = remapDb({ lessonStatus: 'DRAFT', unitStatus: 'DRAFT', current: ['clo-approved'] });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-reviewed']),
      ).resolves.toEqual({ lessonId: 'lesson-1', outcomeIds: ['clo-reviewed'] });
      expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({
        where: { lessonId: 'lesson-1', outcomeId: { in: ['clo-approved'] } },
      });
      // Draft lessons still lock every set whose links change, against a concurrent approval.
      expect(lockedSets(db)).toEqual(['set-approved', 'set-reviewed']);
    });

    it.each(lockedLessons)(
      'locks a %s lesson whose unit is %s',
      async (lessonStatus, unitStatus) => {
        const db = remapDb({ lessonStatus, unitStatus });
        await expect(
          outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']),
        ).rejects.toMatchObject({ code: 'LESSON_LOCKED', statusCode: 409 });
        expect(db.lessonOutcome.createMany).not.toHaveBeenCalled();
      },
    );

    it('lets a designer remap a lesson written by another designer (Q6)', async () => {
      const db = remapDb({ designerId: otherDesigner.id });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']),
      ).resolves.toEqual({ lessonId: 'lesson-1', outcomeIds: ['clo-draft'] });
    });

    it('still refuses a teacher', async () => {
      const teacher = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;
      await expect(
        outcomeService(remapDb()).setLessonOutcomes(teacher, 'lesson-1', ['clo-draft']),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('lets the teacher approve the set once the new CLO is linked to an approved lesson', async () => {
      const remap = remapDb();
      await outcomeService(remap).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']);
      const teacher = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;
      const update = jest.fn().mockResolvedValue({ id: 'set-draft' });
      // The remap above wrote the link that the locked read of lesson_outcomes now returns.
      const [{ data: links }] = remap.lessonOutcome.createMany.mock.calls[0] as [
        { data: Array<{ outcomeId: string }> },
      ];
      const db = {
        $queryRaw: jest.fn((strings: TemplateStringsArray) => {
          const sql = strings.join('?');
          if (sql.includes('FROM outcome_sets'))
            return Promise.resolve([{ status: 'DRAFT', programId: 'program-1', level: 'L', version: 1 }]);
          if (sql.includes('FROM learning_outcomes'))
            return Promise.resolve([{ id: 'clo-draft', code: 'M8-01' }]);
          if (sql.includes('FROM lesson_outcomes'))
            return Promise.resolve(links.map((link) => ({ outcomeId: link.outcomeId })));
          return Promise.resolve([]);
        }),
        ...programTeacherDb(teacher.id),
        learningOutcome: { updateMany: jest.fn() },
        outcomeSet: { update },
      };
      await outcomeService(db).technicalApprove(teacher, 'set-draft');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'set-draft' },
        data: expect.objectContaining({ status: 'TECHNICALLY_APPROVED' }) as unknown,
      });
      const [lock] = db.$queryRaw.mock.calls[0];
      expect(lock.join('?')).toContain('FROM outcome_sets');
    });
  });

  describe('writeOutcome (light CLOs, shared drafts)', () => {
    const input = {
      code: 'M8-EQ-01',
      title: 'Giải phương trình',
      statement: 'Giải được phương trình bậc nhất một ẩn.',
    };

    function writeDb(revision = 3): {
      $queryRaw: jest.Mock;
      auditLog: { create: jest.Mock };
      learningOutcome: Record<'create' | 'update', jest.Mock>;
    } {
      return {
        $queryRaw: lockedDraft('DRAFT', revision),
        auditLog: { create: jest.fn() },
        learningOutcome: {
          create: jest.fn(({ data }: { data: unknown }) => Promise.resolve({ id: 'clo-new', ...(data as object) })),
          update: jest.fn(({ data }: { data: unknown }) => Promise.resolve({ id: 'clo-1', ...(data as object) })),
        },
      };
    }

    it('creates a CLO without sources and stores null, never an empty string', async () => {
      const db = writeDb();
      await outcomeService(db).writeOutcome(designer, 'set-1', {
        ...input,
        sourceTitle: '   ',
        sourceUrl: null,
      });
      const [{ data }] = db.learningOutcome.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data.sourceTitle).toBeNull();
      expect(data.sourceUrl).toBeNull();
      expect(data.sourceLocator).toBeUndefined();
      expect(data.outcomeSetId).toBe('set-1');
    });

    it('keeps stored sources the update omits and clears the ones sent blank', async () => {
      const db = writeDb();
      await outcomeService(db).writeOutcome(
        otherDesigner,
        'set-1',
        { ...input, sourceNote: '  ', expectedRevision: 3 },
        'clo-1',
      );
      const [{ data }] = db.learningOutcome.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data.sourceTitle).toBeUndefined();
      expect(data.sourceNote).toBeNull();
      expect(data.revision).toEqual({ increment: 1 });
      expect(data.sourceStatus).toBe('CANDIDATE');
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorUserId: otherDesigner.id, action: 'OUTCOME_UPDATED' }) as unknown,
      });
    });

    it('refuses a stale revision instead of overwriting another designer', async () => {
      const db = writeDb(4);
      await expect(
        outcomeService(db).writeOutcome(designer, 'set-1', { ...input, expectedRevision: 3 }, 'clo-1'),
      ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', statusCode: 409 });
      expect(db.learningOutcome.update).not.toHaveBeenCalled();
    });

    it('locks the set row before reading its status', async () => {
      const db = writeDb();
      db.$queryRaw = lockedDraft('TECHNICALLY_APPROVED');
      await expect(
        outcomeService(db).writeOutcome(designer, 'set-1', input, 'clo-1'),
      ).rejects.toMatchObject({ code: 'OUTCOME_SET_LOCKED', statusCode: 409 });
      const [lock] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(lock.join('?')).toContain('FROM outcome_sets');
      expect(lock.join('?')).toContain('FOR UPDATE');
    });

    it('refuses a teacher', async () => {
      const teacher = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;
      await expect(
        outcomeService(writeDb()).writeOutcome(teacher, 'set-1', input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });
  });

  describe('verifySource (C29, C30)', () => {
    const teacher = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;

    function verifyDb(revision = 3): Record<string, unknown> {
      return {
        ...programTeacherDb('teacher-1'),
        $queryRaw: lockedDraft('DRAFT', revision),
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'clo-1',
            outcomeSetId: 'set-1',
            outcomeSet: { programId: 'program-1' },
          }),
          update: jest.fn(({ data }: { data: unknown }) => Promise.resolve({ id: 'clo-1', ...(data as object) })),
        },
      };
    }

    it('verifies with a short locator such as "Trang 45"', async () => {
      const db = verifyDb();
      await outcomeService(db).verifySource(teacher, 'clo-1', 'Trang 45', 'Khớp ý');
      const update = (db.learningOutcome as Record<'update', jest.Mock>).update;
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sourceLocator: 'Trang 45', sourceStatus: 'VERIFIED' }) as unknown,
        }),
      );
    });

    it('still refuses a one-character locator or a too short note', async () => {
      await expect(
        outcomeService(verifyDb()).verifySource(teacher, 'clo-1', 'x', 'Khớp ý'),
      ).rejects.toMatchObject({ code: 'SOURCE_REVIEW_INCOMPLETE', statusCode: 400 });
      await expect(
        outcomeService(verifyDb()).verifySource(teacher, 'clo-1', 'Trang 45', 'ok'),
      ).rejects.toMatchObject({ code: 'SOURCE_REVIEW_INCOMPLETE', statusCode: 400 });
    });

    it('refuses a stale expectedRevision, read after the row lock', async () => {
      const db = verifyDb(4);
      await expect(
        outcomeService(db).verifySource(teacher, 'clo-1', 'Trang 45', 'Khớp ý', 3),
      ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', statusCode: 409 });
      expect((db.learningOutcome as Record<'update', jest.Mock>).update).not.toHaveBeenCalled();
    });

    it('accepts the current expectedRevision', async () => {
      const db = verifyDb(3);
      await outcomeService(db).verifySource(teacher, 'clo-1', 'Trang 45', 'Khớp ý', 3);
      expect((db.learningOutcome as Record<'update', jest.Mock>).update).toHaveBeenCalled();
    });
  });

  describe('createSet without a curriculum (Q2)', () => {
    function createDb(program: unknown): {
      program: { findUnique: jest.Mock };
      outcomeSet: Record<'findUnique' | 'findFirst' | 'create', jest.Mock>;
      auditLog: { create: jest.Mock };
    } {
      const create = jest.fn().mockResolvedValue({ id: 'set-new', level: 'Lớp 8', version: 1 });
      return {
        program: { findUnique: jest.fn().mockResolvedValue(program) },
        outcomeSet: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), create },
        auditLog: { create: jest.fn() },
      };
    }

    it('creates a set for an active program that has no curriculum yet', async () => {
      const db = createDb({ id: 'program-1', isActive: true, subjectId: null, subjectRecord: null });
      await expect(
        outcomeService(db).createSet(otherDesigner, 'program-1', 'Lớp 8'),
      ).resolves.toMatchObject({ id: 'set-new' });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'OUTCOME_SET_CREATED', actorUserId: otherDesigner.id }) as unknown,
      });
    });

    it('refuses a missing, inactive or subject-inactive program', async () => {
      await expect(
        outcomeService(createDb(null)).createSet(designer, 'program-x', 'Lớp 8'),
      ).rejects.toMatchObject({ code: 'PROGRAM_NOT_FOUND', statusCode: 404 });
      await expect(
        outcomeService(createDb({ id: 'p', isActive: false, subjectId: null })).createSet(designer, 'p', 'Lớp 8'),
      ).rejects.toMatchObject({ code: 'PROGRAM_INACTIVE', statusCode: 409 });
      await expect(
        outcomeService(
          createDb({ id: 'p', isActive: true, subjectId: 's', subjectRecord: { isActive: false } }),
        ).createSet(designer, 'p', 'Lớp 8'),
      ).rejects.toMatchObject({ code: 'SUBJECT_INACTIVE', statusCode: 409 });
    });
  });

  describe('designers read every set (Q6)', () => {
    it('lets a designer open a draft set written by another designer', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({ id: 'set-1', status: 'DRAFT', designerId: 'designer-1', outcomes: [] }),
        },
      };
      await expect(outcomeService(db).getSet(otherDesigner, 'set-1')).resolves.toMatchObject({ id: 'set-1' });
    });
  });
});
