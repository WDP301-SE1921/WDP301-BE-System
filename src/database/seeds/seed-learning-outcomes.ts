import type { Prisma } from '@prisma/client';
import { SUBJECTS, TOPICS } from './curriculum-content';
import type { SeedCatalog, DemoClass } from './seed-catalog';
import type { SeedUsers } from './seed-accounts';
import { demoId } from './seed-calendar';

const MATH_SOURCE =
  'https://admintruong.haiphong.shieldix.app/data/haiphong/thcsandong/2023_6/1/3-cttoan_16202319.pdf';
const SCIENCE_SOURCE =
  'https://filethcs.hcm.shieldix.app/data/hcmedu/thcsphongphu/attachments/2020_7/11ctkhoahoctunhien281220188_87202018.pdf';
const MATH_PAGES: Record<number, string> = {
  6: 'Lớp 6, Nội dung giáo dục, trang in 46–54',
  7: 'Lớp 7, Nội dung giáo dục, trang in 55–62',
  8: 'Lớp 8, Nội dung giáo dục, trang in 63–70',
  9: 'Lớp 9, Nội dung giáo dục, trang in 71–78',
};
const SCIENCE_PAGES: Record<number, string> = {
  6: 'Lớp 6, Nội dung giáo dục, trang in 22–32',
  7: 'Lớp 7, Nội dung giáo dục, trang in 33–42',
  8: 'Lớp 8, Nội dung giáo dục, trang in 43–58',
  9: 'Lớp 9, Nội dung giáo dục, trang in 59–75',
};

/** The textbook topics are demo content. Sources are candidates until a teacher verifies each exact requirement. */
export async function seedLearningOutcomes(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
): Promise<void> {
  for (const subject of SUBJECTS.filter((item) => item.key !== 'physics')) {
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
      for (const [index, topic] of TOPICS[key].entries()) {
        const outcome = await tx.learningOutcome.upsert({
          where: { id: demoId(`outcome_${key}_${index + 1}`) },
          update: {},
          create: {
            id: demoId(`outcome_${key}_${index + 1}`),
            outcomeSetId: set.id,
            code: `${subject.code}-${grade}-${String(index + 1).padStart(2, '0')}`,
            title: topic.title,
            statement: `Sau chủ đề “${topic.title}”, học sinh có thể: ${topic.summary}`,
            sourceTitle:
              subject.key === 'math'
                ? 'Chương trình giáo dục phổ thông môn Toán (Thông tư 32/2018/TT-BGDĐT)'
                : 'Chương trình giáo dục phổ thông môn Khoa học tự nhiên (Thông tư 32/2018/TT-BGDĐT)',
            sourceUrl: subject.key === 'math' ? MATH_SOURCE : SCIENCE_SOURCE,
            sourceLocator: subject.key === 'math' ? MATH_PAGES[grade] : SCIENCE_PAGES[grade],
            sourceStatus: 'CANDIDATE',
            sourceNote:
              'Đề xuất từ chủ đề demo của trung tâm. Chưa đối chiếu tới từng yêu cầu cần đạt và chưa được giáo viên duyệt.',
          },
        });
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
    }
  }
}
