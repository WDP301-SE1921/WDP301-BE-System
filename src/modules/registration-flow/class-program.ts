import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app.error';

export type ProgramForNewClass = Prisma.ProgramGetPayload<{ include: { subjectRecord: true } }>;

/**
 * The program a new class joins. A program or subject the ADMIN soft-deleted keeps `isActive`, so
 * `deletedAt` is checked too: a deleted program reads as not found, like in the program list that
 * hides it, and a deleted subject as inactive. Shared by `POST /classes` and the older
 * `POST /academic/classes`, which used to skip these checks.
 */
export async function loadProgramForNewClass(
  db: Pick<Prisma.TransactionClient, 'program'>,
  programId: string,
): Promise<ProgramForNewClass> {
  const program = await db.program.findUnique({
    where: { id: programId },
    include: { subjectRecord: true },
  });
  if (!program || program.deletedAt)
    throw new AppError('PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
  if (!program.isActive)
    throw new AppError('PROGRAM_INACTIVE', 'Program is inactive', HttpStatus.CONFLICT);
  const subject = program.subjectRecord;
  if (subject && (!subject.isActive || subject.deletedAt))
    throw new AppError('SUBJECT_INACTIVE', 'Subject is inactive', HttpStatus.CONFLICT);
  return program;
}
