import type { Prisma } from '@prisma/client';

export const parentEnrollmentSelect = {
  id: true,
  classId: true,
  status: true,
  endedAt: true,
  startDate: true,
  endDate: true,
  placements: { select: { classId: true, effectiveFrom: true, effectiveTo: true } },
} satisfies Prisma.EnrollmentSelect;

type Enrollment = Prisma.EnrollmentGetPayload<{ select: typeof parentEnrollmentSelect }>;
const localMidnight = (date: Date): Date => new Date(date.getTime() - 7 * 3_600_000);

/** The same eligibility predicate is used for list, count and detail. */
export function parentSessionWhere(enrollments: Enrollment[]): Prisma.ClassSessionWhereInput {
  return {
    OR: enrollments.map((enrollment) => ({
      AND: [
        ...(enrollment.status === 'ENDED' && enrollment.endedAt
          ? [{ startsAt: { lt: enrollment.endedAt } }]
          : []),
        {
          OR: [
            { participants: { some: { enrollmentId: enrollment.id, cancelled: false } } },
            ...(enrollment.startDate && enrollment.endDate
              ? [
                  {
                    AND: [
                      {
                        startsAt: {
                          gte: localMidnight(enrollment.startDate),
                          lt: localMidnight(enrollment.endDate),
                        },
                      },
                      { participants: { none: { enrollmentId: enrollment.id, cancelled: true } } },
                      enrollment.placements.length
                        ? {
                            OR: enrollment.placements.map((placement) => ({
                              classId: placement.classId,
                              startsAt: {
                                gte: placement.effectiveFrom,
                                ...(placement.effectiveTo ? { lt: placement.effectiveTo } : {}),
                              },
                            })),
                          }
                        : { classId: enrollment.classId },
                    ],
                  },
                ]
              : []),
          ],
        },
      ],
    })),
  };
}
