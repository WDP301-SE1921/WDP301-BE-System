import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient, User } from '@prisma/client';
import {
  lastMonthlySlots,
  slotsForRange,
} from '../../modules/curriculum-scheduling/curriculum-scheduling.service';
import { SUBJECTS, TOPICS, lessonContent } from './curriculum-content';
import {
  addDays,
  addMonths,
  dateOnly,
  demoId,
  localInstant,
  monthStart,
  referenceDate,
  studyDay,
} from './seed-calendar';
import {
  ANNOUNCEMENTS,
  CANCEL_REASONS,
  DECLINE_NOTES,
  FAMILY_NAMES,
  FEMALE_GIVEN,
  FEMALE_MIDDLE,
  GRADE_FEEDBACK,
  HOLIDAYS,
  LEAVE_REASONS,
  MALE_GIVEN,
  MALE_MIDDLE,
  PAUSE_REASONS,
  PHONE_PREFIXES,
  ROOMS,
  SCHEDULE_OPTIONS,
  SESSION_SUMMARIES,
  SUBSTITUTE_REASONS,
  SeedRandom,
  TEACHERS_PER_SUBJECT,
  bulkClassDefinitions,
  className,
  slug,
} from './seed-dashboard-data';

/**
 * Bulk dataset layered on top of the demo seed so manager dashboards have six months of
 * history: gradual class openings, monthly tuition renewals, attendance, leave, makeups,
 * substitutions, assessments and audit activity. Rows use the `seed_bulk_v1_` prefix and the
 * whole layer is written once, in one transaction, guarded by a manifest audit log.
 */
export const BULK_PREFIX = 'seed_bulk_v1_';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const CHUNK = 500;
const TARGET_STUDENTS = 440;
const HISTORY_PHASES = [
  'Ôn tập nền tảng',
  'Học trước kiến thức mới',
  'Luyện tập cơ bản',
  'Bài tập vận dụng',
  'Luyện đề tổng hợp',
  'Chữa bài và củng cố',
];

export function bulkId(key: string): string {
  return `${BULK_PREFIX}${key}`;
}

type Gender = 'F' | 'M';
type SessionStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
type Attendance = 'UNMARKED' | 'PRESENT' | 'ABSENT' | 'EXCUSED';
type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface Person {
  family: string;
  fullName: string;
}

interface WeeklySlot {
  weekday: number;
  startTime: string;
  endTime: string;
}

interface Interval {
  start: Date;
  end: Date;
}

interface ProgramInfo {
  key: string;
  subjectKey: string;
  subjectName: string;
  grade: number;
  id: string;
  fee: number;
  trackId: string;
  designerId: string;
  currentDesignerId: string;
  reviewerTeacherId: string;
  currentUnitId: string;
  currentLessons: string[];
  maxSequence: number;
  tests: Map<string, string>;
  historyLessons: string[];
}

interface DemoClass {
  key: string;
  id: string;
  programKey: string;
  name: string;
  capacity: number;
  fee: number;
  teacherId: string;
  roomId: string | null;
  createdAt: Date;
  schedules: WeeklySlot[];
  sessions: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    status: SessionStatus;
    lessonId: string;
    teacherId: string;
    seats: number;
  }[];
  occupancy: Interval[];
}

interface SeedContext {
  today: Date;
  cutoff: Date;
  historyStart: Date;
  termStart: Date;
  termEnd: Date;
  manager: User;
  staff: User;
  programs: Map<string, ProgramInfo>;
  demoClasses: DemoClass[];
  usedEmails: Set<string>;
  usedRoomNames: Set<string>;
}

interface TeacherPlan {
  id: string;
  subjectKey: string;
  subjectName: string;
  fullName: string;
  email: string;
  createdAt: Date;
  disabledAt: Date | null;
  classCount: number;
  weekly: WeeklySlot[];
}

interface RoomPlan {
  id: string;
  capacity: number;
  weekly: WeeklySlot[];
}

interface ClassPlan {
  key: string;
  id: string;
  program: ProgramInfo;
  name: string;
  capacity: number;
  fee: number;
  isOpen: boolean;
  isActive: boolean;
  teacherId: string;
  roomId: string | null;
  schedules: WeeklySlot[];
  firstDay: Date;
  lastDay: Date;
  createdAt: Date;
  scheduleConfirmedAt: Date | null;
  bulk: boolean;
  sessions: SessionPlan[];
  occupancy: Interval[];
}

interface SessionPlan {
  id: string;
  classPlan: ClassPlan;
  lessonId: string;
  teacherId: string;
  startsAt: Date;
  endsAt: Date;
  day: Date;
  status: SessionStatus;
  summary: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  generationId: string | null;
  /** Participants that occupy a seat (not excused), including demo rows already stored. */
  seats: number;
}

interface ParentPlan {
  id: string;
  profileId: string;
  person: Person;
  email: string;
  phone: string;
  children: StudentPlan[];
}

interface StudentPlan {
  id: string;
  parent: ParentPlan;
  fullName: string;
  grade: number;
  dateOfBirth: Date;
  status: 'ACTIVE' | 'INACTIVE';
  absenceRate: number;
  ability: number;
  quitAt: Date | null;
  classes: ClassPlan[];
  packages: PackagePlan[];
  firstOrderAt: Date | null;
  busy: Interval[];
}

interface PauseLeave {
  id: string;
  from: Date;
  to: Date;
  status: LeaveStatus;
  createdAt: Date;
  decidedAt: Date | null;
  reason: string;
}

interface PackagePlan {
  orderId: string;
  enrollmentId: string;
  student: StudentPlan;
  classPlan: ClassPlan;
  start: Date;
  end: Date;
  months: number;
  orderCreatedAt: Date;
  /** Null for an unpaid draft bill. */
  confirmedAt: Date | null;
  staffId: string;
  endedAt: Date | null;
  endedEarly: boolean;
  pause: PauseLeave | null;
  /** Local dates with a single-absence request; makeups avoid them. */
  leaveDays: Set<string>;
}

interface ParticipantPlan {
  id: string;
  session: SessionPlan;
  pkg: PackagePlan;
  kind: 'REGULAR' | 'MAKEUP';
  attendance: Attendance;
}

interface AuditPlan {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
  createdAt: Date;
}

export interface PlanRows {
  users: Prisma.UserCreateManyInput[];
  parentProfiles: Prisma.ParentProfileCreateManyInput[];
  studentProfiles: Prisma.StudentProfileCreateManyInput[];
  rooms: Prisma.RoomCreateManyInput[];
  classes: Prisma.ClassCreateManyInput[];
  weeklySchedules: Prisma.ClassWeeklyScheduleCreateManyInput[];
  units: Prisma.CurriculumUnitCreateManyInput[];
  lessons: Prisma.LessonCreateManyInput[];
  generations: Prisma.ScheduleGenerationCreateManyInput[];
  sessions: Prisma.ClassSessionCreateManyInput[];
  orders: Prisma.RegistrationOrderCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  enrollments: Prisma.EnrollmentCreateManyInput[];
  placements: Prisma.EnrollmentPlacementCreateManyInput[];
  participants: Prisma.SessionParticipantCreateManyInput[];
  leaves: Prisma.LeaveRequestCreateManyInput[];
  makeups: Prisma.MakeupBookingCreateManyInput[];
  assignments: Prisma.AssignmentCreateManyInput[];
  questions: Prisma.AssignmentQuestionCreateManyInput[];
  recipients: Prisma.AssignmentRecipientCreateManyInput[];
  submissions: Prisma.SubmissionCreateManyInput[];
  grades: Prisma.GradeReviewCreateManyInput[];
  announcements: Prisma.AnnouncementCreateManyInput[];
  emails: Prisma.OutboxEventCreateManyInput[];
  audits: Prisma.AuditLogCreateManyInput[];
}

export interface DashboardSeedOptions {
  /** Instant treated as "now". Sessions that ended before it are completed; nothing is dated after it. */
  now?: Date;
}

export interface DashboardSeedResult {
  referenceDate: string;
  created: boolean;
  rows: Record<string, number>;
}

/** Adds the bulk dashboard layer once. Requires the demo seed and leaves its rows untouched. */
export async function seedDashboard(
  prisma: PrismaClient,
  passwordHash: string,
  options: DashboardSeedOptions = {},
): Promise<DashboardSeedResult> {
  const date = await demoReferenceDate(prisma);
  if (!date)
    throw new Error(
      'Demo dataset not found. Run pnpm seed (SEED_MODE=demo) before the dashboard seed.',
    );
  if (await prisma.auditLog.findUnique({ where: { id: bulkId('manifest') } }))
    return { referenceDate: date, created: false, rows: {} };
  const context = await loadContext(prisma, referenceDate(date), options.now ?? new Date());
  const plan = new DashboardPlan(context, passwordHash).build();
  await prisma.$transaction(
    async (tx) => {
      if (await tx.auditLog.findUnique({ where: { id: bulkId('manifest') } }))
        throw new Error('Another process applied the dashboard seed at the same time.');
      await insertRows(tx, plan.rows);
    },
    { maxWait: 30_000, timeout: 900_000 },
  );
  return { referenceDate: date, created: true, rows: rowCounts(plan.rows) };
}

export async function demoReferenceDate(prisma: PrismaClient): Promise<string | undefined> {
  const manifest = await prisma.auditLog.findUnique({ where: { id: demoId('manifest') } });
  const stored = manifest?.afterData;
  return stored &&
    typeof stored === 'object' &&
    !Array.isArray(stored) &&
    typeof stored.referenceDate === 'string'
    ? stored.referenceDate
    : undefined;
}

