/** Static pools for the dashboard seed. All people and contacts are fictional. */

/** Deterministic PRNG (mulberry32) so every run of the same dataset produces the same rows. */
export class SeedRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of items) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return items[items.length - 1][0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(this.next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }
}

export const FAMILY_NAMES = [
  ['Nguyễn', 30],
  ['Trần', 11],
  ['Lê', 9],
  ['Phạm', 7],
  ['Hoàng', 5],
  ['Huỳnh', 4],
  ['Phan', 4],
  ['Vũ', 4],
  ['Võ', 4],
  ['Đặng', 3],
  ['Bùi', 3],
  ['Đỗ', 3],
  ['Hồ', 2],
  ['Ngô', 2],
  ['Dương', 2],
  ['Lý', 1],
  ['Đinh', 1],
  ['Trương', 1],
  ['Mai', 1],
  ['Lâm', 1],
  ['Cao', 1],
  ['Đoàn', 1],
  ['Hà', 1],
  ['Tô', 1],
  ['Lương', 1],
] as const;

export const MALE_MIDDLE = [
  'Văn',
  'Minh',
  'Hoàng',
  'Đức',
  'Quốc',
  'Gia',
  'Hữu',
  'Thành',
  'Anh',
  'Tuấn',
  'Bảo',
  'Nhật',
  'Trọng',
  'Công',
  'Duy',
] as const;

export const FEMALE_MIDDLE = [
  'Thị',
  'Ngọc',
  'Thu',
  'Thanh',
  'Minh',
  'Bảo',
  'Khánh',
  'Phương',
  'Hồng',
  'Mai',
  'Hoài',
  'Diệu',
  'Gia',
  'Quỳnh',
  'Thùy',
] as const;

export const MALE_GIVEN = [
  'An',
  'Bình',
  'Cường',
  'Dũng',
  'Duy',
  'Đạt',
  'Hải',
  'Hiếu',
  'Hoàng',
  'Huy',
  'Hùng',
  'Khang',
  'Khoa',
  'Khôi',
  'Kiên',
  'Lâm',
  'Long',
  'Lộc',
  'Minh',
  'Nam',
  'Nghĩa',
  'Nhân',
  'Phát',
  'Phong',
  'Phúc',
  'Quân',
  'Quang',
  'Sơn',
  'Tài',
  'Thắng',
  'Thành',
  'Thiện',
  'Thịnh',
  'Tiến',
  'Toàn',
  'Trí',
  'Trung',
  'Tuấn',
  'Tùng',
  'Việt',
  'Vinh',
  'Vũ',
] as const;

export const FEMALE_GIVEN = [
  'Anh',
  'Chi',
  'Dung',
  'Duyên',
  'Giang',
  'Hà',
  'Hạnh',
  'Hằng',
  'Hiền',
  'Hoa',
  'Hương',
  'Huyền',
  'Khánh',
  'Lan',
  'Linh',
  'Ly',
  'Mai',
  'My',
  'Nga',
  'Ngân',
  'Ngọc',
  'Nhi',
  'Nhung',
  'Oanh',
  'Phương',
  'Quyên',
  'Quỳnh',
  'Tâm',
  'Thảo',
  'Thư',
  'Thủy',
  'Trang',
  'Trâm',
  'Tú',
  'Uyên',
  'Vân',
  'Vy',
  'Yến',
] as const;

/** Mobile prefixes of Vietnamese carriers; numbers are generated, not real subscribers. */
export const PHONE_PREFIXES = [
  '091',
  '093',
  '094',
  '097',
  '098',
  '035',
  '038',
  '077',
  '086',
  '089',
];

export const ROOMS = [
  { key: 'd401', name: 'Phòng D401', capacity: 30 },
  { key: 'd402', name: 'Phòng D402', capacity: 30 },
  { key: 'd403', name: 'Phòng D403', capacity: 25 },
  { key: 'e501', name: 'Phòng E501', capacity: 30 },
  { key: 'e502', name: 'Phòng E502', capacity: 25 },
  { key: 'e503', name: 'Phòng E503', capacity: 25 },
  { key: 'lab1', name: 'Phòng Lab 1', capacity: 24 },
  { key: 'lab2', name: 'Phòng Lab 2', capacity: 24 },
] as const;

/** How many new teachers each subject gets; the demo already has one per subject. */
export const TEACHERS_PER_SUBJECT: Record<string, number> = {
  math: 12,
  physics: 10,
  chemistry: 9,
  biology: 9,
};

export type ClassVariant = 'advanced' | 'weekend' | 'exam' | 'summer' | 'topic';

