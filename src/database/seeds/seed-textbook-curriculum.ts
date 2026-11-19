import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  draftPeriod,
  lockCurriculumProgram,
} from '../../modules/curriculum-scheduling/curriculum-lifecycle';
import {
  CURRICULUM_EDITION,
  SUBJECTS,
  TOPICS,
  TEXTBOOK_SOURCES,
  lessonContent,
  topicSourceLocator,
} from './curriculum-content';
import { referenceDate } from './seed-calendar';

export interface TextbookSeedConfiguration {
  databaseUrl: string;
  designerEmail?: string;
  date: Date;
}

export function readTextbookSeedConfiguration(env: NodeJS.ProcessEnv): TextbookSeedConfiguration {
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error(
      'Textbook seeding is only permitted with NODE_ENV=development or NODE_ENV=test.',
    );
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL must identify a MySQL database.');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    url.protocol !== 'mysql:' ||
    !url.hostname ||
    !name ||
    name.includes('/') ||
    ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(name.toLowerCase())
  ) {
    throw new Error('DATABASE_URL must identify an application MySQL database.');
  }
  const designerEmail = env.CURRICULUM_SEED_DESIGNER_EMAIL?.trim().toLowerCase() || undefined;
  if (designerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(designerEmail)) {
    throw new Error('CURRICULUM_SEED_DESIGNER_EMAIL must be a valid email.');
  }
  return {
    databaseUrl: url.toString(),
    designerEmail,
    date: referenceDate(env.SEED_REFERENCE_DATE?.trim() || undefined),
  };
}