async function loadContext(prisma: PrismaClient, today: Date, now: Date): Promise<SeedContext> {
  const findUser = async (key: string): Promise<User> => {
    const user = await prisma.user.findFirst({
      where: { id: { startsWith: demoId(`user_${key}_`) } },
    });
    if (!user) throw new Error(`Demo account ${key} is missing. Run pnpm seed first.`);
    return user;
  };
  const manager = await findUser('manager');
  const staff = await findUser('staff');
  const designers: Record<string, User> = {
    designer: await findUser('designer'),
    'designer-2': await findUser('designer-2'),
  };
  const programs = new Map<string, ProgramInfo>();
  for (const subject of SUBJECTS) {
    const teacher = await findUser(subject.teacher);
    for (const grade of [6, 7, 8, 9]) {
      const key = `${subject.key}-${grade}`;
      const unit = await prisma.curriculumUnit.findUnique({
        where: { id: demoId(`unit_${key}_v2`) },
        include: { lessons: true },
      });
      if (!unit || unit.status !== 'APPROVED')
        throw new Error(`Approved demo curriculum ${key} is missing. Run pnpm reseed first.`);
      const regular = unit.lessons
        .filter((lesson) => lesson.kind === 'LESSON')
        .sort((a, b) => a.sequence - b.sequence);
      programs.set(key, {
        key,
        subjectKey: subject.key,
        subjectName: subject.name,
        grade,
        id: unit.programId,
        fee: subject.fee,
        trackId: unit.trackId,
        designerId: designers[subject.designer].id,
        currentDesignerId: unit.designerId,
        reviewerTeacherId: teacher.id,
        currentUnitId: unit.id,
        currentLessons: regular.map((lesson) => lesson.id),
        maxSequence: regular.at(-1)?.sequence ?? 0,
        tests: new Map(
          unit.lessons
            .filter((lesson) => lesson.kind === 'MONTHLY_TEST' && lesson.monthKey)
            .map((lesson) => [lesson.monthKey!, lesson.id]),
        ),
        historyLessons: [],
      });
    }
  }
  const demoClasses: DemoClass[] = [];
  const demoKeys = [
    ...SUBJECTS.flatMap((subject) => [6, 7, 8, 9].map((grade) => `${subject.key}-${grade}-a`)),
    'math-8-b',
  ];
  for (const key of demoKeys) {
    const row = await prisma.class.findUnique({
      where: { id: demoId(`class_${key}`) },
      include: {
        weeklySchedules: true,
        sessions: {
          // Manual makeup sessions only hold their makeup participant.
          where: { generationId: { not: null } },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            lessonId: true,
            teacherId: true,
            _count: {
              select: {
                participants: { where: { cancelled: false, attendance: { not: 'EXCUSED' } } },
              },
            },
          },
          orderBy: { startsAt: 'asc' },
        },
        enrollments: {
          where: { status: { in: ['ACTIVE', 'PENDING_LINK'] } },
          select: { startDate: true, endDate: true },
        },
      },
    });
    if (
      !row ||
      !row.isOpen ||
      !row.isActive ||
      !row.teacherId ||
      row.capacity < 10 ||
      !row.weeklySchedules.length ||
      !row.sessions.length
    )
      continue;
    demoClasses.push({
      key,
      id: row.id,
      programKey: key.replace(/-(a|b)$/, ''),
      name: row.name,
      capacity: row.capacity,
      fee: Number(row.monthlyFee),
      teacherId: row.teacherId,
      roomId: row.roomId,
      createdAt: row.createdAt,
      schedules: row.weeklySchedules.map(({ weekday, startTime, endTime }) => ({
        weekday,
        startTime,
        endTime,
      })),
      sessions: row.sessions.map((session) => ({
        id: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        status: session.status,
        lessonId: session.lessonId,
        teacherId: session.teacherId,
        seats: session._count.participants,
      })),
      occupancy: row.enrollments
        .filter((item) => item.startDate && item.endDate)
        .map((item) => ({ start: item.startDate!, end: item.endDate! })),
    });
  }
  const startOfToday = localInstant(today);
  const endOfToday = localInstant(addDays(today, 1));
  const cutoff = new Date(
    Math.min(Math.max(now.getTime(), startOfToday.getTime()), endOfToday.getTime() - MINUTE),
  );
  return {
    today,
    cutoff,
    historyStart: monthStart(today, -5),
    termStart: monthStart(today, -1),
    termEnd: addDays(monthStart(today, 3), -1),
    manager,
    staff,
    programs,
    demoClasses,
    usedEmails: new Set(
      (await prisma.user.findMany({ select: { email: true } })).map((user) =>
        user.email.toLowerCase(),
      ),
    ),
    usedRoomNames: new Set(
      (await prisma.room.findMany({ select: { name: true } })).map((r) => r.name),
    ),
  };
}

class DashboardPlan {
  readonly rows: PlanRows = {
    users: [],
    parentProfiles: [],
    studentProfiles: [],
    rooms: [],
    classes: [],
    weeklySchedules: [],
    units: [],
    lessons: [],
    generations: [],
    sessions: [],
    orders: [],
    payments: [],
    enrollments: [],
    placements: [],
    participants: [],
    leaves: [],
    makeups: [],
    assignments: [],
    questions: [],
    recipients: [],
    submissions: [],
    grades: [],
    announcements: [],
    emails: [],
    audits: [],
  };
  private readonly random = new SeedRandom(0x5eed2026);
  private readonly counters = new Map<string, number>();
  private readonly staff: { id: string; since: Date; weight: number }[] = [];
  private readonly teachers: TeacherPlan[] = [];
  private readonly rooms: RoomPlan[] = [];
  private readonly classes: ClassPlan[] = [];
  private readonly parents: ParentPlan[] = [];
  private readonly students: StudentPlan[] = [];
  private readonly packages: PackagePlan[] = [];
  private readonly participants: ParticipantPlan[] = [];
  private readonly audits: AuditPlan[] = [];
  private readonly usedPhones = new Set<string>();

  constructor(
    private readonly ctx: SeedContext,
    private readonly passwordHash: string,
  ) {}

  build(): this {
    this.createStaff();
    this.createTeachers();
    this.createRooms();
    this.createClasses();
    this.createSessions();
    this.createFamilies();
    this.createEnrollments();
    this.createSubstitutions();
    this.createPauses();
    this.createParticipants();
    this.createSingleLeaves();
    this.createMakeups();
    this.createAssessments();
    this.createAnnouncements();
    this.writePeople();
    this.writeClasses();
    this.writeEnrollments();
    this.createAccountActivity();
    this.writeAudits();
    return this;
  }

  // ---------------------------------------------------------------- helpers

