import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AppError } from '../../common/errors/app.error';
import { isRecord } from '../../integrations/academic-ai.service';
import { QuestionDto } from './academic.dto';

export const ASSIGNMENT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const ASSIGNMENT_IMPORT_MAX_TEXT = 100000;
export const ASSIGNMENT_IMPORT_MAX_QUESTIONS = 100;

export type ImportedQuestions = { questions: QuestionDto[]; warnings: string[] };

function invalidCsv(message: string): never {
  throw new AppError('ASSIGNMENT_IMPORT_INVALID_CSV', message, HttpStatus.BAD_REQUEST);
}

export function parseAssignmentCsv(buffer: Buffer): ImportedQuestions {
  if (buffer.length > ASSIGNMENT_IMPORT_MAX_BYTES)
    throw new AppError('ASSIGNMENT_IMPORT_FILE_TOO_LARGE', 'Tệp vượt quá giới hạn 5 MB.');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return invalidCsv('CSV phải sử dụng bảng mã UTF-8.');
  }
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const finishCell = (): void => {
    cells.push(cell);
    cell = '';
    closed = false;
  };
  const finishRow = (): void => {
    finishCell();
    if (cells.some((value) => value.trim())) rows.push(cells);
    cells = [];
    if (rows.length > ASSIGNMENT_IMPORT_MAX_QUESTIONS + 1)
      throw new AppError('ASSIGNMENT_IMPORT_TOO_MANY_QUESTIONS', 'Chỉ nhập tối đa 100 câu hỏi.');
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell || closed) invalidCsv('Dấu ngoặc kép trong CSV không hợp lệ.');
      quoted = true;
    } else if (char === ',') finishCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      finishRow();
    } else {
      if (closed && char !== ' ' && char !== '\t')
        invalidCsv('Có nội dung thừa sau dấu ngoặc kép đóng.');
      if (!closed) cell += char;
    }
  }
  if (quoted) invalidCsv('CSV có dấu ngoặc kép chưa đóng.');
  if (cell || cells.length || closed) finishRow();
  const header = rows.shift()?.map((value) => value.trim());
  const required = ['kind', 'prompt', 'choices', 'correctAnswer', 'rubric', 'maxScore'];
  if (
    !header ||
    header.length !== required.length ||
    new Set(header).size !== header.length ||
    !required.every((column) => header.includes(column))
  )
    invalidCsv('CSV cần các cột kind,prompt,choices,correctAnswer,rubric,maxScore.');
  if (rows.some((row) => row.length !== header.length))
    invalidCsv('Số cột của các dòng CSV phải khớp với dòng tiêu đề.');
  const questions = rows.map((row) => {
    const get = (name: string): string => row[header.indexOf(name)].trim();
    const score = get('maxScore');
    return {
      kind: get('kind'),
      prompt: get('prompt'),
      ...(get('choices')
        ? {
            choices: get('choices')
              .split('|')
              .map((choice) => choice.trim()),
          }
        : {}),
      ...(get('correctAnswer') ? { correctAnswer: get('correctAnswer') } : {}),
      ...(get('rubric') ? { rubric: get('rubric') } : {}),
      ...(score ? { maxScore: Number(score) } : {}),
    };
  });
  return validateImportedQuestions(questions);
}

/** Import is a preview: missing answer keys/rubrics remain missing for teacher review. */
export function validateImportedQuestions(value: unknown): ImportedQuestions {
  if (!Array.isArray(value) || !value.length)
    throw new AppError('ASSIGNMENT_IMPORT_NO_QUESTIONS', 'Không tìm thấy câu hỏi trong tệp.');
  if (value.length > ASSIGNMENT_IMPORT_MAX_QUESTIONS)
    throw new AppError('ASSIGNMENT_IMPORT_TOO_MANY_QUESTIONS', 'Chỉ nhập tối đa 100 câu hỏi.');
  const warnings: string[] = [];
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
    )
      throw new AppError(
        'ASSIGNMENT_IMPORT_INVALID_QUESTIONS',
        `Câu ${index + 1} có nội dung, lựa chọn hoặc điểm tối đa không hợp lệ.`,
      );
    if (maxScore === undefined)
      warnings.push(`Câu ${index + 1}: chưa có điểm tối đa; tạm dùng 1 điểm, hãy kiểm tra lại.`);
    if (question.kind === 'MULTIPLE_CHOICE') {
      if (!question.choices?.length)
        throw new AppError(
          'ASSIGNMENT_IMPORT_INVALID_QUESTIONS',
          `Câu ${index + 1}: trắc nghiệm cần từ 2 đến 10 lựa chọn.`,
        );
      if (question.correctAnswer && !question.choices.includes(question.correctAnswer))
        throw new AppError(
          'ASSIGNMENT_IMPORT_INVALID_QUESTIONS',
          `Câu ${index + 1}: đáp án phải trùng với một lựa chọn.`,
        );
      if (!question.correctAnswer?.trim())
        warnings.push(`Câu ${index + 1}: hãy bổ sung đáp án đúng trước khi lưu bản nháp.`);
    } else if (!question.rubric?.trim())
      warnings.push(`Câu ${index + 1}: hãy bổ sung hướng dẫn chấm trước khi lưu bản nháp.`);
    return question;
  });
  return { questions, warnings };
}
