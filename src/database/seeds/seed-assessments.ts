import type { Prisma, Submission } from '@prisma/client';
import type { SeedUsers } from './seed-accounts';
import type { SeedCatalog } from './seed-catalog';
import type { DemoEnrollment } from './seed-enrollments';
import { addDays, demoId, localInstant } from './seed-calendar';

export async function seedAssessments(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
  enrollments: DemoEnrollment[],
  today: Date,
): Promise<void> {
  const classroom = catalog.classes['math-8-a'];
  const definitions = [
    {
      key: 'draft',
      title: 'Đa thức - Bài tập đang soạn',
      status: 'DRAFT' as const,
      due: 7,
      created: -1,
      attempts: 1,
    },
    {
      key: 'open',
      title: 'Hằng đẳng thức - Bài tập đang nhận bài',
      status: 'PUBLISHED' as const,
      due: 2,
      created: -2,
      attempts: 2,
    },
    {
      key: 'closed',
      title: 'Phân tích đa thức - Đã đóng nộp bài',
      status: 'CLOSED' as const,
      due: -3,
      created: -9,
      attempts: 1,
    },
    {
      key: 'answers',
      title: 'Phương trình - Đã công bố đáp án',
      status: 'CLOSED' as const,
      due: -10,
      created: -17,
      attempts: 1,
    },
    {
      key: 'revision',
      title: 'Ôn tập - Có điểm được điều chỉnh',
      status: 'CLOSED' as const,
      due: -15,
      created: -21,
      attempts: 2,
    },
    {
      key: 'no-submissions',
      title: 'Tứ giác - Chưa có bài nộp',
      status: 'PUBLISHED' as const,
      due: 3,
      created: 0,
      attempts: 1,
    },
  ];
  for (const definition of definitions) {
    const assignment = await tx.assignment.upsert({
      where: { id: demoId(`assignment_${definition.key}`) },
      update: {},
      create: {
        id: demoId(`assignment_${definition.key}`),
        classId: classroom.id,
        teacherId: users.teacher.id,
        title: definition.title,
        instructions:
          'Trả lời đủ các câu hỏi. Với câu tự luận, trình bày từng bước và giải thích phép biến đổi.',
        dueAt: localInstant(addDays(today, definition.due), 22),
        maxAttempts: definition.attempts,
        status: definition.status,
        answersPublishedAt:
          definition.key === 'answers' ? localInstant(addDays(today, -9), 9) : null,
        createdAt: localInstant(addDays(today, definition.created), 9),
      },
    });
    const questions = [];
    questions.push(
      await tx.assignmentQuestion.upsert({
        where: { assignmentId_position: { assignmentId: assignment.id, position: 0 } },
        update: {},
        create: {
          id: demoId(`question_${definition.key}_1`),
          assignmentId: assignment.id,
          position: 0,
          kind: 'MULTIPLE_CHOICE',
          prompt: 'Khai triển (x + 2)(x + 3) được biểu thức nào?',
          choices: ['x² + 5x + 6', 'x² + 6', 'x² + x + 6', '2x + 5'],
          correctAnswer: 'x² + 5x + 6',
          maxScore: 4,
        },
      }),
    );
    questions.push(
      await tx.assignmentQuestion.upsert({
        where: { assignmentId_position: { assignmentId: assignment.id, position: 1 } },
        update: {},
        create: {
          id: demoId(`question_${definition.key}_2`),
          assignmentId: assignment.id,
          position: 1,
          kind: 'ESSAY',
          prompt: 'Giải phương trình 3x - 7 = 8 và kiểm tra nghiệm.',
          correctAnswer: 'x = 5; thay vào được 3 × 5 - 7 = 8.',
          rubric:
            'Barem điểm (6 điểm): Bước 1 - Áp dụng quy tắc chuyển vế đổi dấu được 3x = 15 (2.0 điểm); Bước 2 - Chia hai vế cho 3 tìm đúng nghiệm x = 5 và kết luận tập nghiệm (3.0 điểm); Bước 3 - Thay x = 5 vào vế trái 3(5) - 7 = 8 = vế phải để kiểm tra nghiệm (1.0 điểm). Trừ 0.5 điểm nếu thiếu kết luận nghiệm.',
          maxScore: 6,
        },
      }),
    );
    if (definition.status === 'DRAFT') continue;
    for (const [index, enrollmentKey] of ['an-math', 'binh-expiring', 'nga-math'].entries()) {
      const enrollment = enrollments.find((item) => item.key === enrollmentKey)!.enrollment;
      const recipient = await tx.assignmentRecipient.upsert({
        where: {
          assignmentId_enrollmentId: { assignmentId: assignment.id, enrollmentId: enrollment.id },
        },
        update: {},
        create: {
          id: demoId(`recipient_${definition.key}_${enrollmentKey}`),
          assignmentId: assignment.id,
          enrollmentId: enrollment.id,
        },
      });
      if (definition.key === 'no-submissions' || (definition.key === 'open' && index === 1))
        continue;
      const attempts = definition.key === 'open' && index === 0 ? 2 : 1;
      let latest: Submission | undefined;
      for (let attemptNo = 1; attemptNo <= attempts; attemptNo++) {
        latest = await tx.submission.upsert({
          where: { recipientId_attemptNo: { recipientId: recipient.id, attemptNo } },
          update: {},
          create: {
            id: demoId(`submission_${definition.key}_${enrollmentKey}_${attemptNo}`),
            recipientId: recipient.id,
            attemptNo,
            answers: [
              { questionId: questions[0].id, answer: index === 1 ? 'x² + 6' : 'x² + 5x + 6' },
              {
                questionId: questions[1].id,
                answer: '3x = 15 nên x = 5. Kiểm tra: 3 × 5 - 7 = 8.',
              },
            ],
            submittedAt: localInstant(
              addDays(today, definition.status === 'PUBLISHED' ? -1 : definition.due - 1),
              18,
              attemptNo * 5,
            ),
          },
        });
      }
      if (!latest) continue;
      // One open submission is deliberately ungraded; another has a draft awaiting review.
      if (definition.key === 'open' && index === 0) continue;
      const status =
        definition.key === 'open'
          ? 'DRAFT'
          : definition.key === 'closed' && index === 1
            ? 'APPROVED'
            : 'PUBLISHED';
      const scores = [
        { questionId: questions[0].id, score: index === 1 ? 0 : 4 },
        { questionId: questions[1].id, score: 6 - index },
      ];
      const revisions = definition.key === 'revision' ? [1, 2] : [1];
      for (const revision of revisions) {
        const gradeStatus = definition.key === 'revision' && revision === 1 ? 'SUPERSEDED' : status;
        const finalScores = scores.map((score, scoreIndex) => ({
          ...score,
          score:
            revision === 1 && definition.key === 'revision' && scoreIndex === 1
              ? Math.max(0, score.score - 1)
              : score.score,
        }));
        const gradeAt = addDays(latest.submittedAt, revision);
        await tx.gradeReview.upsert({
          where: { submissionId_revision: { submissionId: latest.id, revision } },
          update: {},
          create: {
            id: demoId(`grade_${definition.key}_${enrollmentKey}_${revision}`),
            submissionId: latest.id,
            revision,
            reviewerId: users.teacher.id,
            status: gradeStatus,
            scores: finalScores,
            totalScore: finalScores.reduce((sum, score) => sum + score.score, 0),
            feedback:
              revision === 2
                ? 'Đã xem lại lập luận và điều chỉnh điểm sau trao đổi với phụ huynh.'
                : index === 1
                  ? 'Cần chú ý nhân đủ các hạng tử. Phần phương trình trình bày khá rõ.'
                  : 'Bài làm đúng hướng; tiếp tục trình bày đầy đủ bước kiểm tra nghiệm.',
            publishedAt:
              gradeStatus === 'PUBLISHED' || gradeStatus === 'SUPERSEDED' ? gradeAt : null,
            createdAt: gradeAt,
          },
        });
      }
      if (definition.key === 'open' && index === 2) {
        for (const jobStatus of ['SUCCEEDED', 'FAILED'] as const)
          await tx.gradingJob.upsert({
            where: { id: demoId(`grading_job_${jobStatus}`) },
            update: {},
            create: {
              id: demoId(`grading_job_${jobStatus}`),
              submissionId: latest.id,
              status: jobStatus,
              result:
                jobStatus === 'SUCCEEDED'
                  ? {
                      scores: scores.map((score) => ({
                        ...score,
                        feedback: 'Gợi ý chấm minh họa; giáo viên cần kiểm tra trước khi công bố.',
                      })),
                    }
                  : undefined,
              error:
                jobStatus === 'FAILED'
                  ? 'Lịch sử demo: dịch vụ AI không phản hồi, cần chấm thủ công hoặc thử lại.'
                  : null,
              startedAt: addDays(latest.submittedAt, 1),
              createdAt: latest.submittedAt,
            },
          });
      }
    }
  }
}