  private nextId(kind: string, size = 5): string {
    const value = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, value);
    return bulkId(`${kind}_${String(value).padStart(size, '0')}`);
  }

  private person(gender: Gender, family?: string): Person {
    const familyName = family ?? this.random.weighted(FAMILY_NAMES);
    const middle = this.random.pick(gender === 'F' ? FEMALE_MIDDLE : MALE_MIDDLE);
    let given: string = this.random.pick(gender === 'F' ? FEMALE_GIVEN : MALE_GIVEN);
    if (given === middle) given = gender === 'F' ? 'Linh' : 'Khang';
    return { family: familyName, fullName: `${familyName} ${middle} ${given}` };
  }

  private email(local: string): string {
    for (let suffix = 1; ; suffix++) {
      const email = `${local}${suffix === 1 ? '' : suffix}@edugrade.local`;
      if (!this.ctx.usedEmails.has(email)) {
        this.ctx.usedEmails.add(email);
        return email;
      }
    }
  }

  private phone(): string {
    for (;;) {
      const phone = `${this.random.pick(PHONE_PREFIXES)}${String(this.random.int(0, 9_999_999)).padStart(7, '0')}`;
      if (!this.usedPhones.has(phone)) {
        this.usedPhones.add(phone);
        return phone;
      }
    }
  }

  /** Random instant in [from, to]; returns `from` when the range is empty. */
  private between(from: Date, to: Date): Date {
    return to <= from
      ? from
      : new Date(from.getTime() + this.random.next() * (to.getTime() - from.getTime()));
  }

  /** A local working-hours instant on the given study day. */
  private workTime(day: Date, fromHour = 8, toHour = 17): Date {
    return localInstant(day, this.random.int(fromHour, toHour), this.random.int(0, 59));
  }

  private staffAt(at: Date): string {
    const available = this.staff.filter((item) => item.since <= at);
    return this.random.weighted(available.map((item) => [item.id, item.weight] as const));
  }

  private audit(entry: AuditPlan): void {
    if (entry.createdAt <= this.ctx.cutoff) this.audits.push(entry);
  }

  private studyDayFrom(classPlan: ClassPlan, from: Date): Date | null {
    for (let offset = 0; offset < 14; offset++) {
      const day = addDays(from, offset);
      if (day > classPlan.lastDay) return null;
      if (day < classPlan.firstDay) continue;
      if (classPlan.schedules.some((slot) => slot.weekday === (day.getUTCDay() || 7))) return day;
    }
    return null;
  }

  // ---------------------------------------------------------------- accounts and catalog

  private createStaff(): void {
    // Demo accounts are stamped with the reference date, so the demo staff serves all history.
    this.staff.push({ id: this.ctx.staff.id, since: new Date(0), weight: 2 });
    for (const [index, offset] of [-35, 40].entries()) {
      const person = this.person(index === 0 ? 'F' : 'M');
      const createdAt = localInstant(addDays(this.ctx.historyStart, offset), 9, 15);
      const id = bulkId(`user_staff_${index + 1}`);
      const email = this.email(`nv.${slug(person.fullName)}`);
      this.rows.users.push({
        id,
        email,
        passwordHash: this.passwordHash,
        displayName: `${person.fullName} - Nhân viên`,
        role: 'STAFF',
        status: 'ACTIVE',
        emailVerifiedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
      this.staff.push({ id, since: createdAt, weight: 1 });
      this.audit({
        actorUserId: this.ctx.manager.id,
        action: 'STAFF_ACCOUNT_CREATE',
        entityType: 'User',
        entityId: id,
        afterData: { email, role: 'STAFF' },
        createdAt,
      });
    }
  }

  private createTeachers(): void {
    const { ctx } = this;
    const span = Math.round((ctx.today.getTime() - ctx.historyStart.getTime()) / DAY);
    for (const subject of SUBJECTS) {
      for (let index = 0; index < TEACHERS_PER_SUBJECT[subject.key]; index++) {
        const person = this.person(this.random.chance(0.6) ? 'F' : 'M');
        this.teachers.push({
          id: bulkId(`user_teacher_${subject.key}_${String(index + 1).padStart(2, '0')}`),
          subjectKey: subject.key,
          subjectName: subject.name,
          fullName: person.fullName,
          email: this.email(`gv.${slug(person.fullName)}`),
          createdAt: this.workTime(
            addDays(ctx.historyStart, this.random.int(-50, span - 5)),
            8,
            16,
          ),
          disabledAt: null,
          classCount: 0,
          weekly: [],
        });
      }
    }
    for (const [index, subject] of SUBJECTS.slice(1, 3).entries()) {
      const person = this.person(index === 0 ? 'M' : 'F');
      this.teachers.push({
        id: bulkId(`user_teacher_former_${index + 1}`),
        subjectKey: subject.key,
        subjectName: subject.name,
        fullName: person.fullName,
        email: this.email(`gv.${slug(person.fullName)}`),
        createdAt: localInstant(addDays(ctx.historyStart, -70 + index * 10), 10),
        disabledAt: localInstant(addDays(ctx.historyStart, 30 + index * 60), 16, 30),
        classCount: 0,
        weekly: [],
      });
    }
  }

  private createRooms(): void {
    const createdAt = localInstant(addDays(this.ctx.historyStart, -40), 9);
    for (const room of ROOMS) {
      if (this.ctx.usedRoomNames.has(room.name)) continue;
      const id = bulkId(`room_${room.key}`);
      this.rooms.push({ id, capacity: room.capacity, weekly: [] });
      this.rows.rooms.push({
        id,
        name: room.name,
        capacity: room.capacity,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      });
    }
    if (this.rooms.length < 6)
      throw new Error('Rooms reserved for the dashboard seed already exist with other data.');
  }

  private createClasses(): void {
    const { ctx } = this;
    for (const [order, definition] of bulkClassDefinitions().entries()) {
      const program = ctx.programs.get(definition.programKey)!;
      const first = monthStart(ctx.historyStart, definition.openingMonth);
      let opening = definition.openingMonth === 0 ? first : addDays(first, this.random.int(0, 6));
      if (opening > ctx.today) opening = monthStart(ctx.today);
      const options = SCHEDULE_OPTIONS[definition.variant];
      let allocation: { slots: WeeklySlot[]; room: RoomPlan; teacher: TeacherPlan } | undefined;
      for (let attempt = 0; attempt < options.length && !allocation; attempt++) {
        const option = options[(hash(definition.key) + attempt) % options.length];
        const slots = option.days.map((weekday) => ({
          weekday,
          startTime: option.start,
          endTime: option.end,
        }));
        const room = [...this.rooms.slice(order % this.rooms.length), ...this.rooms].find(
          (item) => item.capacity >= definition.capacity && !weeklyConflict(item.weekly, slots),
        );
        const teacher = this.teachers
          .filter(
            (item) =>
              !item.disabledAt &&
              item.subjectKey === program.subjectKey &&
              item.classCount < 2 &&
              !weeklyConflict(item.weekly, slots),
          )
          .sort((a, b) => a.classCount - b.classCount)[0];
        if (room && teacher) allocation = { slots, room, teacher };
      }
      if (!allocation)
        throw new Error(`Dashboard seed could not schedule ${definition.key} without overlaps.`);
      const { slots, room, teacher } = allocation;
      room.weekly.push(...slots);
      teacher.weekly.push(...slots);
      teacher.classCount++;
      const createdAt = localInstant(addDays(opening, -14), 9, 30);
      const hired = localInstant(addDays(opening, -this.random.int(18, 40)), 10);
      if (hired < teacher.createdAt) teacher.createdAt = hired;
      const subject = SUBJECTS.find((item) => item.key === program.subjectKey)!;
      this.classes.push({
        key: definition.key,
        id: bulkId(`class_${definition.key}`),
        program,
        name: className(subject.name, program.grade, definition.variant),
        capacity: definition.capacity,
        fee: program.fee + definition.feeDelta,
        isOpen: definition.isOpen,
        isActive: definition.isActive,
        teacherId: teacher.id,
        roomId: room.id,
        schedules: slots,
        firstDay: opening,
        lastDay: definition.isActive ? ctx.termEnd : addDays(ctx.termStart, -1),
        createdAt,
        scheduleConfirmedAt: this.random.chance(0.8) ? addDays(createdAt, 2) : null,
        bulk: true,
        sessions: [],
        occupancy: [],
      });
    }
    for (const demo of ctx.demoClasses) {
      const program = ctx.programs.get(demo.programKey);
      if (!program) continue;
      const classPlan: ClassPlan = {
        key: demo.key,
        id: demo.id,
        program,
        name: demo.name,
        capacity: demo.capacity,
        fee: demo.fee,
        isOpen: true,
        isActive: true,
        teacherId: demo.teacherId,
        roomId: demo.roomId,
        schedules: demo.schedules,
        firstDay: studyDay(demo.sessions[0].startsAt),
        lastDay: studyDay(demo.sessions[demo.sessions.length - 1].startsAt),
        createdAt: demo.createdAt,
        scheduleConfirmedAt: null,
        bulk: false,
        sessions: [],
        occupancy: [...demo.occupancy],
      };
      classPlan.sessions = demo.sessions.map((session) => ({
        id: session.id,
        classPlan,
        lessonId: session.lessonId,
        teacherId: session.teacherId,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        day: studyDay(session.startsAt),
        status: session.status,
        summary: null,
        cancelReason: null,
        cancelledAt: null,
        generationId: null,
        seats: session.seats,
      }));
      this.classes.push(classPlan);
    }
  }

  // ---------------------------------------------------------------- curriculum and sessions

  private createSessions(): void {
    const { ctx } = this;
    const termKey = dateOnly(ctx.termStart);
    const plans = this.classes
      .filter((classPlan) => classPlan.bulk)
      .map((classPlan) => {
        const slots = slotsForRange(
          classPlan.schedules,
          dateOnly(classPlan.firstDay),
          dateOnly(classPlan.lastDay),
        );
        return {
          classPlan,
          history: slots.filter((slot) => slot.date < termKey),
          current: slots.filter((slot) => slot.date >= termKey),
        };
      });
    for (const program of ctx.programs.values()) {
      const mine = plans.filter((plan) => plan.classPlan.program === program);
      const history = Math.max(0, ...mine.map((plan) => plan.history.length));
      if (history) this.createHistoryUnit(program, history);
      const needed = Math.max(0, ...mine.map((plan) => regularNeeded(program, plan.current)));
      this.appendCurrentLessons(program, needed);
    }
    for (const plan of plans) this.createClassSessions(plan.classPlan, plan.history, plan.current);
  }

  private createHistoryUnit(program: ProgramInfo, count: number): void {
    const { ctx } = this;
    const id = bulkId(`unit_${program.key}_history`);
    const createdAt = localInstant(addDays(ctx.historyStart, -30), 9);
    const submittedAt = localInstant(addDays(ctx.historyStart, -16), 9);
    const technicalReviewedAt = localInstant(addDays(ctx.historyStart, -13), 15);
    const approvedAt = localInstant(addDays(ctx.historyStart, -10), 10);
    const toDate = addDays(ctx.termStart, -1);
    this.rows.units.push({
      id,
      trackId: program.trackId,
      programId: program.id,
      designerId: program.designerId,
      version: 1,
      revision: 1,
      submittedAt,
      reviewedAt: approvedAt,
      reviewedById: ctx.manager.id,
      reviewNote: 'Trung tâm xác nhận áp dụng học phần hè đã được giáo viên duyệt.',
      reviewerTeacherId: program.reviewerTeacherId,
      technicalReviewedAt,
      technicalReviewNote: 'Giáo viên phụ trách đã duyệt nội dung chuyên môn.',
      title: `${program.subjectName} ${program.grade} - Học phần ${dateOnly(ctx.historyStart).slice(0, 7)} đến ${dateOnly(toDate).slice(0, 7)}`,
      fromDate: ctx.historyStart,
      toDate,
      status: 'APPROVED',
      approvedAt,
      createdAt,
      updatedAt: approvedAt,
    });
    const topics = TOPICS[program.key];
    for (let index = 0; index < count; index++) {
      const topicIndex = Math.floor((index * topics.length) / count);
      const topic = topics[topicIndex];
      const phase =
        HISTORY_PHASES[
          (index - Math.ceil((topicIndex * count) / topics.length)) % HISTORY_PHASES.length
        ];
      const lessonId = bulkId(`lesson_${program.key}_history_${index + 1}`);
      this.rows.lessons.push({
        id: lessonId,
        programId: program.id,
        designerId: program.designerId,
        unitId: id,
        title: `${topic.title} - ${phase}`,
        content: lessonContent(topic, phase),
        sequence: index + 1,
        kind: 'LESSON',
        status: 'APPROVED',
        createdAt,
      });
      program.historyLessons.push(lessonId);
    }
    this.audit({
      actorUserId: program.designerId,
      action: 'CURRICULUM_UNIT_SUBMITTED',
      entityType: 'CurriculumUnit',
      entityId: id,
      afterData: { reviewerTeacherId: program.reviewerTeacherId },
      createdAt: submittedAt,
    });
    this.audit({
      actorUserId: program.reviewerTeacherId,
      action: 'CURRICULUM_TECHNICAL_REVIEW_APPROVED',
      entityType: 'CurriculumUnit',
      entityId: id,
      afterData: { approved: true, note: 'Nội dung phù hợp với học sinh trung tâm.' },
      createdAt: technicalReviewedAt,
    });
    this.audit({
      actorUserId: ctx.manager.id,
      action: 'CURRICULUM_UNIT_APPROVED',
      entityType: 'CurriculumUnit',
      entityId: id,
      createdAt: approvedAt,
    });
  }

  /** Classes of one program share the approved unit, which needs a lesson for every slot. */
  private appendCurrentLessons(program: ProgramInfo, needed: number): void {
    const missing = needed - program.currentLessons.length;
    const topics = TOPICS[program.key];
    const createdAt = localInstant(addDays(this.ctx.termStart, -12), 9);
    for (let index = 0; index < missing; index++) {
      const sequence = program.maxSequence + index + 1;
      const topic = topics[index % topics.length];
      const id = bulkId(`lesson_${program.key}_current_${sequence}`);
      this.rows.lessons.push({
        id,
        programId: program.id,
        designerId: program.currentDesignerId,
        unitId: program.currentUnitId,
        title: `${topic.title} - Ôn tập cuối học phần`,
        content: lessonContent(topic, 'Ôn tập cuối học phần'),
        sequence,
        kind: 'LESSON',
        status: 'APPROVED',
        createdAt,
      });
      program.currentLessons.push(id);
    }
    if (missing > 0) program.maxSequence += missing;
  }

  private createClassSessions(
    classPlan: ClassPlan,
    history: ReturnType<typeof slotsForRange>,
    current: ReturnType<typeof slotsForRange>,
  ): void {
    const { ctx } = this;
    const program = classPlan.program;
    const generation = (
      term: 'history' | 'current',
      slots: ReturnType<typeof slotsForRange>,
      unitId: string,
    ): string | null => {
      if (!slots.length) return null;
      const id = bulkId(`generation_${classPlan.key}_${term}`);
      const key = `bulk-${classPlan.key}-${term}`;
      const firstDay = new Date(`${slots[0].date}T00:00:00Z`);
      const createdAt = new Date(
        Math.max(
          classPlan.createdAt.getTime() + 2 * HOUR,
          localInstant(addDays(firstDay, -7), 10).getTime(),
        ),
      );
      this.rows.generations.push({
        id,
        classId: classPlan.id,
        unitId,
        actorUserId: ctx.manager.id,
        key,
        requestHash: createHash('sha256').update(key).digest('hex'),
        fromDate: firstDay,
        toDate: term === 'history' ? addDays(ctx.termStart, -1) : classPlan.lastDay,
        createdAt,
      });
      this.audit({
        actorUserId: ctx.manager.id,
        action: 'CLASS_SESSIONS_GENERATED',
        entityType: 'ScheduleGeneration',
        entityId: id,
        afterData: { classId: classPlan.id, unitId, count: slots.length },
        createdAt,
      });
      return id;
    };
    const historyGeneration = generation('history', history, bulkId(`unit_${program.key}_history`));
    const currentGeneration = generation('current', current, program.currentUnitId);
    const last = lastMonthlySlots(current);
    let regularIndex = 0;
    const lessons = [
      ...history.map((slot, index) => ({
        slot,
        lessonId: program.historyLessons[index],
        generationId: historyGeneration,
      })),
      ...current.map((slot, index) => {
        const month = slot.date.slice(0, 7);
        const test = last.get(month) === index ? program.tests.get(month) : undefined;
        return {
          slot,
          lessonId: test ?? program.currentLessons[regularIndex++],
          generationId: currentGeneration,
        };
      }),
    ];
    for (const [index, { slot, lessonId, generationId }] of lessons.entries()) {
      const day = new Date(`${slot.date}T00:00:00Z`);
      let status: SessionStatus = slot.endsAt <= ctx.cutoff ? 'COMPLETED' : 'SCHEDULED';
      let cancelReason: string | null = null;
      let cancelledAt: Date | null = null;
      const holiday = HOLIDAYS[slot.date.slice(5)];
      if (holiday) {
        const announced = new Date(
          Math.max(
            localInstant(addDays(day, -7), 10).getTime(),
            classPlan.createdAt.getTime() + HOUR,
          ),
        );
        if (announced <= ctx.cutoff) {
          status = 'CANCELLED';
          cancelReason = holiday;
          cancelledAt = announced;
        }
      } else if (this.random.chance(0.006)) {
        const when = new Date(slot.startsAt.getTime() - this.random.int(2, 30) * HOUR);
        if (when <= ctx.cutoff && when > classPlan.createdAt) {
          status = 'CANCELLED';
          cancelReason = this.random.pick(CANCEL_REASONS);
          cancelledAt = when;
        }
      }
      const session: SessionPlan = {
        id: bulkId(`session_${classPlan.key}_${index + 1}`),
        classPlan,
        lessonId,
        teacherId: classPlan.teacherId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        day,
        status,
        summary: status === 'COMPLETED' ? this.random.pick(SESSION_SUMMARIES) : null,
        cancelReason,
        cancelledAt,
        generationId,
        seats: 0,
      };
      classPlan.sessions.push(session);
      if (cancelledAt)
        this.audit({
          actorUserId: ctx.manager.id,
          action: 'CLASS_SESSION_CANCELLED',
          entityType: 'ClassSession',
          entityId: session.id,
          afterData: { reason: cancelReason },
          createdAt: cancelledAt,
        });
    }
  }

  // ---------------------------------------------------------------- families and enrollments

  private createFamilies(): void {
    let family = 0;
    while (this.students.length < TARGET_STUDENTS) {
      family++;
      const parentGender: Gender = this.random.chance(0.62) ? 'F' : 'M';
      const person = this.person(parentGender);
      const parent: ParentPlan = {
        id: bulkId(`user_parent_${String(family).padStart(4, '0')}`),
        profileId: bulkId(`parent_${String(family).padStart(4, '0')}`),
        person,
        email: this.email(`${slug(person.fullName)}.${String(family).padStart(3, '0')}`),
        phone: this.phone(),
        children: [],
      };
      const childCount = this.random.weighted([
        [1, 62],
        [2, 32],
        [3, 6],
      ] as const);
      const grades = new Set<number>();
      for (let index = 0; index < childCount; index++) {
        // Siblings are in different grades.
        const grade = this.random.weighted(
          (
            [
              [6, 23],
              [7, 25],
              [8, 27],
              [9, 25],
            ] as const
          ).filter(([value]) => !grades.has(value)),
        );
        grades.add(grade);
        const child = this.person(
          this.random.chance(0.5) ? 'F' : 'M',
          parentGender === 'M' || this.random.chance(0.5) ? person.family : undefined,
        );
        const student: StudentPlan = {
          id: bulkId(`student_${String(this.students.length + 1).padStart(4, '0')}`),
          parent,
          fullName: child.fullName,
          grade,
          dateOfBirth: new Date(
            Date.UTC(
              this.ctx.today.getUTCFullYear() - grade - 5,
              this.random.int(0, 11),
              this.random.int(1, 28),
            ),
          ),
          status: 'ACTIVE',
          absenceRate: this.random.weighted([
            [0.02, 45],
            [0.05, 30],
            [0.1, 18],
            [0.22, 7],
          ] as const),
          ability: 0.45 + (this.random.next() + this.random.next()) * 0.26,
          quitAt: null,
          classes: [],
          packages: [],
          firstOrderAt: null,
          busy: [],
        };
        parent.children.push(student);
        this.students.push(student);
      }
      this.parents.push(parent);
    }
  }

  private createEnrollments(): void {
    const { ctx } = this;
    const subjects = [
      ['math', 45],
      ['physics', 22],
      ['chemistry', 17],
      ['biology', 16],
    ] as const;
    for (const student of this.students) {
      // Some parents created a profile on mobile but have not registered a class yet.
      if (this.random.chance(0.04)) continue;
      const count = this.random.weighted([
        [1, 58],
        [2, 32],
        [3, 10],
      ] as const);
      const chosen: string[] = [];
      while (chosen.length < count) {
        const subject = this.random.weighted(subjects);
        if (!chosen.includes(subject)) chosen.push(subject);
      }
      // Enrollment peaks when the school year starts (month 4 for an October reference date).
      const baseMonth = this.random.weighted([
        [0, 16],
        [1, 13],
        [2, 13],
        [3, 14],
        [4, 25],
        [5, 19],
      ] as const);
      if (this.random.chance(0.05)) {
        const from = addDays(monthStart(ctx.historyStart, baseMonth), 35);
        const to = new Date(ctx.cutoff.getTime() - 2 * DAY);
        if (to > from) student.quitAt = this.workTime(studyDay(this.between(from, to)), 9, 17);
      }
      for (const [index, subject] of chosen.entries()) {
        const month = Math.min(
          5,
          baseMonth +
            (index === 0
              ? 0
              : this.random.weighted([
                  [0, 60],
                  [1, 25],
                  [2, 15],
                ] as const)),
        );
        this.enroll(student, `${subject}-${student.grade}`, this.anchorDay(month));
      }
      // No class for the chosen subjects yet: the family registers when the school year starts.
      for (const subject of ['math', 'physics', 'chemistry', 'biology']) {
        if (student.packages.length) break;
        this.enroll(student, `${subject}-${student.grade}`, this.anchorDay(Math.max(baseMonth, 4)));
      }
      this.retireIfLapsed(student);
      this.applyQuit(student);
    }
    this.createRecentCancelledDrafts();
  }

  /** Staff often close the profile of a family that stopped renewing weeks ago. */
  private retireIfLapsed(student: StudentPlan): void {
    const { ctx } = this;
    const paid = student.packages.filter((pkg) => pkg.confirmedAt);
    if (student.quitAt || !paid.length || paid.length < student.packages.length) return;
    const lastDay = new Date(
      Math.max(...paid.map((pkg) => (pkg.endedAt ? studyDay(pkg.endedAt) : pkg.end).getTime())),
    );
    if (lastDay > addDays(ctx.today, -20) || !this.random.chance(0.5)) return;
    const quitAt = this.workTime(addDays(lastDay, this.random.int(3, 15)), 9, 17);
    if (quitAt < new Date(ctx.cutoff.getTime() - DAY)) student.quitAt = quitAt;
  }

  /** Parents who asked about another subject this week and then cancelled the draft bill. */
  private createRecentCancelledDrafts(): void {
    const { ctx } = this;
    let made = 0;
    for (const student of this.random.shuffle(this.students)) {
      if (made >= 8) break;
      if (student.status !== 'ACTIVE' || !student.packages.some((pkg) => pkg.confirmedAt)) continue;
      const taken = new Set(student.classes.map((item) => item.program.key));
      const classPlan = this.random
        .shuffle(
          this.classes.filter(
            (item) =>
              item.isOpen &&
              item.isActive &&
              item.program.grade === student.grade &&
              !taken.has(item.program.key),
          ),
        )
        .find(
          (item) =>
            !student.classes.some((other) => weeklyConflict(other.schedules, item.schedules)),
        );
      if (!classPlan) continue;
      const createdAt = this.between(
        new Date(ctx.cutoff.getTime() - 7 * DAY),
        new Date(ctx.cutoff.getTime() - 3 * HOUR),
      );
      const start = this.studyDayFrom(classPlan, addDays(studyDay(createdAt), 2));
      if (!start) continue;
      this.cancelledOrder(
        student,
        classPlan,
        start,
        createdAt,
        this.between(new Date(createdAt.getTime() + HOUR), ctx.cutoff),
      );
      made++;
    }
  }

  private anchorDay(month: number): Date {
    const first = monthStart(this.ctx.historyStart, month);
    const day = this.random.chance(0.65) ? first : addDays(first, this.random.int(1, 27));
    return day > addDays(this.ctx.today, 9) ? addDays(this.ctx.today, this.random.int(-5, 9)) : day;
  }

  private enroll(student: StudentPlan, programKey: string, anchor: Date): void {
    const { ctx } = this;
    const candidates = this.random
      .shuffle(
        this.classes.filter(
          (classPlan) =>
            classPlan.program.key === programKey &&
            classPlan.lastDay > addDays(anchor, 21) &&
            classPlan.firstDay <= addDays(anchor, 45) &&
            (classPlan.bulk || anchor >= addDays(ctx.termStart, -7)) &&
            // Closed or paused classes took registrations only before the current term.
            (classPlan.isOpen || anchor < addDays(ctx.termStart, -7)),
        ),
      )
      // Staff place newcomers in a class that is already running and has the most free seats.
      .sort(
        (a, b) =>
          Number(a.firstDay > anchor) - Number(b.firstDay > anchor) ||
          seatsTaken(a, anchor) - seatsTaken(b, anchor),
      );
    for (const classPlan of candidates) {
      if (student.classes.some((other) => weeklyConflict(other.schedules, classPlan.schedules)))
        continue;
      const join = this.studyDayFrom(
        classPlan,
        anchor > classPlan.firstDay ? anchor : classPlan.firstDay,
      );
      if (!join || join > addDays(ctx.today, 10) || join > addDays(classPlan.lastDay, -14))
        continue;
      if (student.quitAt && join >= studyDay(student.quitAt)) continue;
      const chain = this.chain(student, classPlan, join);
      if (
        !chain.length ||
        chain.some(
          (pkg) => peakOccupancy(classPlan.occupancy, pkg.start, pkg.end) >= classPlan.capacity,
        )
      )
        continue;
      for (const pkg of chain) {
        classPlan.occupancy.push({ start: pkg.start, end: pkg.end });
        const number = this.nextId('package').slice(BULK_PREFIX.length + 'package_'.length);
        pkg.orderId = bulkId(`order_${number}`);
        pkg.enrollmentId = bulkId(`enrollment_${number}`);
      }
      student.classes.push(classPlan);
      student.packages.push(...chain);
      this.packages.push(...chain);
      if (this.random.chance(0.07)) this.cancelledDraft(student, classPlan, chain[0]);
      if (!student.firstOrderAt || chain[0].orderCreatedAt < student.firstOrderAt)
        student.firstOrderAt = chain[0].orderCreatedAt;
      // Summer students often move to a regular class once the summer course closes.
      if (!classPlan.isActive && this.random.chance(0.6))
        this.enroll(student, programKey, addDays(classPlan.lastDay, 1));
      return;
    }
  }

  /** Consecutive paid packages until the family stops, the bill is unpaid or the term ends. */
  private chain(student: StudentPlan, classPlan: ClassPlan, join: Date): PackagePlan[] {
    const { ctx } = this;
    const result: PackagePlan[] = [];
    const quitDay = student.quitAt ? studyDay(student.quitAt) : null;
    // A class that filled up was then closed; the API rejects renewals into closed classes,
    // so its students bought one long package while registration was still open.
    const filledUp = classPlan.isActive && !classPlan.isOpen;
    const pickMonths = (): number =>
      classPlan.isActive
        ? this.random.weighted([
            [1, 55],
            [3, 35],
            [6, 10],
          ] as const)
        : 1;
    let months = filledUp ? 6 : pickMonths();
    let start = join;
    for (let renewal = 0; renewal < 24; renewal++) {
      if (quitDay && start >= quitDay) break;
      if (start > addDays(classPlan.lastDay, -14)) break;
      const end = addMonths(start, months);
      let orderCreatedAt: Date;
      let confirmedAt: Date;
      if (renewal === 0) {
        orderCreatedAt = this.workTime(addDays(start, -this.random.int(1, 6)), 8, 18);
        confirmedAt = new Date(
          Math.min(
            orderCreatedAt.getTime() + this.random.int(5, 30 * 60) * MINUTE,
            localInstant(start, 7).getTime(),
          ),
        );
      } else {
        // Staff issue the renewal bill a few days ahead; the family pays before the start date.
        orderCreatedAt = this.workTime(addDays(start, -this.random.int(3, 10)), 8, 17);
        confirmedAt = this.between(
          new Date(orderCreatedAt.getTime() + 10 * MINUTE),
          localInstant(start, 7),
        );
      }
      if (orderCreatedAt > ctx.cutoff) break;
      if (confirmedAt > ctx.cutoff || (student.quitAt && confirmedAt >= student.quitAt)) {
        // Billed but not paid yet: staff can still confirm it because it starts in the future.
        if (
          !student.quitAt &&
          classPlan.isOpen &&
          start > ctx.today &&
          start <= addDays(ctx.today, 14)
        )
          result.push(
            this.newPackage(student, classPlan, start, end, months, orderCreatedAt, null),
          );
        break;
      }
      const pkg = this.newPackage(
        student,
        classPlan,
        start,
        end,
        months,
        orderCreatedAt,
        confirmedAt,
      );
      result.push(pkg);
      if (start < addDays(ctx.today, -10) && this.random.chance(0.012)) {
        const earliest = localInstant(addDays(start, 7));
        const latest = new Date(
          Math.min(localInstant(addDays(end, -1)).getTime(), ctx.cutoff.getTime() - DAY),
        );
        if (latest > earliest) {
          pkg.endedAt = this.workTime(studyDay(this.between(earliest, latest)), 9, 17);
          pkg.endedEarly = true;
          break;
        }
      }
      // The family stops renewing; like the API, the expired enrollment keeps status ACTIVE.
      if (filledUp || (classPlan.isActive && this.random.chance(0.06))) break;
      const next = this.studyDayFrom(classPlan, end);
      if (!next) break;
      start = next;
      if (!this.random.chance(0.7)) months = pickMonths();
    }
    return result;
  }

  private newPackage(
    student: StudentPlan,
    classPlan: ClassPlan,
    start: Date,
    end: Date,
    months: number,
    orderCreatedAt: Date,
    confirmedAt: Date | null,
  ): PackagePlan {
    return {
      orderId: '',
      enrollmentId: '',
      student,
      classPlan,
      start,
      end,
      months,
      orderCreatedAt,
      confirmedAt,
      staffId: this.staffAt(orderCreatedAt),
      endedAt: null,
      endedEarly: false,
      pause: null,
      leaveDays: new Set(),
    };
  }

  private cancelledDraft(student: StudentPlan, classPlan: ClassPlan, first: PackagePlan): void {
    const createdAt = new Date(
      first.orderCreatedAt.getTime() -
        this.random.int(1, 4) * DAY -
        this.random.int(0, 300) * MINUTE,
    );
    const cancelledAt = new Date(createdAt.getTime() + this.random.int(30, 20 * 60) * MINUTE);
    if (cancelledAt > first.orderCreatedAt || cancelledAt > this.ctx.cutoff) return;
    this.cancelledOrder(student, classPlan, first.start, createdAt, cancelledAt);
  }

  private cancelledOrder(
    student: StudentPlan,
    classPlan: ClassPlan,
    start: Date,
    createdAt: Date,
    cancelledAt: Date,
  ): void {
    const id = this.nextId('order_cancelled', 4);
    const staffId = this.staffAt(createdAt);
    this.rows.orders.push({
      ...this.orderBase(student, classPlan, start, addMonths(start, 1), 1),
      id,
      status: 'CANCELLED',
      createdByManagerId: staffId,
      createdAt,
      updatedAt: cancelledAt,
    });
    this.audit({
      actorUserId: staffId,
      action: 'REGISTRATION_CANCEL_DRAFT',
      entityType: 'RegistrationOrder',
      entityId: id,
      createdAt: cancelledAt,
    });
    if (!student.firstOrderAt || createdAt < student.firstOrderAt) student.firstOrderAt = createdAt;
  }

  /** Mirrors the staff "end study" action: every open enrollment ends at the same instant. */
  private applyQuit(student: StudentPlan): void {
    const quitAt = student.quitAt;
    if (!quitAt) return;
    const paid = student.packages.filter(
      (pkg) => pkg.confirmedAt && pkg.confirmedAt < quitAt && localInstant(pkg.start) < quitAt,
    );
    if (!paid.length) {
      student.quitAt = null;
      return;
    }
    student.status = 'INACTIVE';
    let futureSessions = 0;
    const ended: string[] = [];
    for (const pkg of student.packages) {
      if (!pkg.confirmedAt || pkg.endedAt) continue;
      if (pkg.start <= studyDay(quitAt) && studyDay(quitAt) < pkg.end)
        futureSessions += pkg.classPlan.sessions.filter(
          (session) =>
            session.status !== 'CANCELLED' && session.startsAt > quitAt && session.day < pkg.end,
        ).length;
      pkg.endedAt = quitAt;
      ended.push(pkg.enrollmentId);
    }
    this.audit({
      actorUserId: this.staffAt(quitAt),
      action: 'STUDENT_END_STUDY',
      entityType: 'StudentProfile',
      entityId: student.id,
      afterData: {
        enrollmentIds: ended,
        pendingLeavesCancelled: 0,
        makeupsCancelled: 0,
        futureSessionsCancelled: futureSessions,
      },
      createdAt: quitAt,
    });
  }

  // ---------------------------------------------------------------- operations

  private createSubstitutions(): void {
    const { ctx } = this;
    const horizon = ctx.cutoff.getTime() + 7 * DAY;
    const assigned = new Map<string, Interval[]>();
    for (const classPlan of this.classes.filter((item) => item.bulk)) {
      for (const session of classPlan.sessions) {
        if (session.status === 'CANCELLED' || session.startsAt.getTime() > horizon) continue;
        if (!this.random.chance(0.04)) continue;
        const assignedAt = new Date(
          Math.min(
            session.startsAt.getTime() - this.random.int(10, 60) * HOUR,
            ctx.cutoff.getTime(),
          ),
        );
        if (assignedAt <= classPlan.createdAt) continue;
        const slot = [
          {
            weekday: session.day.getUTCDay() || 7,
            startTime: localTime(session.startsAt),
            endTime: localTime(session.endsAt),
          },
        ];
        const substitute = this.random
          .shuffle(this.teachers)
          .find(
            (teacher) =>
              !teacher.disabledAt &&
              teacher.subjectKey === classPlan.program.subjectKey &&
              teacher.id !== classPlan.teacherId &&
              teacher.createdAt < assignedAt &&
              !weeklyConflict(teacher.weekly, slot) &&
              !(assigned.get(teacher.id) ?? []).some(
                (item) => item.start < session.endsAt && item.end > session.startsAt,
              ),
          );
        if (!substitute) continue;
        assigned.set(substitute.id, [
          ...(assigned.get(substitute.id) ?? []),
          { start: session.startsAt, end: session.endsAt },
        ]);
        session.teacherId = substitute.id;
        this.audit({
          actorUserId: ctx.manager.id,
          action: 'SESSION_SUBSTITUTE_ASSIGNED',
          entityType: 'ClassSession',
          entityId: session.id,
          beforeData: { teacherId: classPlan.teacherId },
          afterData: { teacherId: substitute.id, reason: this.random.pick(SUBSTITUTE_REASONS) },
          createdAt: assignedAt,
        });
      }
    }
  }

  /** Approved period pauses excuse every session in the range, like the leave decision API. */
  private createPauses(): void {
    const { ctx } = this;
    let made = 0;
    let endedEarly = false;
    for (const pkg of this.random.shuffle(this.packages)) {
      if (made >= 10) break;
      if (!pkg.confirmedAt || !pkg.classPlan.bulk) continue;
      const until = pkg.endedAt ? studyDay(pkg.endedAt) : pkg.end;
      const earliest = addDays(pkg.start, 7);
      const latest = addDays(until, -16);
      if (latest <= earliest) continue;
      const from = addDays(
        earliest,
        this.random.int(0, (latest.getTime() - earliest.getTime()) / DAY),
      );
      let to = addDays(from, this.random.int(6, 13));
      const createdAt = this.workTime(addDays(from, -this.random.int(3, 8)), 19, 22);
      if (createdAt < pkg.confirmedAt || createdAt > ctx.cutoff) continue;
      const decidedAt = new Date(createdAt.getTime() + this.random.int(30, 18 * 60) * MINUTE);
      const status: LeaveStatus = decidedAt <= ctx.cutoff ? 'APPROVED' : 'PENDING';
      const reason = this.random.pick(PAUSE_REASONS);
      const id = this.nextId('leave', 4);
      if (
        status === 'APPROVED' &&
        !endedEarly &&
        to < ctx.today &&
        to.getTime() - from.getTime() >= 9 * DAY
      ) {
        const shortened = addDays(from, this.random.int(3, 5));
        const at = localInstant(addDays(shortened, 1), 9, 10);
        if (at <= ctx.cutoff) {
          this.audit({
            actorUserId: this.staffAt(at),
            action: 'LEAVE_END_EARLY',
            entityType: 'LeaveRequest',
            entityId: id,
            beforeData: { toDate: to.toISOString() },
            afterData: {
              toDate: shortened.toISOString(),
              reason: 'Học sinh đã khỏe, phụ huynh xin cho con đi học lại sớm.',
            },
            createdAt: at,
          });
          to = shortened;
          endedEarly = true;
        }
      }
      pkg.pause = {
        id,
        from,
        to,
        status,
        createdAt,
        decidedAt: status === 'APPROVED' ? decidedAt : null,
        reason,
      };
      made++;
    }
  }

  private createParticipants(): void {
    const byClass = new Map<ClassPlan, PackagePlan[]>();
    for (const pkg of this.packages)
      if (pkg.confirmedAt) byClass.set(pkg.classPlan, [...(byClass.get(pkg.classPlan) ?? []), pkg]);
    for (const [classPlan, packages] of byClass) {
      for (const session of classPlan.sessions) {
        if (session.status === 'CANCELLED') continue;
        for (const pkg of packages) {
          if (session.day < pkg.start || session.day >= pkg.end) continue;
          if (pkg.endedAt && session.startsAt >= pkg.endedAt) continue;
          const paused =
            pkg.pause?.status === 'APPROVED' &&
            session.day >= pkg.pause.from &&
            session.day <= pkg.pause.to;
          const attendance: Attendance = paused
            ? 'EXCUSED'
            : session.status === 'COMPLETED'
              ? this.random.chance(pkg.student.absenceRate)
                ? 'ABSENT'
                : 'PRESENT'
              : 'UNMARKED';
          this.participants.push({
            id: this.nextId('participant', 6),
            session,
            pkg,
            kind: 'REGULAR',
            attendance,
          });
          if (attendance !== 'EXCUSED') session.seats++;
          pkg.student.busy.push({ start: session.startsAt, end: session.endsAt });
        }
      }
    }
  }

  private createSingleLeaves(): void {
    const { ctx } = this;
    for (const participant of this.participants) {
      const { session, pkg } = participant;
      const absent = participant.attendance === 'ABSENT';
      const declined = participant.attendance === 'PRESENT' && this.random.chance(0.0025);
      if (!declined && !(absent && this.random.chance(0.35))) continue;
      const createdAt = this.workTime(addDays(session.day, -this.random.int(1, 3)), 18, 22);
      if (createdAt < pkg.confirmedAt! || createdAt >= session.startsAt) continue;
      const decidedAt = new Date(
        Math.min(
          createdAt.getTime() + this.random.int(20, 600) * MINUTE,
          session.startsAt.getTime() - 30 * MINUTE,
        ),
      );
      this.singleLeave(participant, declined ? 'REJECTED' : 'APPROVED', createdAt, decidedAt);
    }
    const horizon = ctx.cutoff.getTime() + 14 * DAY;
    const upcoming = this.random.shuffle(
      this.participants.filter(
        (participant) =>
          participant.attendance === 'UNMARKED' &&
          participant.session.startsAt > ctx.cutoff &&
          participant.session.startsAt.getTime() <= horizon &&
          participant.pkg.student.status === 'ACTIVE',
      ),
    );
    const statuses: LeaveStatus[] = [
      ...Array<LeaveStatus>(24).fill('PENDING'),
      ...Array<LeaveStatus>(10).fill('APPROVED'),
      ...Array<LeaveStatus>(5).fill('REJECTED'),
      ...Array<LeaveStatus>(5).fill('CANCELLED'),
    ];
    for (const [index, status] of statuses.entries()) {
      const participant = upcoming[index];
      if (!participant) break;
      const createdAt = this.between(
        new Date(
          Math.max(ctx.cutoff.getTime() - 72 * HOUR, participant.pkg.confirmedAt!.getTime()),
        ),
        new Date(ctx.cutoff.getTime() - 5 * MINUTE),
      );
      this.singleLeave(participant, status, createdAt, this.between(createdAt, ctx.cutoff));
    }
  }

  private singleLeave(
    participant: ParticipantPlan,
    status: LeaveStatus,
    createdAt: Date,
    decidedAt: Date,
  ): void {
    const { session, pkg } = participant;
    const id = this.nextId('leave', 4);
    const decidedBy = status === 'PENDING' ? null : this.staffAt(decidedAt);
    pkg.leaveDays.add(dateOnly(session.day));
    this.rows.leaves.push({
      id,
      enrollmentId: pkg.enrollmentId,
      sessionId: session.id,
      kind: 'SINGLE_ABSENCE',
      fromDate: session.day,
      toDate: session.day,
      reason: this.random.pick(LEAVE_REASONS),
      requestedById: pkg.student.parent.id,
      decidedById: decidedBy,
      decisionNote:
        status === 'REJECTED'
          ? this.random.pick(DECLINE_NOTES)
          : status === 'CANCELLED'
            ? 'Phụ huynh đã hủy yêu cầu.'
            : null,
      status,
      createdAt,
    });
    if (status === 'APPROVED' && decidedBy)
      this.audit({
        actorUserId: decidedBy,
        action: 'LEAVE_APPROVED',
        entityType: 'LeaveRequest',
        entityId: id,
        createdAt: decidedAt,
      });
  }

  /** Absent students catch up on the same lesson in a parallel class session. */
  private createMakeups(): void {
    const { ctx } = this;
    const byLesson = new Map<string, SessionPlan[]>();
    for (const classPlan of this.classes)
      for (const session of classPlan.sessions)
        if (session.status !== 'CANCELLED')
          byLesson.set(session.lessonId, [...(byLesson.get(session.lessonId) ?? []), session]);
    const sources = this.random
      .shuffle(this.participants.filter((item) => item.attendance === 'ABSENT'))
      .slice(0, 90);
    for (const source of sources) {
      const { session, pkg } = source;
      const student = pkg.student;
      const target = (byLesson.get(session.lessonId) ?? [])
        .filter(
          (candidate) =>
            candidate.classPlan !== session.classPlan &&
            candidate.startsAt.getTime() > session.endsAt.getTime() + 12 * HOUR &&
            candidate.startsAt.getTime() <= session.startsAt.getTime() + 21 * DAY &&
            candidate.day >= pkg.start &&
            candidate.day < pkg.end &&
            (!pkg.endedAt || candidate.startsAt < pkg.endedAt) &&
            candidate.seats < candidate.classPlan.capacity &&
            !pkg.leaveDays.has(dateOnly(candidate.day)) &&
            !(pkg.pause && candidate.day >= pkg.pause.from && candidate.day <= pkg.pause.to) &&
            !student.busy.some(
              (item) => item.start < candidate.endsAt && item.end > candidate.startsAt,
            ),
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      if (!target) continue;
      const earliest = new Date(session.endsAt.getTime() + HOUR);
      const latest = new Date(
        Math.min(
          target.startsAt.getTime() - HOUR,
          ctx.cutoff.getTime(),
          earliest.getTime() + 2 * DAY,
        ),
      );
      if (latest <= earliest) continue;
      const createdAt = this.between(earliest, latest);
      const status =
        target.status === 'COMPLETED'
          ? this.random.chance(0.85)
            ? 'COMPLETED'
            : 'MISSED'
          : 'BOOKED';
      const replacement: ParticipantPlan = {
        id: this.nextId('participant', 6),
        session: target,
        pkg,
        kind: 'MAKEUP',
        attendance:
          status === 'COMPLETED' ? 'PRESENT' : status === 'MISSED' ? 'ABSENT' : 'UNMARKED',
      };
      this.participants.push(replacement);
      target.seats++;
      student.busy.push({ start: target.startsAt, end: target.endsAt });
      this.rows.makeups.push({
        id: this.nextId('makeup', 4),
        originalParticipantId: source.id,
        activeOriginalId: status === 'MISSED' ? null : source.id,
        replacementParticipantId: replacement.id,
        managerId: this.staffAt(createdAt),
        status,
        createdAt,
      });
    }
  }

  private createAssessments(): void {
    const { ctx } = this;
    const otherSummaries = Object.values(TOPICS)
      .flat()
      .map((topic) => topic.summary);
    const byClass = new Map<ClassPlan, PackagePlan[]>();
    for (const pkg of this.packages)
      if (pkg.confirmedAt) byClass.set(pkg.classPlan, [...(byClass.get(pkg.classPlan) ?? []), pkg]);
    for (const classPlan of this.classes.filter((item) => item.bulk)) {
      const topics = TOPICS[classPlan.program.key];
      for (let month = 0; month <= 5; month++) {
        const first = monthStart(ctx.historyStart, month);
        const createdAt = localInstant(
          addDays(first, this.random.int(7, 11)),
          20,
          this.random.int(0, 59),
        );
        const createdDay = studyDay(createdAt);
        if (
          createdAt > ctx.cutoff ||
          createdDay < addDays(classPlan.firstDay, 5) ||
          createdDay > classPlan.lastDay
        )
          continue;
        const recipients = (byClass.get(classPlan) ?? []).filter(
          (pkg) =>
            pkg.start <= createdDay &&
            createdDay < pkg.end &&
            (!pkg.endedAt || pkg.endedAt > createdAt),
        );
        if (!recipients.length) continue;
        const dueAt = localInstant(addDays(createdDay, 7), 22);
        const closed = dueAt < ctx.cutoff;
        const topic = topics[(month + hash(classPlan.key)) % topics.length];
        const assignmentId = this.nextId('assignment', 4);
        const publishAt = localInstant(addDays(createdDay, 7 + this.random.int(1, 3)), 20);
        const published = closed && publishAt <= ctx.cutoff;
        this.rows.assignments.push({
          id: assignmentId,
          classId: classPlan.id,
          teacherId: classPlan.teacherId,
          kind: 'HOMEWORK',
          title: `${topic.title} - Bài tập tháng ${first.getUTCMonth() + 1}/${first.getUTCFullYear()}`,
          instructions:
            'Làm đủ hai câu. Câu tự luận trình bày từng bước, ghi rõ công thức hoặc lập luận đã dùng.',
          dueAt,
          maxAttempts: 1,
          status: closed ? 'CLOSED' : 'PUBLISHED',
          answersPublishedAt: published ? publishAt : null,
          createdAt,
        });
        const choiceId = bulkId(`question_${assignmentId.slice(BULK_PREFIX.length)}_1`);
        const essayId = bulkId(`question_${assignmentId.slice(BULK_PREFIX.length)}_2`);
        const distractors = this.random
          .shuffle(otherSummaries.filter((summary) => summary !== topic.summary))
          .slice(0, 3);
        this.rows.questions.push(
          {
            id: choiceId,
            assignmentId,
            position: 0,
            kind: 'MULTIPLE_CHOICE',
            prompt: `Nội dung nào thuộc chủ đề "${topic.title}"?`,
            choices: this.random.shuffle([topic.summary, ...distractors]),
            correctAnswer: topic.summary,
            maxScore: 4,
          },
          {
            id: essayId,
            assignmentId,
            position: 1,
            kind: 'ESSAY',
            prompt: `${topic.exercise} Trình bày lời giải đầy đủ.`,
            correctAnswer: topic.answer,
            rubric: 'Lập luận đúng: 3 điểm; tính toán đúng: 2 điểm; kết luận rõ ràng: 1 điểm.',
            maxScore: 6,
          },
        );
        for (const pkg of recipients) {
          const recipientId = this.nextId('recipient', 5);
          this.rows.recipients.push({
            id: recipientId,
            assignmentId,
            enrollmentId: pkg.enrollmentId,
          });
          const { ability } = pkg.student;
          if (!this.random.chance(0.6 + 0.35 * ability)) continue;
          const submittedAt = this.between(
            new Date(createdAt.getTime() + 6 * HOUR),
            new Date(Math.min(dueAt.getTime() - HOUR, ctx.cutoff.getTime())),
          );
          if (submittedAt > ctx.cutoff || submittedAt >= dueAt) continue;
          const correct = this.random.chance(ability);
          const essayScore =
            Math.round(
              Math.min(1, Math.max(0.2, ability + (this.random.next() - 0.5) * 0.3)) * 12,
            ) / 2;
          const submissionId = this.nextId('submission', 5);
          this.rows.submissions.push({
            id: submissionId,
            recipientId,
            attemptNo: 1,
            answers: [
              { questionId: choiceId, answer: correct ? topic.summary : distractors[0] },
              {
                questionId: essayId,
                answer:
                  ability > 0.7
                    ? `Lời giải: ${topic.answer} Em đã kiểm tra lại kết quả.`
                    : `Em làm được một phần: ${topic.answer}`,
              },
            ],
            submittedAt,
          });
          const scores = [
            { questionId: choiceId, score: correct ? 4 : 0 },
            { questionId: essayId, score: essayScore },
          ];
          let status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | null = null;
          let gradedAt = new Date(submittedAt.getTime() + this.random.int(2, 30) * HOUR);
          if (closed) {
            status = published ? 'PUBLISHED' : 'APPROVED';
            gradedAt = published
              ? publishAt
              : new Date(Math.min(gradedAt.getTime(), ctx.cutoff.getTime()));
          } else if (this.random.chance(0.45) && gradedAt <= ctx.cutoff) status = 'DRAFT';
          if (!status) continue;
          this.rows.grades.push({
            id: this.nextId('grade', 5),
            submissionId,
            revision: 1,
            reviewerId: classPlan.teacherId,
            status,
            scores,
            totalScore: scores[0].score + scores[1].score,
            feedback: this.random.pick(GRADE_FEEDBACK),
            publishedAt: status === 'PUBLISHED' ? publishAt : null,
            createdAt: gradedAt,
          });
        }
      }
    }
  }

  private createAnnouncements(): void {
    const { ctx } = this;
    for (const classPlan of this.classes.filter((item) => item.bulk)) {
      const notices: { title: string; content: string; createdAt: Date }[] = [
        {
          title: `Chào mừng học sinh lớp ${classPlan.name}`,
          content: `Lớp học ${classPlan.schedules.map((slot) => `${weekdayName(slot.weekday)} ${slot.startTime}-${slot.endTime}`).join(', ')}. Học sinh mang vở ghi, máy tính cầm tay và đến trước giờ học 10 phút.`,
          createdAt: localInstant(addDays(classPlan.firstDay, -3), 10),
        },
      ];
      for (const session of classPlan.sessions)
        if (session.cancelledAt && session.cancelReason && HOLIDAYS[dateOnly(session.day).slice(5)])
          notices.push({
            title: `Lịch nghỉ lễ ngày ${dateOnly(session.day).slice(8)}/${dateOnly(session.day).slice(5, 7)}`,
            content: `${session.cancelReason} Lớp học bình thường vào buổi kế tiếp theo lịch tuần.`,
            createdAt: session.cancelledAt,
          });
      const extra = this.random.pick(ANNOUNCEMENTS);
      notices.push({
        ...extra,
        createdAt: this.workTime(
          studyDay(this.between(localInstant(addDays(classPlan.firstDay, 10)), ctx.cutoff)),
          9,
          17,
        ),
      });
      for (const notice of notices) {
        if (notice.createdAt > ctx.cutoff || notice.createdAt < classPlan.createdAt) continue;
        this.rows.announcements.push({
          id: this.nextId('announcement', 4),
          classId: classPlan.id,
          managerId: ctx.manager.id,
          title: notice.title,
          content: notice.content,
          createdAt: notice.createdAt,
        });
      }
    }
  }

  // ---------------------------------------------------------------- rows

  private writePeople(): void {
    const { ctx } = this;
    for (const teacher of this.teachers) {
      this.rows.users.push({
        id: teacher.id,
        email: teacher.email,
        passwordHash: this.passwordHash,
        displayName: `${teacher.fullName} - Giáo viên ${teacher.subjectName}`,
        role: 'TEACHER',
        status: teacher.disabledAt ? 'DISABLED' : 'ACTIVE',
        emailVerifiedAt: teacher.createdAt,
        createdAt: teacher.createdAt,
        updatedAt: teacher.disabledAt ?? teacher.createdAt,
      });
      this.audit({
        actorUserId: ctx.manager.id,
        action: 'TEACHER_ACCOUNT_CREATE',
        entityType: 'User',
        entityId: teacher.id,
        afterData: { email: teacher.email, role: 'TEACHER' },
        createdAt: teacher.createdAt,
      });
      if (teacher.disabledAt) {
        const displayName = `${teacher.fullName} - Giáo viên ${teacher.subjectName}`;
        this.audit({
          actorUserId: ctx.manager.id,
          action: 'TEACHER_ACCOUNT_UPDATE',
          entityType: 'User',
          entityId: teacher.id,
          beforeData: { displayName, status: 'ACTIVE' },
          afterData: { displayName, status: 'DISABLED' },
          createdAt: teacher.disabledAt,
        });
      }
    }
    let unverified = 0;
    for (const parent of this.parents) {
      const registered = parent.children.some((child) => child.firstOrderAt);
      const firstOrder = Math.min(
        ...parent.children.map((child) => child.firstOrderAt?.getTime() ?? Infinity),
      );
      const createdAt = Number.isFinite(firstOrder)
        ? new Date(firstOrder - this.random.int(2, 20) * DAY - this.random.int(0, 600) * MINUTE)
        : this.workTime(addDays(ctx.today, -this.random.int(1, 25)), 7, 21);
      const safeCreatedAt =
        createdAt > ctx.cutoff ? new Date(ctx.cutoff.getTime() - HOUR) : createdAt;
      const verified = registered || unverified >= 3 || !this.random.chance(0.4);
      if (!verified) unverified++;
      this.rows.users.push({
        id: parent.id,
        email: parent.email,
        passwordHash: this.passwordHash,
        displayName: parent.person.fullName,
        role: 'PARENT',
        status: 'ACTIVE',
        emailVerifiedAt: verified
          ? new Date(safeCreatedAt.getTime() + this.random.int(3, 90) * MINUTE)
          : null,
        createdAt: safeCreatedAt,
        updatedAt: safeCreatedAt,
      });
      this.rows.parentProfiles.push({
        id: parent.profileId,
        userId: parent.id,
        phone: parent.phone,
        createdAt: safeCreatedAt,
        updatedAt: safeCreatedAt,
      });
      for (const student of parent.children) {
        const latest = student.firstOrderAt
          ? new Date(student.firstOrderAt.getTime() - HOUR)
          : ctx.cutoff;
        const createdAt = this.between(new Date(safeCreatedAt.getTime() + 10 * MINUTE), latest);
        this.rows.studentProfiles.push({
          id: student.id,
          parentProfileId: parent.profileId,
          fullName: student.fullName,
          grade: student.grade,
          dateOfBirth: student.dateOfBirth,
          status: student.status,
          createdAt,
          updatedAt: student.quitAt ?? createdAt,
        });
      }
    }
  }

  private writeClasses(): void {
    const { ctx } = this;
    for (const classPlan of this.classes) {
      if (!classPlan.bulk) continue;
      const updatedAt = classPlan.scheduleConfirmedAt ?? classPlan.createdAt;
      this.rows.classes.push({
        id: classPlan.id,
        programId: classPlan.program.id,
        name: classPlan.name,
        capacity: classPlan.capacity,
        isOpen: classPlan.isOpen,
        isActive: classPlan.isActive,
        monthlyFee: String(classPlan.fee),
        teacherId: classPlan.teacherId,
        roomId: classPlan.roomId,
        scheduleConfirmedAt: classPlan.scheduleConfirmedAt,
        scheduleConfirmedById: classPlan.scheduleConfirmedAt ? ctx.manager.id : null,
        createdAt: classPlan.createdAt,
        updatedAt,
      });
      for (const slot of classPlan.schedules)
        this.rows.weeklySchedules.push({
          id: `${classPlan.id}_weekday_${slot.weekday}`,
          classId: classPlan.id,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          createdAt: classPlan.createdAt,
          updatedAt: classPlan.createdAt,
        });
      if (classPlan.scheduleConfirmedAt)
        this.audit({
          actorUserId: ctx.manager.id,
          action: 'CLASS_SCHEDULE_CONFIRMED',
          entityType: 'Class',
          entityId: classPlan.id,
          afterData: { confirmed: true, reason: null },
          createdAt: classPlan.scheduleConfirmedAt,
        });
      for (const session of classPlan.sessions)
        this.rows.sessions.push({
          id: session.id,
          classId: classPlan.id,
          lessonId: session.lessonId,
          teacherId: session.teacherId,
          roomId: classPlan.roomId,
          generationId: session.generationId,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          status: session.status,
          summary: session.summary,
          cancelReason: session.cancelReason,
          cancelledAt: session.cancelledAt,
        });
    }
  }

  private writeEnrollments(): void {
    let receipt = 0;
    const paid = this.packages
      .filter((pkg) => pkg.confirmedAt)
      .sort((a, b) => a.confirmedAt!.getTime() - b.confirmedAt!.getTime());
    const failed = new Set(paid.slice(-3).map((pkg) => pkg.orderId));
    for (const pkg of this.packages) {
      const { student, classPlan } = pkg;
      const base = this.orderBase(student, classPlan, pkg.start, pkg.end, pkg.months);
      const confirmedAt = pkg.confirmedAt;
      this.rows.orders.push({
        ...base,
        id: pkg.orderId,
        status: confirmedAt ? 'COMPLETED' : 'DRAFT',
        createdByManagerId: pkg.staffId,
        confirmedAt,
        linkedAt: confirmedAt,
        createdAt: pkg.orderCreatedAt,
        updatedAt: confirmedAt ?? pkg.orderCreatedAt,
      });
      if (!confirmedAt) continue;
      receipt++;
      const receiptNumber = `RCPT-${localStamp(confirmedAt)}-B${String(receipt).padStart(5, '0')}`;
      const paymentId = bulkId(`payment_${pkg.orderId.slice(-5)}`);
      this.rows.payments.push({
        id: paymentId,
        registrationOrderId: pkg.orderId,
        amount: base.quotedAmount,
        currency: 'VND',
        status: 'CONFIRMED',
        confirmedByManagerId: pkg.staffId,
        confirmedAt,
        receiptNumber,
        createdAt: confirmedAt,
      });
      this.rows.enrollments.push({
        id: pkg.enrollmentId,
        registrationOrderId: pkg.orderId,
        studentProfileId: student.id,
        classId: classPlan.id,
        packageMonths: pkg.months,
        status: pkg.endedAt ? 'ENDED' : 'ACTIVE',
        startDate: pkg.start,
        endDate: pkg.end,
        activatedAt: confirmedAt,
        endedAt: pkg.endedAt,
        createdAt: confirmedAt,
        updatedAt: pkg.endedAt ?? confirmedAt,
      });
      const effectiveFrom = localInstant(pkg.start);
      this.rows.placements.push({
        id: bulkId(`placement_${pkg.enrollmentId.slice(-5)}`),
        enrollmentId: pkg.enrollmentId,
        classId: classPlan.id,
        effectiveFrom,
        effectiveTo: pkg.endedAt
          ? pkg.endedAt > effectiveFrom
            ? pkg.endedAt
            : effectiveFrom
          : null,
      });
      this.audit({
        actorUserId: pkg.staffId,
        action: 'REGISTRATION_CONFIRM_PAYMENT',
        entityType: 'RegistrationOrder',
        entityId: pkg.orderId,
        afterData: { paymentId, enrollmentId: pkg.enrollmentId },
        createdAt: confirmedAt,
      });
      if (pkg.endedEarly && pkg.endedAt)
        this.audit({
          actorUserId: this.staffAt(pkg.endedAt),
          action: 'ENROLLMENT_END',
          entityType: 'Enrollment',
          entityId: pkg.enrollmentId,
          afterData: {
            pendingLeavesCancelled: 0,
            makeupsCancelled: 0,
            futureSessionsCancelled: classPlan.sessions.filter(
              (session) =>
                session.status !== 'CANCELLED' &&
                session.startsAt > pkg.endedAt! &&
                session.day < pkg.end,
            ).length,
          },
          createdAt: pkg.endedAt,
        });
      const isFailed = failed.has(pkg.orderId);
      this.rows.emails.push({
        id: bulkId(`email_${pkg.orderId.slice(-5)}`),
        eventType: 'PAYMENT_CONFIRMED',
        aggregateType: 'RegistrationOrder',
        aggregateId: pkg.orderId,
        recipient: student.parent.email,
        subject: `EduGrade - Xác nhận thanh toán cho ${student.fullName}`,
        dedupeKey: `PAYMENT_CONFIRMED:${pkg.orderId}`,
        payload: {
          text: `Đã xác nhận thanh toán ${receiptNumber} cho ${student.fullName}. Môn: ${classPlan.program.subjectName}. Lớp: ${classPlan.name}. Lịch học: ${classPlan.schedules.map((slot) => `thứ ${slot.weekday}, ${slot.startTime}-${slot.endTime}`).join('; ')}. Số tiền: ${String(base.quotedAmount)} VND.`,
        },
        status: isFailed ? 'FAILED' : 'SENT',
        attemptCount: isFailed ? 5 : 1,
        maxAttempts: 5,
        nextAttemptAt: confirmedAt,
        lastError: isFailed ? 'Dữ liệu demo: máy chủ SMTP từ chối kết nối.' : null,
        createdAt: confirmedAt,
        sentAt: isFailed ? null : new Date(confirmedAt.getTime() + MINUTE),
      });
      if (pkg.pause)
        this.rows.leaves.push({
          id: pkg.pause.id,
          enrollmentId: pkg.enrollmentId,
          kind: 'PERIOD_PAUSE',
          fromDate: pkg.pause.from,
          toDate: pkg.pause.to,
          reason: pkg.pause.reason,
          requestedById: student.parent.id,
          decidedById: pkg.pause.decidedAt ? this.staffAt(pkg.pause.decidedAt) : null,
          decisionNote: pkg.pause.decidedAt
            ? 'Đã ghi nhận tạm nghỉ; giữ nguyên thời hạn gói học.'
            : null,
          status: pkg.pause.status,
          createdAt: pkg.pause.createdAt,
        });
      if (pkg.pause?.decidedAt)
        this.audit({
          actorUserId: this.staffAt(pkg.pause.decidedAt),
          action: 'LEAVE_APPROVED',
          entityType: 'LeaveRequest',
          entityId: pkg.pause.id,
          createdAt: pkg.pause.decidedAt,
        });
    }
    for (const participant of this.participants)
      this.rows.participants.push({
        id: participant.id,
        sessionId: participant.session.id,
        enrollmentId: participant.pkg.enrollmentId,
        kind: participant.kind,
        attendance: participant.attendance,
        cancelled: false,
      });
  }

  private orderBase(
    student: StudentPlan,
    classPlan: ClassPlan,
    start: Date,
    end: Date,
    months: number,
  ): Omit<Prisma.RegistrationOrderCreateManyInput, 'createdByManagerId'> & {
    quotedAmount: string;
  } {
    const parent = student.parent;
    return {
      type: 'EXISTING_STUDENT_NEW_SUBJECT',
      parentEmail: parent.email,
      parentPhone: parent.phone,
      studentFullName: student.fullName,
      studentGrade: student.grade,
      targetStudentId: student.id,
      classId: classPlan.id,
      packageMonths: months,
      quotedAmount: String(classPlan.fee * months),
      billSnapshot: {
        parent: { displayName: parent.person.fullName, email: parent.email, phone: parent.phone },
        student: { id: student.id, fullName: student.fullName, grade: student.grade },
        class: {
          id: classPlan.id,
          name: classPlan.name,
          subject: classPlan.program.subjectName,
          grade: classPlan.program.grade,
          schedules: classPlan.schedules.map(({ weekday, startTime, endTime }) => ({
            weekday,
            startTime,
            endTime,
          })),
        },
        monthlyFee: String(classPlan.fee),
      },
      currency: 'VND',
      startDate: start,
      endDate: end,
    };
  }

  /** Self-service profile edits and manager corrections spread over the six months. */
  private createAccountActivity(): void {
    const { ctx } = this;
    const parents = this.rows.users.filter(
      (user) => user.role === 'PARENT' && user.emailVerifiedAt,
    );
    for (const user of this.random.shuffle(parents).slice(0, 24)) {
      const at = this.between(new Date((user.createdAt as Date).getTime() + DAY), ctx.cutoff);
      this.audit({
        actorUserId: user.id!,
        action: this.random.chance(0.6) ? 'PROFILE_UPDATED' : 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id!,
        createdAt: at,
      });
    }
    for (const parent of this.random.shuffle(this.parents).slice(0, 6)) {
      const user = this.rows.users.find((item) => item.id === parent.id)!;
      const at = this.between(new Date((user.createdAt as Date).getTime() + 2 * DAY), ctx.cutoff);
      const profile = this.rows.parentProfiles.find((item) => item.id === parent.profileId)!;
      const phone = this.phone();
      this.audit({
        actorUserId: ctx.manager.id,
        action: 'PARENT_ACCOUNT_UPDATE',
        entityType: 'User',
        entityId: parent.id,
        beforeData: { displayName: parent.person.fullName, status: 'ACTIVE', phone: parent.phone },
        afterData: { phone },
        createdAt: at,
      });
      if (at <= ctx.cutoff) {
        profile.phone = phone;
        profile.updatedAt = at;
      }
    }
  }

  private writeAudits(): void {
    const ordered = this.audits
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) => a.entry.createdAt.getTime() - b.entry.createdAt.getTime() || a.index - b.index,
      );
    for (const { entry } of ordered)
      this.rows.audits.push({ id: this.nextId('audit', 6), ...entry });
    this.rows.audits.push({
      id: bulkId('manifest'),
      actorUserId: this.ctx.manager.id,
      action: 'DEMO_SEED_CREATED',
      entityType: 'DemoDataset',
      entityId: 'dashboard-v1',
      afterData: {
        referenceDate: dateOnly(this.ctx.today),
        generatedAt: this.ctx.cutoff.toISOString(),
        version: 1,
        rows: rowCounts(this.rows),
      },
      // Dated before the six-month window so it never shows up as recent activity.
      createdAt: localInstant(addDays(this.ctx.historyStart, -45), 9),
    });
  }
}

