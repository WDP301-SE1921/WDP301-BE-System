import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { OutcomeService } from '../../src/modules/academic/outcome.service';
import { seedLearningOutcomes } from '../../src/database/seeds/seed-learning-outcomes';
import { SUBJECTS, TOPICS } from '../../src/database/seeds/curriculum-content';
import type { SeedCatalog } from '../../src/database/seeds/seed-catalog';
import type { SeedUsers } from '../../src/database/seeds/seed-accounts';
import type { Prisma } from '@prisma/client';

describe('CLO source safeguards', () => {
  it('seeds every requested subject and grade as unverified draft', async () => {
    const sets: Array<Record<string, unknown>> = [];
    const outcomes: Array<Record<string, unknown>> = [];
    const tx = {
      outcomeSet: {
        upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => {
          sets.push(create);
          return Promise.resolve({ id: create.id });
        }),
      },
      learningOutcome: {
        upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => {
          outcomes.push(create);
          return Promise.resolve({ id: create.id });
        }),
      },
      lessonOutcome: { upsert: jest.fn() },
    };
    const classes: SeedCatalog['classes'] = {};
    const lessons: SeedCatalog['lessons'] = {};
    for (const subject of SUBJECTS.filter((item) => item.key !== 'physics')) {
      for (const grade of [6, 7, 8, 9]) {
        const key = `${subject.key}-${grade}`;
        classes[`${key}-a`] = { programId: `program-${key}` } as SeedCatalog['classes'][string];
        lessons[key] = [];
      }
    }
    await seedLearningOutcomes(
      tx as unknown as Prisma.TransactionClient,
      { designer: { id: 'designer' }, 'designer-2': { id: 'designer-2' } } as unknown as SeedUsers,
      { classes, lessons } as SeedCatalog,
    );
    expect(sets).toHaveLength(12);
    expect(outcomes).toHaveLength(
      Object.entries(TOPICS)
        .filter(([key]) => /^(math|chemistry|biology)-[6-9]$/.test(key))
        .reduce((total, [, topics]) => total + topics.length, 0),
    );
    expect(outcomes).toHaveLength(48);
    expect(sets.every((item) => item.status === 'DRAFT')).toBe(true);
    expect(outcomes.every((item) => item.sourceStatus === 'CANDIDATE')).toBe(true);
    expect(outcomes.every((item) => String(item.sourceUrl).endsWith('.pdf'))).toBe(true);
  });

  it('rejects technical approval until every source and lesson is verified', async () => {
    const set: {
      id: string;
      programId: string;
      status: string;
      outcomes: Array<{
        sourceStatus: string;
        verifiedById: string | null;
        lessonLinks: Array<{ lessonId: string }>;
      }>;
    } = {
      id: 'set',
      programId: 'program',
      status: 'DRAFT',
      outcomes: [
        { sourceStatus: 'CANDIDATE', verifiedById: null, lessonLinks: [{ lessonId: 'lesson' }] },
      ],
    };
    const update = jest.fn();
    const db = {
      class: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { teacherId: 'teacher', pendingTeacherId: null, pendingTeacherFrom: null },
          ]),
      },
      outcomeSet: { findUnique: jest.fn().mockResolvedValue(set), update },
    };
    const service = new OutcomeService({
      db,
      transaction: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(db),
    } as unknown as AcademicRepository);
    const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
    await expect(service.technicalApprove(teacher, 'set')).rejects.toThrow(
      'Every outcome needs a verified source',
    );
    expect(update).not.toHaveBeenCalled();
    set.outcomes[0].sourceStatus = 'VERIFIED';
    set.outcomes[0].verifiedById = 'teacher';
    set.outcomes[0].lessonLinks = [];
    await expect(service.technicalApprove(teacher, 'set')).rejects.toThrow(
      'Every outcome needs a verified source',
    );
  });
});
