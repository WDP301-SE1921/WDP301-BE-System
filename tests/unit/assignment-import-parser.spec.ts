import { AppError } from '../../src/common/errors/app.error';
import {
  parseAssignmentCsv,
  validateImportedQuestions,
} from '../../src/modules/academic/assignment-import-parser';

const header = 'kind,prompt,choices,correctAnswer,rubric,maxScore\r\n';

describe('assignment question CSV import', () => {
  it('preserves Vietnamese, BOM, quoted commas, multiline prompts and escaped quotes', () => {
    const result = parseAssignmentCsv(
      Buffer.from(
        `\uFEFF${header}MULTIPLE_CHOICE,"Tính tổng, rồi chọn:\r\n""Một"" hay hai?",Một|Hai,Một,,2\r\nESSAY,Giải thích,,,Nêu lập luận rõ ràng,3\r\n`,
      ),
    );
    expect(result.questions).toEqual([
      {
        kind: 'MULTIPLE_CHOICE',
        prompt: 'Tính tổng, rồi chọn:\r\n"Một" hay hai?',
        choices: ['Một', 'Hai'],
        correctAnswer: 'Một',
        maxScore: 2,
      },
      { kind: 'ESSAY', prompt: 'Giải thích', rubric: 'Nêu lập luận rõ ràng', maxScore: 3 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['kind,prompt\nESSAY,test', 'ASSIGNMENT_IMPORT_INVALID_CSV'],
    [`${header}ESSAY,"unfinished`, 'ASSIGNMENT_IMPORT_INVALID_CSV'],
    [`${header}ESSAY,"closed"bad,,,rubric,1`, 'ASSIGNMENT_IMPORT_INVALID_CSV'],
    [`${header}ESSAY,test,,,rubric`, 'ASSIGNMENT_IMPORT_INVALID_CSV'],
    [`${header}ESSAY,test,,,rubric,1,extra`, 'ASSIGNMENT_IMPORT_INVALID_CSV'],
    [header, 'ASSIGNMENT_IMPORT_NO_QUESTIONS'],
    [`${header}OTHER,test,,,rubric,1`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}MULTIPLE_CHOICE,test,A|A,A,,1`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}MULTIPLE_CHOICE,test,A|B,C,,1`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}MULTIPLE_CHOICE,test,A||B,A,,1`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}ESSAY, ,,,rubric,1`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}ESSAY,test,,,rubric,Infinity`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}ESSAY,test,,,rubric,NaN`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}ESSAY,test,,,rubric,-1`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
    [`${header}ESSAY,test,,,rubric,0`, 'ASSIGNMENT_IMPORT_INVALID_QUESTIONS'],
  ])('rejects invalid CSV/question data (%s)', (source, code) => {
    expect(() => parseAssignmentCsv(Buffer.from(source))).toThrow(AppError);
    try {
      parseAssignmentCsv(Buffer.from(source));
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it('rejects invalid encoding and more than 100 questions', () => {
    expect(() => parseAssignmentCsv(Buffer.from([0xff, 0xfe, 0x61]))).toThrow('UTF-8');
    expect(() =>
      parseAssignmentCsv(Buffer.from(header + 'ESSAY,text,,,rubric,1\r\n'.repeat(101))),
    ).toThrow('100');
  });

  it('leaves missing keys/rubrics for teacher review and clearly warns about the default score', () => {
    const result = parseAssignmentCsv(
      Buffer.from(`${header}MULTIPLE_CHOICE,Question,A|B,,,\r\nESSAY,Explain,,,,2`),
    );
    expect(result.questions[0]).toMatchObject({ maxScore: 1 });
    expect(result.questions[0].correctAnswer).toBeUndefined();
    expect(result.questions[1].rubric).toBeUndefined();
    expect(result.warnings).toHaveLength(3);
  });

  it('does not coerce AI text scores or permit extra AI fields', () => {
    expect(() =>
      validateImportedQuestions([{ kind: 'ESSAY', prompt: 'Explain', maxScore: '2' }]),
    ).toThrow(AppError);
    expect(() =>
      validateImportedQuestions([{ kind: 'ESSAY', prompt: 'Explain', publish: true, maxScore: 1 }]),
    ).toThrow(AppError);
  });
});