async function insertRows(tx: Prisma.TransactionClient, rows: PlanRows): Promise<void> {
  const write = async <T>(items: T[], create: (data: T[]) => Promise<unknown>): Promise<void> => {
    for (let index = 0; index < items.length; index += CHUNK)
      await create(items.slice(index, index + CHUNK));
  };
  await write(rows.users, (data) => tx.user.createMany({ data }));
  await write(rows.parentProfiles, (data) => tx.parentProfile.createMany({ data }));
  await write(rows.studentProfiles, (data) => tx.studentProfile.createMany({ data }));
  await write(rows.rooms, (data) => tx.room.createMany({ data }));
  await write(rows.classes, (data) => tx.class.createMany({ data }));
  await write(rows.weeklySchedules, (data) => tx.classWeeklySchedule.createMany({ data }));
  await write(rows.units, (data) => tx.curriculumUnit.createMany({ data }));
  await write(rows.lessons, (data) => tx.lesson.createMany({ data }));
  await write(rows.generations, (data) => tx.scheduleGeneration.createMany({ data }));
  await write(rows.sessions, (data) => tx.classSession.createMany({ data }));
  await write(rows.orders, (data) => tx.registrationOrder.createMany({ data }));
  await write(rows.payments, (data) => tx.payment.createMany({ data }));
  await write(rows.enrollments, (data) => tx.enrollment.createMany({ data }));
  await write(rows.placements, (data) => tx.enrollmentPlacement.createMany({ data }));
  await write(rows.participants, (data) => tx.sessionParticipant.createMany({ data }));
  await write(rows.leaves, (data) => tx.leaveRequest.createMany({ data }));
  await write(rows.makeups, (data) => tx.makeupBooking.createMany({ data }));
  await write(rows.assignments, (data) => tx.assignment.createMany({ data }));
  await write(rows.questions, (data) => tx.assignmentQuestion.createMany({ data }));
  await write(rows.recipients, (data) => tx.assignmentRecipient.createMany({ data }));
  await write(rows.submissions, (data) => tx.submission.createMany({ data }));
  await write(rows.grades, (data) => tx.gradeReview.createMany({ data }));
  await write(rows.announcements, (data) => tx.announcement.createMany({ data }));
  await write(rows.emails, (data) => tx.outboxEvent.createMany({ data }));
  await write(rows.audits, (data) => tx.auditLog.createMany({ data }));
}

