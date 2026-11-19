import { MATH_6 } from './textbooks/math-6';
import { MATH_7 } from './textbooks/math-7';
import { MATH_8 } from './textbooks/math-8';
import { MATH_9 } from './textbooks/math-9';
import { PHYSICS_6, CHEMISTRY_6, BIOLOGY_6 } from './textbooks/science-6';
import { PHYSICS_7, CHEMISTRY_7, BIOLOGY_7 } from './textbooks/science-7';
import { PHYSICS_8, CHEMISTRY_8, BIOLOGY_8 } from './textbooks/science-8';
import { PHYSICS_9, CHEMISTRY_9, BIOLOGY_9 } from './textbooks/science-9';
import { TEXTBOOK_SOURCES } from './textbooks/sources';
import type { Topic } from './textbooks/types';
export type { Topic } from './textbooks/types';
export { TEXTBOOK_SOURCES } from './textbooks/sources';

export const CURRICULUM_EDITION = 'ctst-2026-11-19';

export const SUBJECTS = [
  {
    key: 'math',
    code: 'MATH',
    name: 'Toán',
    teacher: 'teacher',
    designer: 'designer',
    fee: 800000,
    room: 0,
  },
  {
    key: 'physics',
    code: 'PHYSICS',
    name: 'Vật lý',
    teacher: 'physics-teacher',
    designer: 'designer-2',
    fee: 750000,
    room: 1,
  },
  {
    key: 'chemistry',
    code: 'CHEMISTRY',
    name: 'Hóa học',
    teacher: 'chemistry-teacher',
    designer: 'designer-2',
    fee: 750000,
    room: 2,
  },
  {
    key: 'biology',
    code: 'BIOLOGY',
    name: 'Sinh học',
    teacher: 'biology-teacher',
    designer: 'designer-2',
    fee: 700000,
    room: 3,
  },
] as const;

/** Full-year textbook order. The integrated science opening is shared by its three strands. */
export const TOPICS: Record<string, Topic[]> = {
  'math-6': MATH_6,
  'math-7': MATH_7,
  'math-8': MATH_8,
  'math-9': MATH_9,
  'physics-6': PHYSICS_6,
  'physics-7': PHYSICS_7,
  'physics-8': PHYSICS_8,
  'physics-9': PHYSICS_9,
  'chemistry-6': CHEMISTRY_6,
  'chemistry-7': CHEMISTRY_7,
  'chemistry-8': CHEMISTRY_8,
  'chemistry-9': CHEMISTRY_9,
  'biology-6': BIOLOGY_6,
  'biology-7': BIOLOGY_7,
  'biology-8': BIOLOGY_8,
  'biology-9': BIOLOGY_9,
};

export function topicSourceLocator(topic: Topic): string {
  if (topic.kind === 'activity')
    return `Hoạt động thực hành và trải nghiệm; ${topic.item}; trang in ${topic.page}`;
  const section = topic.bookId.startsWith('math') ? 'Chương' : 'Chủ đề';
  return [
    topic.chapter === 0 ? 'Mở đầu' : section + ' ' + topic.chapter + ': ' + topic.chapterTitle,
    topic.item,
    'trang in ' + topic.page,
  ].join('; ');
}

/** Original teaching notes and exercises; the reference identifies the textbook scope, not verbatim text. */
export function lessonContent(topic: Topic, phase = 'Bài học'): string {
  const source = TEXTBOOK_SOURCES[topic.bookId];
  return [
    '## Mục tiêu\n' + topic.summary,
    '## Nội dung giảng dạy\n' +
      topic.title +
      '.\n' +
      topic.summary +
      '\nVí dụ có hướng dẫn: ' +
      topic.exercise +
      '\nLời giải và kiến thức cần vận dụng: ' +
      topic.answer +
      (phase === 'Bài học'
        ? ''
        : '\nHoạt động tại trung tâm: ' +
          phase +
          '. Học sinh trình bày cách giải, đối chiếu điều kiện và giải thích kết quả.'),
    '## Bài tập (tự biên soạn)\n' + topic.exercise,
    '## Hướng dẫn và đáp án\n' + topic.answer,
    '## Tài liệu\n[' +
      source.title +
      '](' +
      source.url +
      ') — ' +
      source.publisher +
      '.\n' +
      topicSourceLocator(topic) +
      '. Đối chiếu mục lục ngày ' +
      source.checkedOn +
      '. Mục tiêu, ghi chú giảng dạy và bài tập do trung tâm biên soạn theo phạm vi bài; không phải bản chép sách hoặc chứng nhận đã được giáo viên duyệt.',
  ].join('\n\n');
}