export interface BulkClassDefinition {
  key: string;
  programKey: string;
  variant: ClassVariant;
  /** Months after the history start (0 = first month of the six-month dashboard window). */
  openingMonth: number;
  capacity: number;
  feeDelta: number;
  isOpen: boolean;
  /** Inactive classes stop at the end of the previous term. */
  isActive: boolean;
}

/** [key suffix, variant, opening month, capacity, fee delta] per program; openings grow monthly. */
const CLASS_TABLE: Record<string, [string, ClassVariant, number, number, number][]> = {
  'math-6': [
    ['nc', 'advanced', 1, 22, 100000],
    ['ct', 'weekend', 0, 20, 0],
  ],
  'math-7': [
    ['nc', 'advanced', 1, 22, 100000],
    ['ct', 'weekend', 0, 20, 0],
  ],
  'math-8': [
    ['nc', 'advanced', 0, 24, 100000],
    ['ct', 'weekend', 2, 20, 0],
  ],
  'math-9': [
    ['nc', 'advanced', 0, 24, 100000],
    ['ct', 'weekend', 3, 20, 0],
    ['lt10', 'exam', 1, 25, 400000],
  ],
  'physics-6': [['ct', 'weekend', 4, 20, 0]],
  'physics-7': [['nc', 'advanced', 2, 22, 100000]],
  'physics-8': [
    ['nc', 'advanced', 1, 24, 100000],
    ['ct', 'weekend', 3, 20, 0],
  ],
  'physics-9': [
    ['nc', 'advanced', 0, 24, 100000],
    ['ct', 'weekend', 3, 20, 0],
  ],
  'chemistry-6': [['ct', 'weekend', 5, 20, 0]],
  'chemistry-7': [['ct', 'weekend', 4, 20, 0]],
  'chemistry-8': [['nc', 'advanced', 2, 24, 100000]],
  'chemistry-9': [
    ['nc', 'advanced', 0, 24, 100000],
    ['cd', 'topic', 2, 16, 200000],
  ],
  'biology-6': [['ct', 'weekend', 5, 20, 0]],
  'biology-7': [
    ['nc', 'advanced', 3, 22, 100000],
    ['he', 'summer', 0, 20, 0],
  ],
  'biology-8': [['ct', 'weekend', 4, 20, 0]],
  'biology-9': [['nc', 'advanced', 1, 24, 100000]],
};

/** Classes open gradually so the six-month trend grows like a real center. */
export function bulkClassDefinitions(): BulkClassDefinition[] {
  return Object.entries(CLASS_TABLE).flatMap(([programKey, rows]) =>
    rows.map(([suffix, variant, openingMonth, capacity, feeDelta]) => ({
      key: `${programKey}-${suffix}`,
      programKey,
      variant,
      openingMonth,
      capacity,
      feeDelta,
      // A summer course is paused after the summer; a topic class closed once it filled up.
      isOpen: variant !== 'summer' && variant !== 'topic',
      isActive: variant !== 'summer',
    })),
  );
}

export function className(subjectName: string, grade: number, variant: ClassVariant): string {
  switch (variant) {
    case 'advanced':
      return `${subjectName} ${grade} Nâng cao`;
    case 'weekend':
      return `${subjectName} ${grade} Cuối tuần`;
    case 'exam':
      return `${subjectName} ${grade} - Luyện thi vào 10`;
    case 'summer':
      return `${subjectName} ${grade} - Lớp hè (tạm ngừng)`;
    case 'topic':
      return `${subjectName} ${grade} - Chuyên đề (đã chốt danh sách)`;
  }
}

/** Weekly slot options in preference order: weekday evenings or weekend daytime. */
export const SCHEDULE_OPTIONS: Record<
  ClassVariant,
  { days: number[]; start: string; end: string }[]
> = {
  advanced: [
    { days: [1, 3], start: '17:30', end: '19:30' },
    { days: [2, 4], start: '17:30', end: '19:30' },
    { days: [3, 5], start: '17:30', end: '19:30' },
    { days: [1, 3], start: '19:30', end: '21:00' },
    { days: [2, 4], start: '19:30', end: '21:00' },
    { days: [3, 5], start: '19:30', end: '21:00' },
    { days: [1, 4], start: '17:30', end: '19:30' },
    { days: [2, 5], start: '17:30', end: '19:30' },
    { days: [1, 4], start: '19:30', end: '21:00' },
    { days: [2, 5], start: '19:30', end: '21:00' },
  ],
  weekend: [
    { days: [6, 7], start: '07:30', end: '09:30' },
    { days: [6, 7], start: '09:45', end: '11:45' },
    { days: [6, 7], start: '14:00', end: '16:00' },
    { days: [6, 7], start: '16:15', end: '18:15' },
    { days: [3, 6], start: '17:30', end: '19:30' },
  ],
  exam: [
    { days: [3, 6], start: '19:30', end: '21:00' },
    { days: [2, 5], start: '19:30', end: '21:00' },
  ],
  summer: [{ days: [1, 3, 5], start: '08:00', end: '10:00' }],
  topic: [
    { days: [3, 7], start: '14:00', end: '16:00' },
    { days: [2, 7], start: '14:00', end: '16:00' },
  ],
};