function rowCounts(rows: PlanRows): Record<string, number> {
  return Object.fromEntries(
    (Object.entries(rows) as [string, unknown[]][]).map(([name, items]) => [name, items.length]),
  );
}

function regularNeeded(program: ProgramInfo, slots: ReturnType<typeof slotsForRange>): number {
  if (!program.tests.size) return slots.length;
  let tests = 0;
  for (const month of lastMonthlySlots(slots).keys()) if (program.tests.has(month)) tests++;
  return slots.length - tests;
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function weeklyConflict(left: WeeklySlot[], right: WeeklySlot[]): boolean {
  return left.some((a) =>
    right.some(
      (b) =>
        a.weekday === b.weekday &&
        minutesOf(a.startTime) < minutesOf(b.endTime) &&
        minutesOf(a.endTime) > minutesOf(b.startTime),
    ),
  );
}

/** Same rule as registration: occupancy only grows on a start date inside the new term. */
function peakOccupancy(intervals: Interval[], start: Date, end: Date): number {
  const points = [
    start,
    ...intervals.map((item) => item.start).filter((day) => day > start && day < end),
  ];
  return Math.max(
    0,
    ...points.map(
      (point) => intervals.filter((item) => item.start <= point && item.end > point).length,
    ),
  );
}

function seatsTaken(classPlan: ClassPlan, day: Date): number {
  return classPlan.occupancy.filter((item) => item.start <= day && item.end > day).length;
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result;
}

function localTime(instant: Date): string {
  return new Date(instant.getTime() + 7 * HOUR).toISOString().slice(11, 16);
}

function localStamp(instant: Date): string {
  return new Date(instant.getTime() + 7 * HOUR).toISOString().replace(/\D/g, '').slice(0, 14);
}

function weekdayName(weekday: number): string {
  return weekday === 7 ? 'Chủ nhật' : `Thứ ${weekday + 1}`;
}
