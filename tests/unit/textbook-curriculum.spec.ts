import {
  CURRICULUM_EDITION,
  SUBJECTS,
  TOPICS,
  TEXTBOOK_SOURCES,
  lessonContent,
  topicSourceLocator,
} from '../../src/database/seeds/curriculum-content';
import {
  readTextbookSeedConfiguration,
  planTextbookCurricula,
  seedTextbookCurricula,
  textbookProgramKey,
  textbookSeedId,
} from '../../src/database/seeds/seed-textbook-curriculum';
import { seedDemo } from '../../src/database/seeds/seed-demo';
import type { PrismaClient } from '@prisma/client';

describe('Chân trời sáng tạo curriculum coverage', () => {
  const all = Object.values(TOPICS).flat();
  it('covers the 16 subject/grade combinations and the checked textbook inventories', () => {
    expect(
      Object.fromEntries(Object.entries(TOPICS).map(([key, topics]) => [key, topics.length])),
    ).toEqual({
      'math-6': 66,
      'math-7': 54,
      'math-8': 47,
      'math-9': 44,
      'physics-6': 18,
      'physics-7': 15,
      'physics-8': 18,
      'physics-9': 20,
      'chemistry-6': 12,
      'chemistry-7': 7,
      'chemistry-8': 16,
      'chemistry-9': 25,
      'biology-6': 21,
      'biology-7': 19,
      'biology-8': 26,
      'biology-9': 17,
    });
    expect(all).toHaveLength(425);
    expect(new Set(all.map((topic) => topic.id)).size).toBe(413);
    expect(Object.keys(TEXTBOOK_SOURCES)).toHaveLength(12);
    for (const grade of [6, 7, 8, 9]) {
      for (const subject of SUBJECTS)
        expect(TOPICS[`${subject.key}-${grade}`].length).toBeGreaterThan(4);
    }
  });

  it.each([
    [6, 45],
    [7, 39],
    [8, 51],
    [9, 48],
  ])('includes every numbered science lesson for grade %i', (grade, count) => {
    const numbers = new Set(
      all
        .filter((topic) => topic.bookId === `science${grade}` && topic.kind === 'lesson')
        .map((topic) => Number(topic.item.slice(4))),
    );
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: count }, (_, index) => index + 1),
    );
  });

  it('places the changed grade-specific topics correctly', () => {
    expect(
      TOPICS['biology-8'].some(
        (topic) => topic.item === 'Bài 48' && topic.title.includes('Hệ sinh thái'),
      ),
    ).toBe(true);
    expect(TOPICS['biology-9'].some((topic) => topic.title.includes('Cơ chế tiến hoá'))).toBe(true);
    expect(TOPICS['biology-9'].some((topic) => topic.title.includes('Hệ sinh thái'))).toBe(false);
    expect(
      TOPICS['physics-8'].some((topic) => topic.title.includes('Moment lực') && topic.page === 87),
    ).toBe(true);
    expect(
      TOPICS['physics-9'].some(
        (topic) => topic.title.includes('Công và công suất') && topic.page === 14,
      ),
    ).toBe(true);
    expect(TOPICS['physics-8'].some((topic) => topic.title.includes('Công và công suất'))).toBe(
      false,
    );
    expect(
      TOPICS['math-9'].some((topic) => topic.title.includes('Biểu diễn dữ liệu ghép nhóm')),
    ).toBe(true);
  });

  it('uses the released science 8 pagination and titles rather than its trial print', () => {
    expect(TOPICS['physics-8'].find((topic) => topic.item === 'Bài 15')?.page).toBe(72);
    expect(TOPICS['biology-8'].find((topic) => topic.item === 'Bài 34')?.title).toContain(
      'Máu và miễn dịch',
    );
    expect(TOPICS['biology-8'].find((topic) => topic.item === 'Bài 35')?.title).toContain(
      'Hệ tuần hoàn',
    );
    expect(TOPICS['biology-8'].find((topic) => topic.item === 'Bài 44')?.title).toContain(
      'Sinh sản ở người',
    );
  });

  it('gives each lesson a distinct identifier, printed locator, objective and worked exercise', () => {
    for (const [key, topics] of Object.entries(TOPICS)) {
      expect(new Set(topics.map((topic) => topic.id)).size).toBe(topics.length);
      expect(new Set(topics.map((topic) => topic.title)).size).toBe(topics.length);
      for (const topic of topics) {
        expect(topic.bookId).toContain(key.split('-')[1]);
        expect(topic.title.length).toBeLessThanOrEqual(255);
        expect(topicSourceLocator(topic).length).toBeLessThanOrEqual(255);
        expect(topic.page).toBeGreaterThan(0);
        expect(topic.summary.length).toBeGreaterThan(15);
        expect(topic.exercise.length).toBeGreaterThan(10);
        expect(topic.answer.length).toBeGreaterThan(1);
        const source = TEXTBOOK_SOURCES[topic.bookId];
        expect(source.url).toMatch(/^https:\/\/taphuan\.olm\.vn\/tap-huan\/doc-sach\//);
        const content = lessonContent(topic);
        expect(content).toContain(source.title);
        expect(content).toContain(`trang in ${topic.page}`);
        expect(content).toContain(topic.exercise);
        expect(content).toContain(topic.answer);
        expect(content).not.toContain('CHƯA ĐIỀN');
      }
    }
  });

  it('keeps the gas conditions explicit for the current molar-volume convention', () => {
    const topic = TOPICS['chemistry-8'].find((item) => item.item === 'Bài 5')!;
    expect(topic.exercise).toContain('25 °C và 1 bar');
    expect(topic.answer).toContain('24,79');
    expect(topic.answer).toContain('4,958 L');
  });
});

