import type { Prisma } from '@prisma/client';
import { assignedTeacherAt } from '../registration-flow/class-teacher';

/**
 * Why a teacher may review the content of a program (Q3):
 * PROGRAM runs an active class of the program, SUBJECT runs an active class of another program
 * of the same subject, ANY applies only when neither group has an active teacher.
 */
export type ReviewerReason = 'PROGRAM' | 'SUBJECT' | 'ANY';

export interface ReviewerTiers {
  program: Set<string>;
  /** Never repeats a teacher already in `program`. */
  subject: Set<string>;
}

type Db = Prisma.TransactionClient;

export function subjectKey(subject: string): string {
  return subject
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .toLocaleLowerCase('vi')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .normalize('NFKC');
}

/** Two programs share a subject by subject record when both have one, otherwise by name. */
function sameSubject(
  a: { subject: string; subjectId: string | null },
  b: { subject: string; subjectId: string | null },
): boolean {
  return a.subjectId && b.subjectId
    ? a.subjectId === b.subjectId
    : subjectKey(a.subject) === subjectKey(b.subject);
}

export async function reviewerTiers(db: Db, programId: string, at: Date): Promise<ReviewerTiers> {
  const programs = await db.program.findMany({
    select: { id: true, subject: true, subjectId: true },
  });
  const target = programs.find((program) => program.id === programId);
  if (!target) return { program: new Set(), subject: new Set() };
  const related = programs.filter((program) => sameSubject(program, target)).map((row) => row.id);
  const classes = await db.class.findMany({
    where: { programId: { in: related }, isActive: true },
    select: { programId: true, teacherId: true, pendingTeacherId: true, pendingTeacherFrom: true },
  });
  const ofProgram = new Set<string>();
  const ofSubject = new Set<string>();
  for (const classroom of classes) {
    const teacherId = assignedTeacherAt(classroom, at);
    if (teacherId) (classroom.programId === programId ? ofProgram : ofSubject).add(teacherId);
  }
  const candidates = [...new Set([...ofProgram, ...ofSubject])];
  const active = new Set(
    candidates.length
      ? (
          await db.user.findMany({
            where: { id: { in: candidates }, role: 'TEACHER', status: 'ACTIVE' },
            select: { id: true },
          })
        ).map((user) => user.id)
      : [],
  );
  const program = new Set([...ofProgram].filter((id) => active.has(id)));
  const subject = new Set([...ofSubject].filter((id) => active.has(id) && !program.has(id)));
  return { program, subject };
}

/** The reason a teacher may be chosen to review curriculum content, or null when they may not. */
export async function reviewerReason(
  db: Db,
  teacherId: string,
  programId: string,
  at: Date,
): Promise<ReviewerReason | null> {
  if (!(await isActiveTeacher(db, teacherId))) return null;
  const tiers = await reviewerTiers(db, programId, at);
  if (tiers.program.has(teacherId)) return 'PROGRAM';
  if (tiers.subject.has(teacherId)) return 'SUBJECT';
  return tiers.program.size || tiers.subject.size ? null : 'ANY';
}

/**
 * CLO sets have no reviewer of their own (Q3, one submission): the teacher chosen for a
 * curriculum of the program reviews its CLOs too, also after that curriculum was applied or
 * replaced by a later period. The ANY group alone never grants access to CLO sets.
 */
export async function mayReviewProgramOutcomes(
  db: Db,
  teacherId: string,
  programId: string,
  at: Date,
): Promise<boolean> {
  if (!(await isActiveTeacher(db, teacherId))) return false;
  const tiers = await reviewerTiers(db, programId, at);
  if (tiers.program.has(teacherId) || tiers.subject.has(teacherId)) return true;
  const chosen = await db.curriculumUnit.count({
    where: {
      programId,
      reviewerTeacherId: teacherId,
      OR: [
        { status: 'PENDING_REVIEW' },
        { status: 'APPROVED', technicalReviewedAt: { not: null } },
        { status: 'ARCHIVED', technicalReviewedAt: { not: null }, approvedAt: { not: null } },
      ],
    },
  });
  return chosen > 0;
}

async function isActiveTeacher(db: Db, teacherId: string): Promise<boolean> {
  const teacher = await db.user.findFirst({
    where: { id: teacherId, role: 'TEACHER', status: 'ACTIVE' },
    select: { id: true },
  });
  return !!teacher;
}
