import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AcademicAccessService } from '../../src/modules/academic/academic-access.service';
import type { AssignmentDto } from '../../src/modules/academic/academic.dto';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import {
  AssessmentService,
  assignmentOutcomes,
} from '../../src/modules/academic/assessment.service';

// Wave D (L1, D4): CLOs are linked to the whole assignment (assignment_outcomes), not per question.
const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
const parent = { id: 'parent', role: 'PARENT' } as AuthenticatedUser;
const question = {
  kind: 'MULTIPLE_CHOICE' as const,
  prompt: 'Q?',
  choices: ['A', 'B'],
  correctAnswer: 'A',
  maxScore: 1,
};
const definition: AssignmentDto = {
  classId: 'class',
  title: 'Bài 1',
  instructions: '',
  dueAt: '2099-10-01T12:00:00Z',
  maxAttempts: 1,
  questions: [question],
};
const clo = (id: string, code: string): Record<string, unknown> => ({
  id,
  code,
  title: `Mục tiêu ${code}`,
  required: true,
});

describe('assignment-level CLOs (B13–B15)', () => {
  const create = jest.fn();
  const update = jest.fn();
  const findAssignment = jest.fn();
  const findOutcomes = jest.fn();
  const findSet = jest.fn();
  const countSets = jest.fn();
  const countLinks = jest.fn();
  const findQuestions = jest.fn();
  const findEnrollments = jest.fn();
  let service: AssessmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: 'assignment' });
    update.mockResolvedValue({ id: 'assignment' });
    findSet.mockResolvedValue({
      id: 'set',
      programId: 'program',
      status: 'APPROVED',
      outcomes: [{ id: 'clo-1' }, { id: 'clo-2' }],
    });
    findOutcomes.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        ['clo-1', 'clo-2']
          .filter((id) => where.id.in.includes(id))
          .map((id) => ({ id, outcomeSetId: 'set' })),
      ),
    );
    countSets.mockResolvedValue(1);
    countLinks.mockResolvedValue(0);
    findQuestions.mockResolvedValue([{ id: 'q0', criteria: null, rubric: null, ...question }]);
    findEnrollments.mockResolvedValue([]);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      assignment: { create, update, findUniqueOrThrow: findAssignment },
      assignmentQuestion: { findMany: findQuestions, deleteMany: jest.fn() },
      assignmentOutcome: { count: countLinks },
      learningOutcome: { findMany: findOutcomes },
      enrollment: { findMany: findEnrollments },
      classSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session',
          classId: 'class',
          teacherId: 'teacher',
          status: 'SCHEDULED',
          endsAt: new Date('2099-10-01'),
        }),
      },
      class: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'class', programId: 'program' }),
      },
      outcomeSet: { findUnique: findSet, count: countSets },
    };
    service = new AssessmentService(
      {
        db: tx,
        transaction: (work: (db: unknown) => Promise<unknown>): Promise<unknown> => work(tx),
      } as unknown as AcademicRepository,
      { classroom: jest.fn().mockResolvedValue(undefined) } as unknown as AcademicAccessService,
      { assignment: jest.fn() } as unknown as NotificationEventsService,
    );
  });

  function written(mock: jest.Mock): Record<string, unknown> {
    return (mock.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
  }

  describe('create and update', () => {
    it('takes the set from outcomeIds and writes one link per CLO', async () => {
      await service.create(teacher, { ...definition, outcomeIds: ['clo-2', 'clo-1'] });
      const data = written(create);
      expect(data.outcomeSetId).toBe('set');
      expect(data.outcomeLinks).toEqual({
        create: [{ outcomeId: 'clo-2' }, { outcomeId: 'clo-1' }],
      });
      expect(data).not.toHaveProperty('outcomeIds');
    });

    it('saves a draft without any CLO', async () => {
      await service.create(teacher, definition);
      expect(written(create)).toMatchObject({ outcomeSetId: null, outcomeLinks: { create: [] } });
      expect(findSet).not.toHaveBeenCalled();
    });

    it('still accepts the deprecated questions[].outcomeId and links their distinct CLOs', async () => {
      await service.create(teacher, {
        ...definition,
        outcomeSetId: 'set',
        questions: [
          { ...question, outcomeId: 'clo-1' },
          { ...question, outcomeId: 'clo-1' },
          question,
        ],
      });
      expect(written(create).outcomeLinks).toEqual({ create: [{ outcomeId: 'clo-1' }] });
    });

    it('refuses CLOs from two sets, unknown CLOs and CLOs outside the chosen set', async () => {
      findOutcomes.mockResolvedValue([
        { id: 'clo-1', outcomeSetId: 'set' },
        { id: 'clo-x', outcomeSetId: 'other' },
      ]);
      await expect(
        service.create(teacher, { ...definition, outcomeIds: ['clo-1', 'clo-x'] }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET', statusCode: 409 });
      findOutcomes.mockResolvedValue([{ id: 'clo-1', outcomeSetId: 'set' }]);
      await expect(
        service.create(teacher, { ...definition, outcomeIds: ['clo-1', 'missing'] }),
      ).rejects.toMatchObject({
        code: 'INVALID_OUTCOME_SET',
        details: { outcomeIds: ['missing'] },
      });
      await expect(
        service.create(teacher, { ...definition, outcomeSetId: 'set', outcomeIds: ['clo-9'] }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET', details: { outcomeIds: ['clo-9'] } });
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses CLOs of a set that is not approved or belongs to another program', async () => {
      findSet.mockResolvedValue({ id: 'set', programId: 'program', status: 'DRAFT', outcomes: [] });
      await expect(
        service.create(teacher, { ...definition, outcomeIds: ['clo-1'] }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET' });
      findSet.mockResolvedValue({
        id: 'set',
        programId: 'other',
        status: 'APPROVED',
        outcomes: [],
      });
      await expect(
        service.create(teacher, { ...definition, outcomeIds: ['clo-1'] }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET' });
    });

    it('replaces the links when a draft is updated, also to none', async () => {
      findAssignment.mockResolvedValue({ id: 'assignment', classId: 'class', status: 'DRAFT' });
      await service.updateDraft(teacher, 'assignment', { ...definition, outcomeIds: ['clo-1'] });
      expect(written(update).outcomeLinks).toEqual({
        deleteMany: {},
        create: [{ outcomeId: 'clo-1' }],
      });
      update.mockClear();
      await service.updateDraft(teacher, 'assignment', { ...definition, outcomeIds: [] });
      expect(written(update)).toMatchObject({
        outcomeSetId: null,
        outcomeLinks: { deleteMany: {}, create: [] },
      });
    });
  });

  describe('publish', () => {
    function draft(kind: 'HOMEWORK' | 'TEST'): void {
      findAssignment.mockResolvedValue({
        id: 'assignment',
        ...definition,
        kind,
        sessionId: kind === 'TEST' ? 'session' : null,
        testType: kind === 'TEST' ? 'MIDTERM' : null,
        dueAt: new Date(definition.dueAt),
        status: 'DRAFT',
        outcomeSetId: null,
      });
    }

    it.each(['HOMEWORK', 'TEST'] as const)(
      'needs an assignment CLO for %s when the program has an approved set',
      async (kind) => {
        draft(kind);
        await expect(
          service.publish(teacher, 'assignment', { enrollmentIds: ['student'] }),
        ).rejects.toMatchObject({ code: 'ASSIGNMENT_OUTCOME_REQUIRED', statusCode: 409 });
        expect(countSets).toHaveBeenCalledWith({
          where: { programId: 'program', status: 'APPROVED' },
        });
        expect(countLinks).toHaveBeenCalledWith({ where: { assignmentId: 'assignment' } });
        expect(findEnrollments).not.toHaveBeenCalled();
      },
    );

    it('publishes with assignment CLOs even when no question has its own CLO', async () => {
      draft('HOMEWORK');
      countLinks.mockResolvedValue(2);
      // Reaching the recipients check means the CLO rules let the draft through.
      await expect(
        service.publish(teacher, 'assignment', { enrollmentIds: ['student'] }),
      ).rejects.toMatchObject({ code: 'INVALID_RECIPIENTS' });
    });

    it('does not ask for CLOs when the program has no approved set', async () => {
      draft('HOMEWORK');
      countSets.mockResolvedValue(0);
      await expect(
        service.publish(teacher, 'assignment', { enrollmentIds: ['student'] }),
      ).rejects.toMatchObject({ code: 'INVALID_RECIPIENTS' });
      expect(countLinks).not.toHaveBeenCalled();
    });
  });

  describe('outcomes in responses', () => {
    it('uses the assignment links only, sorted by code, without extra fields', () => {
      const links = [
        { outcome: { ...clo('b', 'CLO-10'), statement: 'x' } },
        { outcome: clo('a', 'CLO-2') },
      ];
      expect(assignmentOutcomes(links as never)).toEqual([clo('a', 'CLO-2'), clo('b', 'CLO-10')]);
      // No fallback to question CLOs: what is shown is what publish counts.
      expect(assignmentOutcomes([])).toEqual([]);
    });

    it('lists outcomes on each assignment without the raw links', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'assignment',
          status: 'PUBLISHED',
          dueAt: new Date(definition.dueAt),
          maxAttempts: 1,
          answersPublishedAt: null,
          questions: [{ kind: 'MULTIPLE_CHOICE', maxScore: 1 }],
          outcomeLinks: [{ outcome: clo('clo-1', 'CLO-1') }],
          recipients: [],
        },
      ]);
      const listService = new AssessmentService(
        {
          db: { assignment: { findMany, count: jest.fn().mockResolvedValue(1) } },
        } as unknown as AcademicRepository,
        {} as AcademicAccessService,
        {} as NotificationEventsService,
      );
      const result = (await listService.list(teacher, { page: 1, limit: 20 })) as Record<
        string,
        unknown
      >[];
      expect(result[0].outcomes).toEqual([clo('clo-1', 'CLO-1')]);
      expect(result[0]).not.toHaveProperty('outcomeLinks');
      const select = (findMany.mock.calls[0] as [{ select: Record<string, unknown> }])[0].select;
      expect(select.outcomeLinks).toEqual({
        select: { outcome: { select: { id: true, code: true, title: true, required: true } } },
      });
    });

    it('gives a parent the outcomes but no answer key, rubric or criteria', async () => {
      const row = {
        id: 'assignment',
        kind: 'HOMEWORK',
        classId: 'class',
        status: 'PUBLISHED',
        dueAt: new Date(definition.dueAt),
        maxAttempts: 1,
        answersPublishedAt: null,
        outcomeSetId: 'set',
        outcomeSet: null,
        files: [],
        outcomeLinks: [{ outcome: { ...clo('clo-1', 'CLO-1'), statement: 'secret' } }],
        questions: [
          {
            id: 'q0',
            ...question,
            rubric: 'secret',
            criteria: [{ name: 'x' }],
            outcomeId: 'clo-1',
          },
        ],
        recipients: [
          {
            id: 'r',
            enrollmentId: 'e',
            assignedAt: null,
            dueAtOverride: null,
            enrollment: { status: 'ACTIVE', startDate: null, endDate: null },
            _count: { submissions: 0 },
          },
        ],
      };
      const detailService = new AssessmentService(
        {
          db: { assignment: { findUniqueOrThrow: jest.fn().mockResolvedValue(row) } },
        } as unknown as AcademicRepository,
        {} as AcademicAccessService,
        {} as NotificationEventsService,
      );
      const result = (await detailService.detail(parent, 'assignment')) as {
        outcomes: unknown;
        questions: Record<string, unknown>[];
      };
      expect(result.outcomes).toEqual([clo('clo-1', 'CLO-1')]);
      expect(result.questions[0]).not.toHaveProperty('correctAnswer');
      expect(result.questions[0]).not.toHaveProperty('rubric');
      expect(result.questions[0]).not.toHaveProperty('criteria');
      expect(result.questions[0]).not.toHaveProperty('outcome');
      expect(JSON.stringify(result.outcomes)).not.toContain('secret');
    });
  });
});
