import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { decodeExportedCsvCell, splitExportedCsvChoices } from '../../common/csv/exported-cell';
import {
  CsvFileError,
  csvNumberText,
  isCsvVersionOne,
  readCsv,
  type CsvRowError,
  type CsvTable,
} from '../../common/csv/read-csv';
import { AppError } from '../../common/errors/app.error';
import { isRecord } from '../../integrations/academic-ai.service';
import { QuestionDto } from './academic.dto';

export const ASSIGNMENT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const ASSIGNMENT_IMPORT_MAX_TEXT = 100000;
export const ASSIGNMENT_IMPORT_MAX_QUESTIONS = 100;

export type ImportedQuestions = { questions: QuestionDto[]; warnings: string[] };

const REQUIRED_COLUMNS = ['kind', 'prompt', 'choices', 'correctAnswer', 'rubric', 'maxScore'];

/** Vietnamese text for structural CSV errors; `{row}` is the Excel row of the first problem. */
const CSV_ERROR_TEXT: Record<string, string> = {
  CSV_NOT_UTF8:
    'CSV phải dùng bảng mã UTF-8. Trong Excel, chọn Lưu thành, kiểu "CSV UTF-8 (Comma delimited)", rồi chọn lại tệp.',
  CSV_EMPTY: 'CSV cần các cột kind,prompt,choices,correctAnswer,rubric,maxScore.',
  CSV_INVALID_HEADER: 'CSV cần các cột kind,prompt,choices,correctAnswer,rubric,maxScore.',
  CSV_INVALID_QUOTE: 'Dòng {row}: dấu ngoặc kép trong CSV không hợp lệ.',
  CSV_UNCLOSED_QUOTE: 'Dòng {row}: CSV có dấu ngoặc kép chưa đóng.',
  CSV_INVALID_COLUMNS: 'Dòng {row}: số cột không khớp với dòng tiêu đề.',
  CSV_UNSUPPORTED_VERSION: 'Dòng {row}: csvVersion phải là 1 hoặc để trống.',
};

/** Maps a reader error to the route's stable codes, keeping row details for the web. */
function assignmentCsvError(error: unknown): unknown {
  if (!(error instanceof CsvFileError)) return error;
  if (error.code === 'CSV_TOO_MANY_ROWS')
    return new AppError('ASSIGNMENT_IMPORT_TOO_MANY_QUESTIONS', 'Chỉ nhập tối đa 100 câu hỏi.');
  const first = error.rows[0];
  const text = (CSV_ERROR_TEXT[error.code] ?? 'CSV không hợp lệ.').replace(
    '{row}',
    String(first?.rowNumber ?? ''),
  );
  return new AppError(
    'ASSIGNMENT_IMPORT_INVALID_CSV',
    text + moreProblems(error.rowErrorCount, 'dòng'),
    HttpStatus.BAD_REQUEST,
    error.details(),
  );
}

function moreProblems(count: number, unit: string): string {
  return count > 1 ? ` Còn ${count - 1} ${unit} lỗi khác.` : '';
}

export function parseAssignmentCsv(buffer: Buffer): ImportedQuestions {
  if (buffer.length > ASSIGNMENT_IMPORT_MAX_BYTES)
    throw new AppError('ASSIGNMENT_IMPORT_FILE_TOO_LARGE', 'Tệp vượt quá giới hạn 5 MB.');
  let table: CsvTable;
  try {
    table = readCsv(buffer, {
      maxRows: ASSIGNMENT_IMPORT_MAX_QUESTIONS,
      versionColumn: 'csvVersion',
    });
  } catch (error) {
    throw assignmentCsvError(error);
  }
  const header = table.header.cells.map((value) => value.trim());
  const versioned = header.includes('csvVersion');
  if (
    header.length !== REQUIRED_COLUMNS.length + (versioned ? 1 : 0) ||
    (versioned && header[header.length - 1] !== 'csvVersion') ||
    new Set(header).size !== header.length ||
    !REQUIRED_COLUMNS.every((column) => header.includes(column))
  )
    throw assignmentCsvError(
      CsvFileError.fromRows([{ code: 'CSV_INVALID_HEADER', rowNumber: table.header.rowNumber }]),
    );
  const errors: CsvRowError[] = [];
  for (const row of table.rows) {
    if (row.cells.length !== header.length)
      errors.push({ code: 'CSV_INVALID_COLUMNS', rowNumber: row.rowNumber });
    else if (versioned && !isCsvVersionOne(row.cells[header.length - 1]))
      errors.push({ code: 'CSV_UNSUPPORTED_VERSION', rowNumber: row.rowNumber });
  }
  if (errors.length) throw assignmentCsvError(CsvFileError.fromRows(errors));
  const questions = table.rows.map((row) => {
    const get = (name: string): string => {
      const value = row.cells[header.indexOf(name)];
      return (versioned ? decodeExportedCsvCell(value) : value).trim();
    };
    const choices = get('choices');
    const score = csvNumberText(get('maxScore'), table.delimiter);
    return {
      kind: get('kind'),
      prompt: get('prompt'),
      ...(choices
        ? {
            choices: (versioned ? splitExportedCsvChoices(choices) : choices.split('|')).map(
              (choice) => choice.trim(),
            ),
          }
        : {}),
      ...(get('correctAnswer') ? { correctAnswer: get('correctAnswer') } : {}),
      ...(get('rubric') ? { rubric: get('rubric') } : {}),
      ...(score ? { maxScore: Number(score) } : {}),
    };
  });
  return validateImportedQuestions(
    questions,
    table.rows.map((row) => row.rowNumber),
  );
}