export const LEAVE_REASONS = [
  'Con bị sốt, gia đình xin cho con nghỉ buổi này.',
  'Gia đình có việc riêng, xin phép cho con nghỉ.',
  'Con tham gia hội thao của trường.',
  'Con đi khám răng theo lịch hẹn.',
  'Con dự thi học sinh giỏi cấp trường.',
  'Gia đình về quê có đám cưới.',
  'Con bị cảm, cần nghỉ ngơi.',
  'Lịch kiểm tra bù ở trường trùng giờ học.',
];

export const PAUSE_REASONS = [
  'Gia đình đi du lịch hè, xin tạm nghỉ.',
  'Con nhập viện theo dõi, xin tạm nghỉ đến khi khỏe.',
  'Con ôn thi giữa kỳ ở trường, xin tạm nghỉ hai tuần.',
  'Gia đình chuyển nhà, xin tạm nghỉ một thời gian ngắn.',
];

export const SUBSTITUTE_REASONS = [
  'Giáo viên phụ trách nghỉ ốm.',
  'Giáo viên phụ trách đi tập huấn chuyên môn.',
  'Giáo viên phụ trách có việc gia đình đột xuất.',
  'Giáo viên phụ trách coi thi tại trường.',
];

export const CANCEL_REASONS = [
  'Phòng học mất điện, trung tâm đã báo phụ huynh.',
  'Giáo viên nghỉ ốm và không có người dạy thay phù hợp.',
  'Mưa lớn ngập đường, trung tâm cho học sinh nghỉ.',
];

export const SESSION_SUMMARIES = [
  'Học sinh nắm được kiến thức chính, cần luyện thêm dạng bài vận dụng.',
  'Lớp sôi nổi, đa số hoàn thành bài tập tại lớp.',
  'Đã chữa các lỗi thường gặp và giao bài về nhà.',
  'Ôn lại kiến thức buổi trước, làm bài kiểm tra nhanh 10 phút.',
  'Học sinh làm việc nhóm tốt; một số em cần kèm thêm phần trình bày.',
];

export const DECLINE_NOTES = [
  'Buổi học có bài kiểm tra quan trọng, đề nghị phụ huynh sắp xếp cho con đi học.',
  'Đơn gửi quá sát giờ học, đề nghị phụ huynh liên hệ giáo viên.',
];

export const GRADE_FEEDBACK = [
  'Bài làm tốt, trình bày rõ ràng và đầy đủ các bước.',
  'Cần trình bày đầy đủ các bước lập luận trước khi kết luận.',
  'Nắm được kiến thức cơ bản; cần cẩn thận hơn khi tính toán.',
  'Phần vận dụng còn thiếu, em ôn lại lý thuyết của bài.',
  'Tiến bộ so với bài trước, tiếp tục phát huy.',
  'Đúng hướng giải nhưng còn sai đơn vị ở bước cuối.',
];

export const ANNOUNCEMENTS = [
  {
    title: 'Nhắc lịch kiểm tra cuối tháng',
    content:
      'Buổi học cuối tháng có bài kiểm tra 30 phút. Học sinh ôn lại các bài đã học và mang đầy đủ dụng cụ.',
  },
  {
    title: 'Thông báo học phí tháng mới',
    content:
      'Trung tâm nhận học phí tại quầy lễ tân từ 8:00 đến 20:00. Phụ huynh nhận biên nhận qua email sau khi thanh toán.',
  },
  {
    title: 'Họp phụ huynh trực tuyến',
    content:
      'Giáo viên chủ nhiệm lớp tổ chức họp phụ huynh trực tuyến để trao đổi tình hình học tập của các con.',
  },
];

/** Holidays when the center closes; month-day keys apply to every year. */
export const HOLIDAYS: Record<string, string> = {
  '04-30': 'Nghỉ lễ Giải phóng miền Nam 30/4.',
  '05-01': 'Nghỉ lễ Quốc tế Lao động 1/5.',
  '09-02': 'Nghỉ lễ Quốc khánh 2/9.',
};

export function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
