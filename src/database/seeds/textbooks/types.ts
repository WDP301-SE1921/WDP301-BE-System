export type SubjectKey = 'math' | 'physics' | 'chemistry' | 'biology';
export type Grade = 6 | 7 | 8 | 9;
export type BookId = `math${Grade}v${1 | 2}` | `science${Grade}`;

export interface TextbookSource {
  title: string;
  series: string;
  publisher: string;
  url: string;
  catalogUrl: string;
  checkedOn: string;
}

export interface Topic {
  id: string;
  title: string;
  summary: string;
  exercise: string;
  answer: string;
  bookId: BookId;
  chapter: number;
  chapterTitle: string;
  item: string;
  page: number;
  kind: 'lesson' | 'review' | 'activity';
}

/** Page means the printed page, not a PDF viewer's page index. Exercises are original. */
export type LessonRow = readonly [
  item: number | `R${number}` | `A${number}`,
  page: number,
  title: string,
  objective: string,
  exercise: string,
  workedAnswer: string,
];

export function chapter(
  bookId: BookId,
  number: number,
  title: string,
  rows: readonly LessonRow[],
): Topic[] {
  return rows.map(([item, page, name, summary, exercise, answer]) => {
    const kind = typeof item === 'number' ? 'lesson' : item.startsWith('R') ? 'review' : 'activity';
    const label =
      typeof item === 'number'
        ? `Bài ${item}`
        : kind === 'review'
          ? 'Ôn tập'
          : `Hoạt động ${item.slice(1)}`;
    return {
      id: `${bookId}-c${number}-${String(item).toLowerCase()}`,
      title: `${bookId.startsWith('math') && kind !== 'activity' ? `Chương ${number} - ` : ''}${label}. ${name}`,
      summary,
      exercise,
      answer,
      bookId,
      chapter: number,
      chapterTitle: title,
      item: label,
      page,
      kind,
    };
  });
}
