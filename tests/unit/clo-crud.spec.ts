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
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
          }),
        },
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

    it('blocks deletion if another designer attempts to delete', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
          }),
        },
      };

      await expect(outcomeService(db).deleteOutcome(otherDesigner, 'set-1', 'clo-1')).rejects.toThrow(
        'Only the set designer',
      );
    });

    it('blocks deletion if outcome is in use in assignments', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
          }),
        },
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
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
            outcomes: [],
          }),
          delete: deleteSet,
        },
        assignment: {
          count: jest.fn().mockResolvedValue(0),
        },
      };

      const result = (await outcomeService(db).deleteSet(designer, 'set-1')) as {
        id: string;
        deleted: boolean;
      };
      expect(result.deleted).toBe(true);
      expect(deleteSet).toHaveBeenCalledWith({ where: { id: 'set-1' } });
    });

    it('refuses to delete an approved outcome set', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'APPROVED',
            outcomes: [],
          }),
        },
      };

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

    it('refuses a designer who did not write the lesson', async () => {
      const db = remapDb({ designerId: otherDesigner.id });
      await expect(
        outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('lets the teacher approve the set once the new CLO is linked to an approved lesson', async () => {
      const remap = remapDb();
      await outcomeService(remap).setLessonOutcomes(designer, 'lesson-1', ['clo-draft']);
      const teacher = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;
      const update = jest.fn().mockResolvedValue({ id: 'set-draft' });
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        class: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { teacherId: teacher.id, pendingTeacherId: null, pendingTeacherFrom: null },
            ]),
        },
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-draft',
            programId: 'program-1',
            status: 'DRAFT',
            outcomes: [
              {
                sourceStatus: 'VERIFIED',
                verifiedById: teacher.id,
                lessonLinks: (
                  remap.lessonOutcome.createMany.mock.calls[0] as [
                    { data: Array<{ lessonId: string }> },
                  ]
                )[0].data,
              },
            ],
          }),
          update,
        },
      };
      await outcomeService(db).technicalApprove(teacher, 'set-draft');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'set-draft' },
        data: expect.objectContaining({ status: 'TECHNICALLY_APPROVED' }) as unknown,
      });
      const [lock] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(lock.join('?')).toContain('FROM outcome_sets');
    });
  });
});
