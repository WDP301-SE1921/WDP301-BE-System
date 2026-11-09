import { AppError } from '../../src/common/errors/app.error';
import {
  parseAssignmentCsv,
  validateImportedQuestions,
} from '../../src/modules/academic/assignment-import-parser';

const header = 'kind,prompt,choices,correctAnswer,rubric,maxScore\r\n';
const versionedHeader = 'kind,prompt,choices,correctAnswer,rubric,maxScore,csvVersion\r\n';

describe('assignment question CSV import', () => {
  it('decodes version 1 exported text and escaped choices with a literal expected result', () => {
    const result = parseAssignmentCsv(
      Buffer.from(
        '\uFEFF' +
          versionedHeader +
          String.raw`MULTIPLE_CHOICE,"'  =Tính, ""tổng""","'@A\|B|C\\D|E\q|''dẫn",'@A|B,,2.5,1` +
          "\r\nESSAY,\"''Một câu\r\nnhiều dòng\",,,'  +Nêu lập luận,0.5,1\r\n",
      ),
    );
    expect(result.questions).toEqual([
      {
        kind: 'MULTIPLE_CHOICE',
        prompt: '=Tính, "tổng"',
        choices: ['@A|B', 'C\\D', 'E\\q', "''dẫn"],
        correctAnswer: '@A|B',
        maxScore: 2.5,
      },
      {
        kind: 'ESSAY',
        prompt: "'Một câu\r\nnhiều dòng",
        rubric: '+Nêu lập luận',
        maxScore: 0.5,
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ["''dẫn", "'dẫn"],
    ["'''dẫn", "''dẫn"],
    ["'  \t\uFEFF-x", '-x'],
    ["'@x", '@x'],
    ["'ordinary", "'ordinary"],
    ["'", "'"],
    ["  '=x", "'=x"],
    ['=x', '=x'],
  ])('only removes an exported initial apostrophe from versioned text %s', (cell, expected) => {
    const result = parseAssignmentCsv(Buffer.from(`${versionedHeader}ESSAY,${cell},,,rubric,1,1`));
    expect(result.questions[0].prompt).toBe(expected);
  });

  it('retains literal apostrophes and pipe splitting in legacy files', () => {
    const result = parseAssignmentCsv(
      Buffer.from(header + String.raw`MULTIPLE_CHOICE,'=x,A\|B\\C,A\,,1`),
    );
    expect(result.questions[0]).toMatchObject({
      prompt: "'=x",
      choices: ['A\\', 'B\\\\C'],
      correctAnswer: 'A\\',
    });
  });

  it.each(['', '2', '01', "'1", '1.0'])(
    'rejects unsupported or empty row version %s',
    (version) => {
      expect(() =>
        parseAssignmentCsv(Buffer.from(`${versionedHeader}ESSAY,text,,,rubric,1,${version}`)),
      ).toThrow(AppError);
    },
  );

  it('requires csvVersion to be the final column and every versioned row to be marked', () => {
    expect(() =>
      parseAssignmentCsv(
        Buffer.from(
          'csvVersion,kind,prompt,choices,correctAnswer,rubric,maxScore\n1,ESSAY,text,,,rubric,1',
        ),
      ),
    ).toThrow(AppError);
    expect(() =>
      parseAssignmentCsv(
        Buffer.from(`${versionedHeader}ESSAY,text,,,rubric,1,1\nESSAY,second,,,rubric,1,`),
      ),
    ).toThrow(AppError);
  });

  it('keeps the exact byte and question count bounds for versioned CSV', () => {
    const source = versionedHeader + 'ESSAY,text,,,rubric,1,1\r\n';
    const limit = 5 * 1024 * 1024;
    const bytes = Buffer.concat([
      Buffer.from(source),
      Buffer.alloc(limit - Buffer.byteLength(source), ' '),
    ]);
    expect(parseAssignmentCsv(bytes).questions).toHaveLength(1);
    expect(() => parseAssignmentCsv(Buffer.concat([bytes, Buffer.from(' ')]))).toThrow('5 MB');
    expect(
      parseAssignmentCsv(Buffer.from(versionedHeader + 'ESSAY,text,,,rubric,1,1\n'.repeat(100)))
        .questions,
    ).toHaveLength(100);
    expect(() =>
      parseAssignmentCsv(Buffer.from(versionedHeader + 'ESSAY,text,,,rubric,1,1\n'.repeat(101))),
    ).toThrow('100');
  });

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
