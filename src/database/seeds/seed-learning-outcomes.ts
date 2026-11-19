import type { Prisma } from '@prisma/client';
import { SUBJECTS, TOPICS, TEXTBOOK_SOURCES, topicSourceLocator } from './curriculum-content';
import type { SeedCatalog, DemoClass } from './seed-catalog';
import type { SeedUsers } from './seed-accounts';
import { demoId } from './seed-calendar';

/** Sourced objectives remain drafts until a teacher verifies their pedagogical wording. */
export async function seedLearningOutcomes(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
): Promise<void> {
  for (const subject of SUBJECTS) {
    for (const grade of [6, 7, 8, 9]) {
      const key = `${subject.key}-${grade}`;
      const classroom: DemoClass = catalog.classes[`${key}-a`];
      const set = await tx.outcomeSet.upsert({
        where: { id: demoId(`outcome_set_${key}_v1`) },
        update: {},
        create: {
          id: demoId(`outcome_set_${key}_v1`),
          programId: classroom.programId,
          level: `Lớp ${grade} - cơ bản`,
          version: 1,
          status: 'DRAFT',
          designerId: users[subject.designer].id,
        },
      });
      const outcomeByTopic: Array<{ title: string; id: string }> = [];
      for (const [index, topic] of TOPICS[key].entries()) {
        const source = TEXTBOOK_SOURCES[topic.bookId];
        const outcome = await tx.learningOutcome.upsert({
          where: { id: demoId(`outcome_${key}_${index + 1}`) },
          update: {},
          create: {
            id: demoId(`outcome_${key}_${index + 1}`),
            outcomeSetId: set.id,
            code: `${subject.code}-${grade}-${String(index + 1).padStart(2, '0')}`,
            title: topic.title,
            statement: topic.summary,
            sourceTitle: source.title,
            sourceUrl: source.url,
            sourceLocator: topicSourceLocator(topic),
            sourceStatus: 'CANDIDATE',
            sourceNote:
              'Tên bài và trang đã đối chiếu sách Chân trời sáng tạo. Mục tiêu do trung tâm diễn đạt; cần giáo viên xác minh và duyệt, không phải câu trích nguyên văn từ chương trình của Bộ.',
          },
        });
        outcomeByTopic.push({ title: topic.title, id: outcome.id });
        for (const lesson of catalog.lessons[key].filter((item) =>
          item.title.startsWith(topic.title),
        )) {
          await tx.lessonOutcome.upsert({
            where: { lessonId_outcomeId: { lessonId: lesson.id, outcomeId: outcome.id } },
            update: {},
            create: { lessonId: lesson.id, outcomeId: outcome.id },
          });
        }
      }
      // Proposal lessons need an outcome link too, just like the full approved demo edition.
      if (key === 'math-8' || key === 'physics-8')
        for (const version of [3, 4])
          await tx.lessonOutcome.upsert({
            where: {
              lessonId_outcomeId: {
                lessonId: demoId(`lesson_${key}_v${version}`),
                outcomeId: outcomeByTopic[0].id,
              },
            },
            update: {},
            create: {
              lessonId: demoId(`lesson_${key}_v${version}`),
              outcomeId: outcomeByTopic[0].id,
            },
          });
    }
  }
}
