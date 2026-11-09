import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { AcademicAccessService } from '../../src/modules/academic/academic-access.service';
import { AssignmentDto } from '../../src/modules/academic/academic.dto';
import { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { AssessmentService } from '../../src/modules/academic/assessment.service';

const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
const definition: AssignmentDto = {
  classId: 'class',
  title: 'Test',
  instructions: '',
  dueAt: '2099-10-01T12:00:00Z',
  maxAttempts: 1,
  questions: [
    { kind: 'MULTIPLE_CHOICE', prompt: 'Q?', choices: ['A', 'B'], correctAnswer: 'A', maxScore: 1 },
  ],
};

describe('assignment session and type rules', () => {
  const classroom = jest.fn<Promise<void>, [AuthenticatedUser, string]>();
  const findSession = jest.fn();
  const create = jest.fn();
  const findAssignment = jest.fn();
  const findEnrollments = jest.fn();
  const findClass = jest.fn();
  const findSet = jest.fn();
  const countSets = jest.fn();
  let service: AssessmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    classroom.mockResolvedValue(undefined);
    findSession.mockResolvedValue({
      id: 'session',
      classId: 'class',
      teacherId: 'teacher',
      status: 'SCHEDULED',
      endsAt: new Date('2099-10-01'),
    });
    create.mockResolvedValue({ id: 'assignment' });
    findClass.mockResolvedValue({ id: 'class', programId: 'program' });
    findSet.mockResolvedValue({
      id: 'set',
      programId: 'program',
      status: 'APPROVED',
      outcomes: [{ id: 'clo-1' }, { id: 'clo-2' }],
    });
    countSets.mockResolvedValue(1);
    findEnrollments.mockResolvedValue([]);
    const tx = {
      assignment: { create, findUniqueOrThrow: findAssignment },
      classSession: { findUnique: findSession },
      enrollment: { findMany: findEnrollments },
      class: { findUniqueOrThrow: findClass },
      outcomeSet: { findUnique: findSet, count: countSets },
    };
    service = new AssessmentService(
      {
        db: tx,
        transaction: (work: (db: unknown) => Promise<unknown>): Promise<unknown> => work(tx),
      } as unknown as AcademicRepository,
      { classroom } as unknown as AcademicAccessService,
      {
        curriculum: jest.fn(),
        schedule: jest.fn(),
        assignment: jest.fn(),
      } as unknown as NotificationEventsService,
    );
  });

  it('retains backward compatible homework defaults', async () => {
    await service.create(teacher, definition);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'HOMEWORK',
          sessionId: null,
          testType: null,
        }) as unknown,
      }),
    );
    expect(findSession).not.toHaveBeenCalled();
  });

  it('creates teacher tests only with a chosen session and named test type', async () => {
    await service.create(teacher, {
      ...definition,
      kind: 'TEST',
      sessionId: 'session',
      testType: 'MIDTERM',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'TEST',
          sessionId: 'session',
          testType: 'MIDTERM',
        }) as unknown,
      }),
    );
    await expect(service.create(teacher, { ...definition, kind: 'TEST' })).rejects.toMatchObject({
      code: 'INVALID_ASSESSMENT_TYPE',
    });
    await expect(
      service.create(teacher, { ...definition, testType: 'MIDTERM' }),
    ).rejects.toMatchObject({ code: 'INVALID_ASSESSMENT_TYPE' });
  });

  it.each([
    [{ classId: 'other' }, 'INVALID_ASSESSMENT_SESSION'],
    [{ teacherId: 'other' }, 'FORBIDDEN'],
    [{ status: 'CANCELLED' }, 'INVALID_ASSESSMENT_SESSION'],
    [{ status: 'COMPLETED' }, 'INVALID_ASSESSMENT_SESSION'],
    [{ endsAt: new Date('2000-01-01') }, 'INVALID_ASSESSMENT_SESSION'],
  ])('rejects unavailable session %j', async (override, code) => {
    findSession.mockResolvedValue({
      id: 'session',
      classId: 'class',
      teacherId: 'teacher',
      status: 'SCHEDULED',
      endsAt: new Date('2099-10-01'),
      ...override,
    });
    await expect(
      service.create(teacher, {
        ...definition,
        kind: 'TEST',
        sessionId: 'session',
        testType: 'ONE_PERIOD',
      }),
    ).rejects.toMatchObject({ code });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not query session/write assignment for an unauthorized classroom', async () => {
    classroom.mockRejectedValue(new AppError('FORBIDDEN', 'Other class'));
    await expect(
      service.create(teacher, {
        ...definition,
        kind: 'TEST',
        sessionId: 'session',
        testType: 'FINAL',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(findSession).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rechecks the scheduled session when publishing a test draft', async () => {
    findAssignment.mockResolvedValue({
      id: 'assignment',
      ...definition,
      dueAt: new Date(definition.dueAt),
      status: 'DRAFT',
      kind: 'TEST',
      sessionId: 'session',
      testType: 'FINAL',
    });
    findSession.mockResolvedValue({
      id: 'session',
      classId: 'class',
      teacherId: 'teacher',
      status: 'CANCELLED',
      endsAt: new Date('2099-10-01'),
    });
    await expect(
      service.publish(teacher, 'assignment', { enrollmentIds: ['student'] }),
    ).rejects.toMatchObject({ code: 'INVALID_ASSESSMENT_SESSION' });
    expect(findEnrollments).not.toHaveBeenCalled();
  });

  describe('light CLOs (B3, Q2)', () => {
    const two = [
      { ...definition.questions[0], outcomeId: 'clo-1' },
      { ...definition.questions[0], prompt: 'Q2?' },
    ];

    it('creates an assignment without a CLO set even when the program has an approved set', async () => {
      await service.create(teacher, definition);
      expect(create).toHaveBeenCalled();
      expect(findSet).not.toHaveBeenCalled();
    });

    it('accepts a chosen set with only some questions mapped', async () => {
      await service.create(teacher, { ...definition, outcomeSetId: 'set', questions: two });
      expect(create).toHaveBeenCalled();
    });

    it('refuses a mapped CLO outside the chosen set and says why in details', async () => {
      await expect(
        service.create(teacher, {
          ...definition,
          outcomeSetId: 'set',
          questions: [two[1], { ...definition.questions[0], outcomeId: 'clo-other' }],
        }),
      ).rejects.toMatchObject({
        code: 'OUTCOME_MAPPING_INCOMPLETE',
        statusCode: 409,
        details: { reason: 'WRONG_SET', questionIndexes: [1], outcomeIds: ['clo-other'] },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('keeps refusing a set of another program or not approved, and CLOs without a set', async () => {
      findSet.mockResolvedValue({ id: 'set', programId: 'other', status: 'APPROVED', outcomes: [] });
      await expect(
        service.create(teacher, { ...definition, outcomeSetId: 'set' }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET' });
      findSet.mockResolvedValue({ id: 'set', programId: 'program', status: 'DRAFT', outcomes: [] });
      await expect(
        service.create(teacher, { ...definition, outcomeSetId: 'set' }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET' });
      await expect(service.create(teacher, { ...definition, questions: two })).rejects.toMatchObject({
        code: 'OUTCOME_SET_REQUIRED',
      });
    });

    it('publishes a draft without a CLO set or with unmapped questions', async () => {
      findAssignment.mockResolvedValue({
        id: 'assignment',
        ...definition,
        dueAt: new Date(definition.dueAt),
        status: 'DRAFT',
        outcomeSetId: null,
      });
      // Reaching the recipients check means the CLO rules let the draft through.
      await expect(
        service.publish(teacher, 'assignment', { enrollmentIds: ['student'] }),
      ).rejects.toMatchObject({ code: 'INVALID_RECIPIENTS' });
      expect(findSet).not.toHaveBeenCalled();
    });

    it('still refuses to publish with a set that is no longer approved', async () => {
      findAssignment.mockResolvedValue({
        id: 'assignment',
        ...definition,
        dueAt: new Date(definition.dueAt),
        status: 'DRAFT',
        outcomeSetId: 'set',
      });
      findSet.mockResolvedValue({ id: 'set', programId: 'program', status: 'ARCHIVED' });
      await expect(
        service.publish(teacher, 'assignment', { enrollmentIds: ['student'] }),
      ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_SET' });
      expect(findEnrollments).not.toHaveBeenCalled();
    });
  });
});