/**
 * Import is a preview: missing answer keys/rubrics remain missing for teacher review.
 * With `rowNumbers` (CSV) every invalid question is reported by Excel row in `details.rows`;
 * without them (AI extraction) the first invalid question stops the import as before.
 */
export function validateImportedQuestions(
  value: unknown,
  rowNumbers?: number[],
): ImportedQuestions {
  if (!Array.isArray(value) || !value.length)
    throw new AppError('ASSIGNMENT_IMPORT_NO_QUESTIONS', 'Không tìm thấy câu hỏi trong tệp.');
  if (value.length > ASSIGNMENT_IMPORT_MAX_QUESTIONS)
    throw new AppError('ASSIGNMENT_IMPORT_TOO_MANY_QUESTIONS', 'Chỉ nhập tối đa 100 câu hỏi.');
  const warnings: string[] = [];
  const failures: Array<{ rowNumber: number; message: string }> = [];
  const label = (index: number): string =>
    rowNumbers ? `Dòng ${rowNumbers[index]} (câu ${index + 1})` : `Câu ${index + 1}`;
  const fail = (index: number, message: string): void => {
    if (!rowNumbers) throw new AppError('ASSIGNMENT_IMPORT_INVALID_QUESTIONS', message);
    failures.push({ rowNumber: rowNumbers[index], message });
  };
  const questions = value.map((raw: unknown, index: number) => {
    if (!isRecord(raw))
      throw new AppError('ASSIGNMENT_IMPORT_INVALID_QUESTIONS', `Câu ${index + 1} không hợp lệ.`);
    const { maxScore, ...fields } = raw;
    const question = plainToInstance(QuestionDto, {
      ...fields,
      maxScore: maxScore === undefined ? 1 : maxScore,
    });
    const errors = validateSync(question, { whitelist: true, forbidNonWhitelisted: true });
    if (
      errors.length ||
      !question.prompt.trim() ||
      question.choices?.some((choice) => !choice.trim() || choice.length > 10000) ||
      (question.choices &&
        new Set(question.choices.map((choice) => choice.trim())).size !== question.choices.length)
    ) {
      fail(index, `${label(index)} có nội dung, lựa chọn hoặc điểm tối đa không hợp lệ.`);
      return question;
    }
    if (maxScore === undefined)
      warnings.push(`Câu ${index + 1}: chưa có điểm tối đa; tạm dùng 1 điểm, hãy kiểm tra lại.`);
    if (question.kind === 'MULTIPLE_CHOICE') {
      if (!question.choices?.length) {
        fail(index, `${label(index)}: trắc nghiệm cần từ 2 đến 10 lựa chọn.`);
        return question;
      }
      if (question.correctAnswer && !question.choices.includes(question.correctAnswer)) {
        fail(index, `${label(index)}: đáp án phải trùng với một lựa chọn.`);
        return question;
      }
      if (!question.correctAnswer?.trim())
        warnings.push(`Câu ${index + 1}: hãy bổ sung đáp án đúng trước khi lưu bản nháp.`);
    } else if (!question.rubric?.trim())
      warnings.push(`Câu ${index + 1}: hãy bổ sung hướng dẫn chấm trước khi lưu bản nháp.`);
    return question;
  });
  if (failures.length) {
    const rows = failures.map(({ rowNumber }) => ({ code: 'INVALID_QUESTION', rowNumber }));
    throw new AppError(
      'ASSIGNMENT_IMPORT_INVALID_QUESTIONS',
      failures[0].message + moreProblems(failures.length, 'câu'),
      HttpStatus.BAD_REQUEST,
      CsvFileError.fromRows(rows).details(),
    );
  }
  return { questions, warnings };
}