export function textbookSeedId(programId: string, suffix: string): string {
  const digest = createHash('sha256')
    .update(`${CURRICULUM_EDITION}:${programId}`)
    .digest('hex')
    .slice(0, 24);
  return `seed_ctst_${digest}_${suffix}`;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function textbookProgramKey(program: {
  grade: number;
  subject: string;
  subjectRecord?: { code: string; name: string } | null;
}): string | undefined {
  if (![6, 7, 8, 9].includes(program.grade)) return undefined;
  const catalogSubject = SUBJECTS.find(
    (item) => item.code === program.subjectRecord?.code.toUpperCase(),
  );
  if (catalogSubject) return `${catalogSubject.key}-${program.grade}`;
  const names = [program.subject, program.subjectRecord?.name ?? ''].map(normalize);
  const subject = SUBJECTS.find(
    (item) =>
      program.subjectRecord?.code.toUpperCase() === item.code ||
      names.includes(normalize(item.name)) ||
      (item.key === 'physics' && names.includes('vat li')),
  );
  return subject ? `${subject.key}-${program.grade}` : undefined;
}

export interface TextbookSeedPlan {
  programId: string;
  programName: string;
  key: string;
  designerId: string;
  unitId: string;
  outcomeSetId: string;
  lessons: number;
  exists: boolean;
}

/** Read-only preflight: no account, catalog, schedule or curriculum is changed. */
export async function planTextbookCurricula(
  prisma: PrismaClient,
  designerEmail?: string,
): Promise<TextbookSeedPlan[]> {
  const [programs, designers] = await Promise.all([
    prisma.program.findMany({
      where: { isActive: true, deletedAt: null, grade: { in: [6, 7, 8, 9] } },
      include: { subjectRecord: true },
      orderBy: { id: 'asc' },
    }),
    prisma.user.findMany({
      where: { role: 'CURRICULUM_DESIGNER', status: 'ACTIVE', deletedAt: null },
      select: { id: true, email: true },
    }),
  ]);
  const selectedDesigner = designerEmail
    ? designers.find((user) => user.email.toLowerCase() === designerEmail.toLowerCase())
    : undefined;
  if (designerEmail && !selectedDesigner)
    throw new Error('The selected curriculum designer is missing or inactive.');
  const plans: TextbookSeedPlan[] = [];
  for (const program of programs) {
    const key = textbookProgramKey(program);
    if (
      !key ||
      (program.subjectRecord &&
        (!program.subjectRecord.isActive || program.subjectRecord.deletedAt))
    )
      continue;
    const unitId = textbookSeedId(program.id, 'unit');
    const [unit, prior] = await Promise.all([
      prisma.curriculumUnit.findUnique({
        where: { id: unitId },
        select: { id: true, designerId: true },
      }),
      prisma.curriculumUnit.findFirst({
        where: { programId: program.id, designerId: { in: designers.map((user) => user.id) } },
        orderBy: { version: 'desc' },
        select: { designerId: true },
      }),
    ]);
    const designerId =
      unit?.designerId ??
      selectedDesigner?.id ??
      prior?.designerId ??
      (designers.length === 1 ? designers[0].id : undefined);
    if (!designerId)
      throw new Error(
        `Select CURRICULUM_SEED_DESIGNER_EMAIL for program ${program.name}; there is no unambiguous existing designer.`,
      );
    plans.push({
      programId: program.id,
      programName: program.name,
      key,
      designerId,
      unitId,
      outcomeSetId: textbookSeedId(program.id, 'outcome_set'),
      lessons: TOPICS[key].length,
      exists: !!unit,
    });
  }
  const missing = Object.keys(TOPICS).filter((key) => !plans.some((plan) => plan.key === key));
  if (missing.length)
    throw new Error(
      `Missing active programs for: ${missing.join(', ')}. Configure the program catalog before applying textbook curricula.`,
    );
  return plans;
}

/** Add separate drafts atomically. Re-runs preserve edited/approved units and every historical record. */
export async function seedTextbookCurricula(
  prisma: PrismaClient,
  config: Pick<TextbookSeedConfiguration, 'designerEmail' | 'date'>,
): Promise<{ created: number; preserved: number; lessons: number }> {
  const plans = await planTextbookCurricula(prisma, config.designerEmail);
  return prisma.$transaction(
    async (tx) => {
      let created = 0;
      let preserved = 0;
      let lessons = 0;
      for (const plan of plans) {
        await lockCurriculumProgram(tx, plan.programId);
        if (
          await tx.curriculumUnit.findUnique({ where: { id: plan.unitId }, select: { id: true } })
        ) {
          preserved++;
          continue;
        }
        const program = await tx.program.findUniqueOrThrow({
          where: { id: plan.programId },
          include: { subjectRecord: true },
        });
        if (
          !program.isActive ||
          program.deletedAt ||
          textbookProgramKey(program) !== plan.key ||
          (program.subjectRecord &&
            (!program.subjectRecord.isActive || program.subjectRecord.deletedAt))
        )
          throw new Error(`Program ${plan.programName} is no longer active.`);
        const designer = await tx.user.findUniqueOrThrow({ where: { id: plan.designerId } });
        if (
          designer.role !== 'CURRICULUM_DESIGNER' ||
          designer.status !== 'ACTIVE' ||
          designer.deletedAt
        )
          throw new Error('The curriculum designer is no longer active.');
        const subject = SUBJECTS.find((item) => plan.key.startsWith(`${item.key}-`))!;
        const track = await tx.curriculumTrack.upsert({
          where: {
            grade_subjectKey: { grade: program.grade, subjectKey: normalize(subject.name) },
          },
          update: {},
          create: {
            grade: program.grade,
            subjectKey: normalize(subject.name),
            subject: subject.name,
          },
        });
        const [lastUnit, lastSet] = await Promise.all([
          tx.curriculumUnit.aggregate({
            where: { programId: program.id },
            _max: { version: true },
          }),
          tx.outcomeSet.aggregate({
            where: { programId: program.id, level: `Lớp ${program.grade} - Chân trời sáng tạo` },
            _max: { version: true },
          }),
        ]);
        await tx.curriculumUnit.create({
          data: {
            id: plan.unitId,
            programId: program.id,
            trackId: track.id,
            designerId: plan.designerId,
            version: (lastUnit._max.version ?? 0) + 1,
            title: `${subject.name} ${program.grade} - Chân trời sáng tạo - Giáo trình cả năm`,
            ...draftPeriod(config.date),
            status: 'DRAFT',
          },
        });
        await tx.outcomeSet.create({
          data: {
            id: plan.outcomeSetId,
            programId: program.id,
            designerId: plan.designerId,
            level: `Lớp ${program.grade} - Chân trời sáng tạo`,
            version: (lastSet._max.version ?? 0) + 1,
            status: 'DRAFT',
          },
        });
        const topics = TOPICS[plan.key];
        await tx.lesson.createMany({
          data: topics.map((topic, index) => ({
            id: textbookSeedId(program.id, `lesson_${topic.id}`),
            programId: program.id,
            unitId: plan.unitId,
            designerId: plan.designerId,
            sequence: index + 1,
            kind: 'LESSON',
            status: 'DRAFT',
            title: topic.title,
            content: lessonContent(topic),
          })),
        });
        await tx.learningOutcome.createMany({
          data: topics.map((topic, index) => ({
            id: textbookSeedId(program.id, `outcome_${topic.id}`),
            outcomeSetId: plan.outcomeSetId,
            code: `${subject.code}-${program.grade}-${String(index + 1).padStart(3, '0')}`,
            title: topic.title,
            statement: topic.summary,
            sourceTitle: TEXTBOOK_SOURCES[topic.bookId].title,
            sourceUrl: TEXTBOOK_SOURCES[topic.bookId].url,
            sourceLocator: topicSourceLocator(topic),
            sourceStatus: 'CANDIDATE',
            sourceNote:
              'Đã đối chiếu tên bài và trang sách Chân trời sáng tạo. Mục tiêu và bài tập do trung tâm diễn đạt; chờ giáo viên xác minh chuyên môn, không tự ghi nhận đã duyệt.',
          })),
        });
        await tx.lessonOutcome.createMany({
          data: topics.map((topic) => ({
            lessonId: textbookSeedId(program.id, `lesson_${topic.id}`),
            outcomeId: textbookSeedId(program.id, `outcome_${topic.id}`),
          })),
        });
        await tx.auditLog.create({
          data: {
            id: textbookSeedId(program.id, 'manifest'),
            actorUserId: plan.designerId,
            action: 'TEXTBOOK_CURRICULUM_SEEDED',
            entityType: 'CurriculumUnit',
            entityId: plan.unitId,
            afterData: {
              edition: CURRICULUM_EDITION,
              programKey: plan.key,
              lessonCount: topics.length,
              outcomeSetId: plan.outcomeSetId,
              status: 'DRAFT',
            },
          },
        });
        created++;
        lessons += topics.length;
      }
      return { created, preserved, lessons };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10000,
      timeout: 120000,
    },
  );
}