describe('Additive textbook seed safeguards', () => {
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: 'mysql://test:password@localhost:3307/edugrade_test',
  };
  it.each(['production', 'staging', undefined])('rejects writes in environment %s', (nodeEnv) => {
    expect(() => readTextbookSeedConfiguration({ ...env, NODE_ENV: nodeEnv })).toThrow(
      'development',
    );
  });
  it.each(['mysql://localhost/mysql', 'postgresql://localhost/db', '', 'mysql://localhost/'])(
    'rejects invalid database target %s',
    (databaseUrl) => {
      expect(() => readTextbookSeedConfiguration({ ...env, DATABASE_URL: databaseUrl })).toThrow(
        'DATABASE_URL',
      );
    },
  );
  it('validates dates and optional designer selection before mutation', () => {
    expect(readTextbookSeedConfiguration(env).databaseUrl).toBe(env.DATABASE_URL);
    expect(() =>
      readTextbookSeedConfiguration({ ...env, SEED_REFERENCE_DATE: '2026-02-30' }),
    ).toThrow('valid YYYY-MM-DD');
    expect(() =>
      readTextbookSeedConfiguration({ ...env, CURRICULUM_SEED_DESIGNER_EMAIL: 'invalid' }),
    ).toThrow('valid email');
  });
  it('matches the project subject names and physics spelling without selecting unrelated grades', () => {
    expect(textbookProgramKey({ grade: 8, subject: 'Vật lí' })).toBe('physics-8');
    expect(textbookProgramKey({ grade: 6, subject: 'Hóa học' })).toBe('chemistry-6');
    expect(textbookProgramKey({ grade: 10, subject: 'Toán' })).toBeUndefined();
    expect(textbookProgramKey({ grade: 8, subject: 'Tiếng Anh' })).toBeUndefined();
  });
  it('makes stable, program-specific IDs that fit the database fields', () => {
    const id = textbookSeedId('program-math-6', 'lesson_math6v1-c1-1');
    expect(textbookSeedId('program-math-6', 'lesson_math6v1-c1-1')).toBe(id);
    expect(textbookSeedId('program-math-7', 'lesson_math6v1-c1-1')).not.toBe(id);
    expect(id.length).toBeLessThan(191);
  });
  it('preflights complete coverage, creates sourced drafts once and preserves manual edits on rerun', async () => {
    const programs = SUBJECTS.flatMap((subject) =>
      [6, 7, 8, 9].map((grade) => ({
        id: `program-${subject.key}-${grade}`,
        name: `${subject.name} ${grade}`,
        grade,
        subject: subject.name,
        isActive: true,
        deletedAt: null,
        subjectRecord: { code: subject.code, name: subject.name, isActive: true, deletedAt: null },
      })),
    );
    const units = new Map<string, { id: string; designerId: string }>();
    const lessons: Array<{ id: string; content: string; status: string }> = [];
    const outcomes: Array<{
      id: string;
      sourceStatus: string;
      sourceUrl: string;
      verifiedAt?: Date;
    }> = [];
    const links: Array<{ lessonId: string; outcomeId: string }> = [];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      program: {
        findMany: jest.fn().mockResolvedValue(programs),
        findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(programs.find((program) => program.id === where.id)),
        ),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'designer', email: 'designer@test.local' }]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'designer',
          role: 'CURRICULUM_DESIGNER',
          status: 'ACTIVE',
          deletedAt: null,
        }),
      },
      curriculumTrack: { upsert: jest.fn().mockResolvedValue({ id: 'track' }) },
      curriculumUnit: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(units.get(where.id) ?? null),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: 12 } }),
        create: jest.fn(
          ({
            data,
          }: {
            data: { id: string; designerId: string; status: string; version: number };
          }) => {
            expect(data.status).toBe('DRAFT');
            expect(data.version).toBe(13);
            units.set(data.id, data);
            return Promise.resolve(data);
          },
        ),
      },
      outcomeSet: {
        aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
        create: jest.fn(),
      },
      lesson: {
        createMany: jest.fn(({ data }: { data: typeof lessons }) => {
          lessons.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      learningOutcome: {
        createMany: jest.fn(({ data }: { data: typeof outcomes }) => {
          outcomes.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      lessonOutcome: {
        createMany: jest.fn(({ data }: { data: typeof links }) => {
          links.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const prismaMock = {
      ...tx,
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const prisma = prismaMock as unknown as PrismaClient;
    const missing = programs.pop()!;
    await expect(seedTextbookCurricula(prisma, { date: new Date('2026-11-19') })).rejects.toThrow(
      'Missing active programs',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(units.size).toBe(0);
    programs.push(missing);
    expect(await planTextbookCurricula(prisma)).toHaveLength(16);
    expect(units.size).toBe(0);
    expect(await seedTextbookCurricula(prisma, { date: new Date('2026-11-19') })).toEqual({
      created: 16,
      preserved: 0,
      lessons: 425,
    });
    expect(lessons).toHaveLength(425);
    expect(outcomes).toHaveLength(425);
    expect(links).toHaveLength(425);
    expect(lessons.every((lesson) => lesson.status === 'DRAFT')).toBe(true);
    expect(
      outcomes.every((outcome) => outcome.sourceStatus === 'CANDIDATE' && !outcome.verifiedAt),
    ).toBe(true);
    const lessonIds = new Set(lessons.map((lesson) => lesson.id));
    const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
    expect(
      links.every((link) => lessonIds.has(link.lessonId) && outcomeIds.has(link.outcomeId)),
    ).toBe(true);
    lessons[0].content = 'Nội dung đã được giáo viên sửa.';
    expect(await seedTextbookCurricula(prisma, { date: new Date('2026-12-01') })).toEqual({
      created: 0,
      preserved: 16,
      lessons: 0,
    });
    expect(lessons).toHaveLength(425);
    expect(lessons[0].content).toBe('Nội dung đã được giáo viên sửa.');
    expect(tx.curriculumUnit.create).toHaveBeenCalledTimes(16);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(16);
  });
  it('rejects a legacy demo before changing any account or historical lesson', async () => {
    const tx = {
      auditLog: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ afterData: { version: 1, referenceDate: '2026-11-19' } }),
      },
      user: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    await expect(seedDemo(prisma, 'unused')).rejects.toThrow('db:seed:curriculum --apply');
    expect(tx.user.upsert).not.toHaveBeenCalled();
    expect(CURRICULUM_EDITION).toBe('ctst-2026-11-19');
  });
});
