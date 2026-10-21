import { Prisma, type CurriculumUnit, type Lesson, type StudentProfile } from '@prisma/client';
import {
  lastMonthlySlots,
  slotsForRange,
} from '../../modules/curriculum-scheduling/curriculum-scheduling.service';
import type { SeedUsers } from './seed-accounts';
import { SUBJECTS, TOPICS, lessonContent } from './curriculum-content';
import { addDays, dateOnly, demoId, localInstant, monthStart } from './seed-calendar';

export type DemoClass = Prisma.ClassGetPayload<{
  include: { program: true; weeklySchedules: true };
}>;
export interface SeedCatalog {
  classes: Record<string, DemoClass>;
  units: Record<string, CurriculumUnit>;
  lessons: Record<string, Lesson[]>;
  students: Record<string, StudentProfile>;
  from: Date;
  to: Date;
}

const PHASES = [
  'Khái niệm và ví dụ',
  'Luyện tập cơ bản',
  'Thực hành theo nhóm',
  'Vận dụng thực tế',
  'Giải bài tổng hợp',
  'Ôn tập và củng cố',
];

export async function seedCatalog(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  today: Date,
): Promise<SeedCatalog> {
  const from = monthStart(today, -1);
  const to = addDays(monthStart(today, 3), -1);
  const createdAt = localInstant(addDays(from, -14), 9);
  const result: SeedCatalog = { classes: {}, units: {}, lessons: {}, students: {}, from, to };
  const rooms: string[] = [];
  for (const [index, name] of [
    'Phòng A101',
    'Phòng A102',
    'Phòng B201',
    'Phòng B202',
    'Phòng C301',
    'Phòng C302 - Tạm ngừng',
  ].entries()) {
    const room = await tx.room.upsert({
      where: { name },
      update: {},
      create: {
        id: demoId(`room_${index}`),
        name,
        capacity: index === 5 ? 15 : 30,
        isActive: index !== 5,
        createdAt,
      },
    });
    rooms.push(room.id);
  }

  for (const subject of SUBJECTS) {
    const record = await tx.subject.upsert({
      where: { code: subject.code },
      update: {},
      create: {
        id: demoId(`subject_${subject.key}`),
        code: subject.code,
        name: subject.name,
        createdAt,
      },
    });
    if (record.name !== subject.name || !record.isActive)
      throw new Error(
        `Subject code ${subject.code} already has incompatible data. Existing subjects were not changed.`,
      );
    for (const grade of [6, 7, 8, 9]) {
      const key = `${subject.key}-${grade}`;
      const program = await tx.program.upsert({
        where: { id: demoId(`program_${key}`) },
        update: {},
        create: {
          id: demoId(`program_${key}`),
          name: `${subject.name} ${grade} - Chương trình trung tâm`,
          subject: record.name,
          subjectId: record.id,
          grade,
          sessionsPerWeek: 2,
          createdAt,
        },
      });
      const slots = grade === 6 ? [1, 3] : grade === 7 ? [2, 4] : grade === 8 ? [1, 3] : [2, 4];
      if (subject.key === 'physics' && grade === 8) slots.splice(0, 2, 2, 4);
      if (subject.key === 'physics' && grade === 9) slots.splice(0, 2, 5, 7);
      const hour = grade <= 7 ? '16:00' : '18:00';
      const classroom = await tx.class.upsert({
        where: { id: demoId(`class_${key}-a`) },
        update: {},
        create: {
          id: demoId(`class_${key}-a`),
          programId: program.id,
          name: `${subject.name} ${grade}A`,
          capacity: 20,
          monthlyFee: subject.fee,
          teacherId: users[subject.teacher].id,
          roomId: rooms[subject.room],
          isOpen: true,
          scheduleConfirmedAt: grade === 8 ? createdAt : null,
          scheduleConfirmedById: grade === 8 ? users.manager.id : null,
          pendingTeacherId: key === 'math-7' ? users['substitute-teacher'].id : null,
          pendingTeacherFrom: key === 'math-7' ? localInstant(monthStart(today, 1)) : null,
          createdAt,
        },
      });
      await createSchedules(tx, classroom.id, slots, hour, grade <= 7 ? '18:00' : '20:00');
      result.classes[`${key}-a`] = await tx.class.findUniqueOrThrow({
        where: { id: classroom.id },
        include: { program: true, weeklySchedules: true },
      });
    }
  }

  const extras = [
    {
      key: 'math-8-b',
      base: 'math-8-a',
      name: 'Toán 8B',
      slots: [2, 4],
      start: '18:00',
      end: '20:00',
      teacher: users['substitute-teacher'].id,
      room: rooms[4],
      capacity: 20,
      open: true,
      active: true,
    },
    {
      key: 'math-8-full',
      base: 'math-8-a',
      name: 'Toán 8C - Đủ sĩ số',
      slots: [1, 3],
      start: '20:00',
      end: '21:30',
      teacher: users.teacher.id,
      room: rooms[0],
      capacity: 2,
      open: true,
      active: true,
    },
    {
      key: 'physics-8-closed',
      base: 'physics-8-a',
      name: 'Vật lý 8B - Đóng đăng ký',
      slots: [5, 7],
      start: '20:00',
      end: '21:30',
      teacher: users['physics-teacher'].id,
      room: rooms[1],
      capacity: 20,
      open: false,
      active: true,
    },
    {
      key: 'chemistry-8-inactive',
      base: 'chemistry-8-a',
      name: 'Hóa học 8B - Tạm ngừng',
      slots: [5, 7],
      start: '18:00',
      end: '20:00',
      teacher: users['chemistry-teacher'].id,
      room: rooms[2],
      capacity: 20,
      open: false,
      active: false,
    },
    {
      key: 'math-8-unassigned',
      base: 'math-8-a',
      name: 'Toán 8D - Chưa phân công',
      slots: [5, 7],
      start: '14:00',
      end: '16:00',
      teacher: null,
      room: null,
      capacity: 20,
      open: false,
      active: true,
    },
  ];
  for (const item of extras) {
    const base = result.classes[item.base];
    const classroom = await tx.class.upsert({
      where: { id: demoId(`class_${item.key}`) },
      update: {},
      create: {
        id: demoId(`class_${item.key}`),
        programId: base.programId,
        name: item.name,
        capacity: item.capacity,
        monthlyFee: base.monthlyFee,
        teacherId: item.teacher,
        roomId: item.room,
        isOpen: item.open,
        isActive: item.active,
        createdAt,
      },
    });
    await createSchedules(tx, classroom.id, item.slots, item.start, item.end);
    result.classes[item.key] = await tx.class.findUniqueOrThrow({
      where: { id: classroom.id },
      include: { program: true, weeklySchedules: true },
    });
  }

  for (const subject of SUBJECTS) {
    for (const grade of [6, 7, 8, 9]) {
      const key = `${subject.key}-${grade}`;
      const program = result.classes[`${key}-a`].program;
      const subjectKey = subject.name
        .normalize('NFD')
        .toLocaleLowerCase('vi')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/đ/g, 'd');
      const track = await tx.curriculumTrack.upsert({
        where: { grade_subjectKey: { grade, subjectKey } },
        update: {},
        create: { id: demoId(`track_${key}`), grade, subject: subject.name, subjectKey, createdAt },
      });
      const shared = {
        trackId: track.id,
        programId: program.id,
        designerId: users[subject.designer].id,
        fromDate: from,
        toDate: to,
        createdAt,
      };
      const archived = await tx.curriculumUnit.upsert({
        where: { id: demoId(`unit_${key}_v1`) },
        update: {},
        create: {
          ...shared,
          id: demoId(`unit_${key}_v1`),
          title: `${subject.name} ${grade} - Bản lưu trữ`,
          version: 1,
          status: 'ARCHIVED',
          submittedAt: createdAt,
          reviewedAt: createdAt,
          approvedAt: createdAt,
          reviewedById: users.manager.id,
          reviewerTeacherId: users[subject.teacher].id,
          technicalReviewedAt: createdAt,
          technicalReviewNote: 'Giáo viên phụ trách đã duyệt nội dung chuyên môn.',
        },
      });
      const unit = await tx.curriculumUnit.upsert({
        where: { id: demoId(`unit_${key}_v2`) },
        update: {},
        create: {
          ...shared,
          id: demoId(`unit_${key}_v2`),
          basedOnId: archived.id,
          title: `${subject.name} ${grade} - Học phần ${dateOnly(from).slice(0, 7)} đến ${dateOnly(to).slice(0, 7)}`,
          version: 2,
          status: 'APPROVED',
          submittedAt: createdAt,
          reviewedAt: createdAt,
          approvedAt: createdAt,
          reviewedById: users.manager.id,
          reviewerTeacherId: users[subject.teacher].id,
          technicalReviewedAt: createdAt,
          technicalReviewNote: 'Giáo viên phụ trách đã duyệt nội dung chuyên môn.',
          reviewNote: 'Trung tâm xác nhận áp dụng giáo trình đã được giáo viên duyệt.',
        },
      });
      result.units[key] = unit;
      if (key === 'math-8' || key === 'physics-8') {
        for (const [version, status] of [
          [3, 'DRAFT'],
          [4, 'PENDING_REVIEW'],
        ] as const) {
          const reviewUnit = await tx.curriculumUnit.upsert({
            where: { id: demoId(`unit_${key}_v${version}`) },
            update: {},
            create: {
              ...shared,
              id: demoId(`unit_${key}_v${version}`),
              title: `${subject.name} ${grade} - ${status === 'DRAFT' ? 'Bản đang soạn' : 'Bản chờ duyệt'}`,
              version,
              basedOnId: unit.id,
              fromDate: monthStart(today, 3),
              toDate: addDays(monthStart(today, 6), -1),
              status,
              submittedAt: status === 'PENDING_REVIEW' ? localInstant(addDays(today, -2), 9) : null,
              reviewerTeacherId: status === 'PENDING_REVIEW' ? users[subject.teacher].id : null,
            },
          });
          await tx.lesson.upsert({
            where: { id: demoId(`lesson_${key}_v${version}`) },
            update: {},
            create: {
              id: demoId(`lesson_${key}_v${version}`),
              programId: program.id,
              unitId: reviewUnit.id,
              designerId: users[subject.designer].id,
              title: `${TOPICS[key][0].title} - Bản đề xuất`,
              content: lessonContent(TOPICS[key][0], 'Bổ sung ví dụ và luyện tập'),
              sequence: 1,
              status: 'DRAFT',
              createdAt,
            },
          });
        }
      }
      const classPlans = Object.values(result.classes)
        .filter((c) => c.programId === program.id && c.isActive && c.teacherId)
        .map((c) => slotsForRange(c.weeklySchedules, dateOnly(from), dateOnly(to)));
      // Preserve old demo curricula and sessions when the additive seed is rerun.
      const legacyTests = await tx.lesson.findMany({
        where: { unitId: unit.id, kind: 'MONTHLY_TEST' },
        orderBy: { sequence: 'asc' },
      });
      const regularCount = Math.max(
        ...classPlans.map((slots) =>
          legacyTests.length ? slots.length - lastMonthlySlots(slots).size : slots.length,
        ),
      );
      const topics = TOPICS[key];
      result.lessons[key] = [];
      for (let index = 0; index < regularCount; index++) {
        const topicIndex = Math.floor((index * topics.length) / regularCount);
        const topic = topics[topicIndex];
        const phase =
          PHASES[(index - Math.ceil((topicIndex * regularCount) / topics.length)) % PHASES.length];
        const lesson = await tx.lesson.upsert({
          where: { id: demoId(`lesson_${key}_${index + 1}`) },
          update: {},
          create: {
            id: demoId(`lesson_${key}_${index + 1}`),
            unitId: unit.id,
            programId: program.id,
            designerId: users[subject.designer].id,
            title: `${topic.title} - ${phase}`,
            content: lessonContent(topic, phase),
            sequence: index + 1,
            status: 'APPROVED',
            createdAt,
          },
        });
        result.lessons[key].push(lesson);
      }
      result.lessons[key].push(...legacyTests);
    }
  }

  const definitions = [
    ['an', 'Nguyễn Minh An', 8, 'parent'],
    ['binh', 'Trần Gia Bình', 8, 'parent-2'],
    ['chi', 'Lê Bảo Chi', 8, 'parent-3'],
    ['dung', 'Phạm Anh Dũng', 8, 'parent-4'],
    ['ha', 'Trần Ngọc Hà', 8, 'parent-2'],
    ['khanh', 'Lê Minh Khánh', 9, 'parent-3'],
    ['linh', 'Phạm Thảo Linh', 6, 'parent-4'],
    ['minh', 'Võ Nhật Minh', 7, 'parent-5'],
    ['ngoc', 'Võ Bảo Ngọc', 8, 'parent-5'],
    ['phuc', 'Võ Hoàng Phúc', 8, 'parent-5'],
    ['quynh', 'Nguyễn Như Quỳnh', 8, 'parent-disabled'],
    ['trang', 'Nguyễn Thu Trang', 8, 'parent-unverified'],
    ['thai', 'Võ Minh Thái', 8, 'parent-5'],
    ['nga', 'Phạm Hồng Nga', 8, 'parent-4'],
  ] as const;
  for (const [key, fullName, grade, parentKey] of definitions) {
    const parent = await tx.parentProfile.findUniqueOrThrow({
      where: { userId: users[parentKey].id },
    });
    result.students[key] = await tx.studentProfile.upsert({
      where: { id: demoId(`student_${key}`) },
      update: {},
      create: {
        id: demoId(`student_${key}`),
        parentProfileId: parent.id,
        fullName,
        grade,
        dateOfBirth: new Date(Date.UTC(today.getUTCFullYear() - grade - 5, 3, 12)),
        status: key === 'phuc' ? 'INACTIVE' : 'ACTIVE',
        createdAt,
      },
    });
  }
  return result;
}

async function createSchedules(
  tx: Prisma.TransactionClient,
  classId: string,
  days: number[],
  startTime: string,
  endTime: string,
): Promise<void> {
  for (const weekday of days)
    await tx.classWeeklySchedule.upsert({
      where: { id: `${classId}_weekday_${weekday}` },
      update: {},
      create: { id: `${classId}_weekday_${weekday}`, classId, weekday, startTime, endTime },
    });
}
