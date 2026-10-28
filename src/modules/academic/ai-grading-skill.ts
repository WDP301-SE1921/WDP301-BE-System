import type { AssignmentKind, QuestionKind, TestType } from '@prisma/client';

export const LESSON_CONTENT_MAX_CHARS = 4000;
export const MAX_PROGRAM_LESSONS_CONTEXT = 5;

export const GRADING_SKILL_INSTRUCTION = [
  'Suggest grades for the student submission using the supplied curriculum lesson context and scoring rubric (barem điểm).',
  'Shape: {"scores":[{"questionId":"id","score":0,"feedback":"reason"}]}.',
  'Rules:',
  '1. Return exactly one score item for every question in questions[], preserving questionId.',
  '2. For MULTIPLE_CHOICE questions: award maxScore if the student answer matches correctAnswer, otherwise award 0.',
  '3. For ESSAY questions: break down the student answer step-by-step against the supplied rubric (barem điểm), correctAnswer, and curriculum lesson content. Sum the partial points strictly according to the rubric so that 0 <= score <= maxScore.',
  '4. Write concise, constructive Vietnamese feedback explaining which rubric criteria were met, which steps were missing or inaccurate according to the curriculum lesson, and why the score was awarded.',
  '5. If submission.hasAttachments is true, grade the text answers and rubric criteria as usual, but append a short note in Vietnamese reminding the teacher: "(Lưu ý: Học sinh có đính kèm file/ảnh bài làm, giáo viên vui lòng kiểm tra thêm tệp đính kèm để cho điểm chính xác nhất)".',
  '6. Do not publish results or invent criteria outside the provided rubric and curriculum.',
].join('\n');

export interface GradingCurriculumLessonInput {
  id: string;
  title: string;
  sequence: number;
  content: string;
}

export interface GradingQuestionInput {
  id: string;
  kind: QuestionKind;
  prompt: string;
  choices?: unknown;
  rubric: string | null;
  correctAnswer: string | null;
  maxScore: number;
  outcome?: {
    code: string;
    title: string;
    statement: string;
  } | null;
}

export interface BuildGradingSkillPayloadInput {
  assignment: {
    id: string;
    title: string;
    instructions: string;
    kind: AssignmentKind;
    testType: TestType | null;
    program?: {
      name: string;
      subject: string;
      grade: number;
    } | null;
    sessionLesson?: GradingCurriculumLessonInput | null;
  };
  programLessons?: GradingCurriculumLessonInput[];
  questions: GradingQuestionInput[];
  answers: unknown;
  hasAttachments?: boolean;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

export function buildGradingSkillPayload(input: BuildGradingSkillPayloadInput) {
  const sessionLesson = input.assignment.sessionLesson
    ? {
        id: input.assignment.sessionLesson.id,
        sequence: input.assignment.sessionLesson.sequence,
        title: input.assignment.sessionLesson.title,
        content: truncateText(input.assignment.sessionLesson.content, LESSON_CONTENT_MAX_CHARS),
      }
    : null;

  const programLessons = (input.programLessons ?? [])
    .slice(0, MAX_PROGRAM_LESSONS_CONTEXT)
    .map((lesson) => ({
      id: lesson.id,
      sequence: lesson.sequence,
      title: lesson.title,
      content: truncateText(lesson.content, LESSON_CONTENT_MAX_CHARS),
    }));

  return {
    curriculum: {
      program: input.assignment.program
        ? {
            name: input.assignment.program.name,
            subject: input.assignment.program.subject,
            grade: input.assignment.program.grade,
          }
        : null,
      sessionLesson,
      programLessons,
    },
    assignment: {
      id: input.assignment.id,
      title: input.assignment.title,
      instructions: input.assignment.instructions,
      kind: input.assignment.kind,
      testType: input.assignment.testType,
    },
    questions: input.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      ...(Array.isArray(q.choices) ? { choices: q.choices } : {}),
      rubric: q.rubric,
      correctAnswer: q.correctAnswer,
      maxScore: q.maxScore,
      ...(q.outcome
        ? {
            learningOutcome: {
              code: q.outcome.code,
              title: q.outcome.title,
              statement: q.outcome.statement,
            },
          }
        : {}),
    })),
    answers: input.answers,
    hasAttachments: Boolean(input.hasAttachments),
  };
}
