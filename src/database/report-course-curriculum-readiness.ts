import { PrismaClient } from '@prisma/client';

/** Read-only rollout report. Does not change course settings or published dates. */
async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const programs = await db.program.findMany({
      include: { classes: { where: { isActive: true }, include: { weeklySchedules: true } } },
      orderBy: { id: 'asc' },
    });
    const frequencyIssues = programs.flatMap((program) => {
      const classes = program.classes.map((classroom) => {
        const slots = classroom.weeklySchedules;
        const invalidSlots = slots.some(
          (slot) =>
            !Number.isInteger(slot.weekday) ||
            slot.weekday < 1 ||
            slot.weekday > 7 ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.endTime) ||
            slot.startTime >= slot.endTime,
        );
        const overlapping = slots.some((slot, index) =>
          slots
            .slice(index + 1)
            .some(
              (other) =>
                slot.weekday === other.weekday &&
                slot.startTime < other.endTime &&
                slot.endTime > other.startTime,
            ),
        );
        return {
          id: classroom.id,
          name: classroom.name,
          isOpen: classroom.isOpen,
          slots: slots.length,
          invalidSlots,
          overlapping,
        };
      });
      const mismatched = classes.filter(
        (classroom) =>
          classroom.invalidSlots ||
          classroom.overlapping ||
          (classroom.slots === 0 ? classroom.isOpen : classroom.slots !== program.sessionsPerWeek),
      );
      return program.sessionsPerWeek === null || mismatched.length
        ? [
            {
              programId: program.id,
              name: program.name,
              sessionsPerWeek: program.sessionsPerWeek,
              classes,
            },
          ]
        : [];
    });
    const units = await db.curriculumUnit.findMany({
      where: {
        OR: [
          { status: 'APPROVED' },
          { status: 'ARCHIVED', archiveReason: 'SUPERSEDED', approvedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        programId: true,
        title: true,
        fromDate: true,
        toDate: true,
        status: true,
      },
      orderBy: [{ programId: 'asc' }, { fromDate: 'asc' }, { id: 'asc' }],
    });
    const curriculumConflicts: Array<{ programId: string; unitIds: string[] }> = [];
    for (let index = 0; index < units.length; index++) {
      const unit = units[index];
      for (let next = index + 1; next < units.length; next++) {
        const candidate = units[next];
        if (candidate.programId !== unit.programId || candidate.fromDate > unit.toDate) break;
        if (candidate.toDate >= unit.fromDate)
          curriculumConflicts.push({ programId: unit.programId, unitIds: [unit.id, candidate.id] });
      }
    }
    process.stdout.write(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          ready: frequencyIssues.length === 0 && curriculumConflicts.length === 0,
          frequencyIssues,
          curriculumConflicts,
        },
        null,
        2,
      ) + '\n',
    );
    if (frequencyIssues.length || curriculumConflicts.length) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Readiness report failed; check database connectivity and applied migrations.\n',
  );
  process.exitCode = 1;
});
