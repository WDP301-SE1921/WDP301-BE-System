import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Workbook } from 'exceljs';
import { CsvFileError } from '../../common/csv/read-csv';
import { readSpreadsheet } from '../../common/csv/read-spreadsheet';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertRule, roles } from './academic-access.service';
import { AcademicRepository } from './academic.repository';

export const OUTCOME_IMPORT_MAX_ROWS = 200;
export const OUTCOME_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_TTL_MS = 30 * 60_000;
const MAX_CODE = 64;
const MAX_TITLE = 255;
const MAX_STATEMENT = 5000;

/** Template header row, in the order of the example row. */
export const OUTCOME_IMPORT_TEMPLATE_HEADERS = [
  'Mã',
  'Tên mục tiêu',
  'Mô tả',
  'Bắt buộc (Có/Không)',
] as const;

export type OutcomeImportRowError = { field: string; code: string };
export type OutcomeImportRow = {
  rowNumber: number;
  code: string;
  title: string;
  statement: string;
  required: boolean;
  errors: OutcomeImportRowError[];
};

type Field = 'code' | 'title' | 'statement' | 'required';
const HEADER_ALIASES: Record<Field, string[]> = {
  code: ['ma', 'code', 'ma muc tieu', 'ma clo'],
  title: ['ten muc tieu', 'ten', 'title', 'muc tieu'],
  statement: ['mo ta', 'statement', 'noi dung', 'mo ta muc tieu'],
  required: ['bat buoc', 'required'],
};
const YES = new Set(['co', 'yes', 'y', 'true', '1', 'x', 'bat buoc']);
const NO = new Set(['khong', 'no', 'n', 'false', '0', 'tuy chon']);

/** Lowercase, no diacritics, no "(…)" hint, single spaces: `Bắt buộc (Có/Không)` → `bat buoc`. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TRAILING_NUMBER = /^(.*?)(\d+)$/;
/** Same rule as the web `nextOutcomeCode`: highest trailing number + 1, keeping its width. */
export function nextOutcomeCode(
  existingCodes: readonly string[],
  fallback?: { subjectCode?: string | null; grade?: number | null },
): string {
  let best: { prefix: string; value: number; width: number } | null = null;
  for (const code of existingCodes) {
    const match = TRAILING_NUMBER.exec(code.trim());
    if (!match) continue;
    const value = Number(match[2]);
    if (!best || value > best.value) best = { prefix: match[1], value, width: match[2].length };
  }
  if (best) return `${best.prefix}${String(best.value + 1).padStart(best.width, '0')}`;
  const subjectCode = fallback?.subjectCode?.trim();
  if (existingCodes.length || !subjectCode || !fallback?.grade) return '';
  return `${subjectCode.toUpperCase()}-${fallback.grade}-01`;
}

@Injectable()
export class OutcomeImportService {
  constructor(private readonly repo: AcademicRepository) {}

  async template(user: AuthenticatedUser): Promise<{ buffer: Buffer; type: string; name: string }> {
    roles(user, 'CURRICULUM_DESIGNER');
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Mục tiêu khóa học');
    sheet.addRow([...OUTCOME_IMPORT_TEMPLATE_HEADERS]);
    sheet.addRow([
      'MATH-7-01',
      'Giải phương trình bậc nhất một ẩn',
      'Học sinh giải được phương trình dạng ax + b = 0 và kiểm tra lại nghiệm.',
      'Có',
    ]);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [{ width: 16 }, { width: 40 }, { width: 70 }, { width: 22 }];
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: 'mau-muc-tieu-khoa-hoc.xlsx',
    };
  }

  async preview(
    user: AuthenticatedUser,
    setId: string,
    file: Express.Multer.File | undefined,
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    if (!file?.buffer || file.buffer.length === 0)
      throw new AppError(
        'OUTCOME_IMPORT_FILE_INVALID',
        'Upload an .xlsx or .csv file',
        HttpStatus.BAD_REQUEST,
        { code: 'FILE_REQUIRED', rows: [], rowErrorCount: 0 },
      );
    const set = await this.repo.db.outcomeSet.findUnique({
      where: { id: setId },
      include: {
        program: { select: { grade: true, subjectRecord: { select: { code: true } } } },
        outcomes: { select: { code: true } },
      },
    });
    assertRule(set, 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
    assertRule(set.status === 'DRAFT', 'OUTCOME_SET_LOCKED', 'Only a draft set can be edited');
    const records = await this.readRecords(file);
    const stored = set.outcomes.map((item) => item.code);
    const rows = this.buildRows(records, stored, {
      subjectCode: set.program.subjectRecord?.code,
      grade: set.program.grade,
    });
    const preview = await this.repo.db.outcomeImportPreview.create({
      data: {
        outcomeSetId: setId,
        actorUserId: user.id,
        rows,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      },
    });
    const invalid = rows.filter((row) => row.errors.length).length;
    return {
      previewId: preview.id,
      outcomeSetId: setId,
      expiresAt: preview.expiresAt,
      summary: { rows: rows.length, validRows: rows.length - invalid, invalidRows: invalid },
      rows,
    };
  }

  async commit(
    user: AuthenticatedUser,
    setId: string,
    previewId: string,
    key: string | undefined,
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    const idempotencyKey = key?.trim();
    assertRule(
      idempotencyKey && idempotencyKey.length <= 191,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
      HttpStatus.BAD_REQUEST,
    );
    const hash = createHash('sha256')
      .update(JSON.stringify({ actorId: user.id, setId, previewId }))
      .digest('hex');
    return this.repo.transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT status FROM outcome_sets WHERE id = ${setId} FOR UPDATE`;
      assertRule(locked[0], 'OUTCOME_SET_NOT_FOUND', 'Outcome set not found', HttpStatus.NOT_FOUND);
      // Locking reads: TiDB plain reads see the snapshot from before the set lock.
      const [prior] = await tx.$queryRaw<
        Array<{ actorUserId: string; requestHash: string; response: unknown }>
      >`SELECT actorUserId, requestHash, response FROM outcome_import_commits WHERE outcomeSetId = ${setId} AND \`key\` = ${idempotencyKey} FOR UPDATE`;
      if (prior) {
        assertRule(
          prior.actorUserId === user.id && prior.requestHash === hash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for another import',
        );
        return typeof prior.response === 'string'
          ? (JSON.parse(prior.response) as unknown)
          : prior.response;
      }
      assertRule(
        locked[0].status === 'DRAFT',
        'OUTCOME_SET_LOCKED',
        'Only a draft set can be edited',
      );
      const preview = await tx.outcomeImportPreview.findUnique({ where: { id: previewId } });
      assertRule(
        preview &&
          preview.outcomeSetId === setId &&
          preview.actorUserId === user.id &&
          preview.expiresAt > new Date(),
        'OUTCOME_IMPORT_PREVIEW_STALE',
        'Import preview is expired or does not match this set; preview again',
      );
      const rows = preview.rows as unknown as OutcomeImportRow[];
      const invalid = rows.filter((row) => row.errors.length).length;
      assertRule(
        rows.length > 0 && !invalid,
        'INVALID_IMPORT',
        `Import has ${invalid} invalid rows`,
        HttpStatus.BAD_REQUEST,
      );
      // The set may have gained codes since the preview was read.
      const existing = await tx.$queryRaw<
        Array<{ code: string }>
      >`SELECT code FROM learning_outcomes WHERE outcomeSetId = ${setId} FOR UPDATE`;
      const taken = new Set(existing.map((item) => item.code.toLowerCase()));
      assertRule(
        !rows.some((row) => taken.has(row.code.toLowerCase())),
        'OUTCOME_IMPORT_PREVIEW_STALE',
        'The set changed after the preview; preview again',
      );
      const createdIds: string[] = [];
      for (const row of rows) {
        const created = await tx.learningOutcome.create({
          data: {
            outcomeSetId: setId,
            code: row.code,
            title: row.title,
            statement: row.statement,
            required: row.required,
            sourceStatus: 'CANDIDATE',
          },
          select: { id: true },
        });
        createdIds.push(created.id);
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'OUTCOME_CREATED',
            entityType: 'LearningOutcome',
            entityId: created.id,
            afterData: { outcomeSetId: setId, importPreviewId: previewId },
          },
        });
      }
      const response = {
        outcomeSetId: setId,
        createdCount: createdIds.length,
        outcomeIds: createdIds,
      };
      await tx.outcomeImportCommit.create({
        data: {
          outcomeSetId: setId,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash: hash,
          response,
        },
      });
      return response;
    });
  }

  private async readRecords(
    file: Express.Multer.File | undefined,
  ): Promise<Array<{ rowNumber: number; cells: string[] }> & { columns?: Record<Field, number> }> {
    let table;
    try {
      table = await readSpreadsheet(file!.buffer, file!.originalname ?? '', {
        maxRows: OUTCOME_IMPORT_MAX_ROWS,
        maxBytes: OUTCOME_IMPORT_MAX_BYTES,
      });
    } catch (error) {
      if (error instanceof CsvFileError)
        throw new AppError(
          'OUTCOME_IMPORT_FILE_INVALID',
          'The file cannot be read as .xlsx or .csv',
          HttpStatus.BAD_REQUEST,
          error.details(),
        );
      throw error;
    }
    const names = table.header.cells.map(normalize);
    const columns = {} as Record<Field, number>;
    for (const field of Object.keys(HEADER_ALIASES) as Field[])
      columns[field] = names.findIndex((name) => HEADER_ALIASES[field].includes(name));
    if (columns.title < 0)
      throw new AppError(
        'OUTCOME_IMPORT_FILE_INVALID',
        'Missing the "Tên mục tiêu" column',
        HttpStatus.BAD_REQUEST,
        { code: 'COLUMN_MISSING', column: 'title', rows: [], rowErrorCount: 0 },
      );
    return Object.assign([...table.rows], { columns });
  }

  private buildRows(
    records: Awaited<ReturnType<OutcomeImportService['readRecords']>>,
    storedCodes: string[],
    fallback: { subjectCode?: string | null; grade?: number | null },
  ): OutcomeImportRow[] {
    const columns = records.columns!;
    const cell = (cells: string[], field: Field): string =>
      columns[field] >= 0 ? (cells[columns[field]] ?? '').trim() : '';
    const taken = new Set(storedCodes.map((code) => code.toLowerCase()));
    const known = [...storedCodes];
    const seen = new Set<string>();
    // File codes count for suggestions so two blank codes get different numbers.
    for (const record of records) {
      const code = cell(record.cells, 'code');
      if (code) known.push(code);
    }
    const rows: OutcomeImportRow[] = [];
    for (const record of records) {
      const errors: OutcomeImportRowError[] = [];
      let code = cell(record.cells, 'code');
      const title = cell(record.cells, 'title');
      const statementRaw = cell(record.cells, 'statement');
      const requiredRaw = normalize(cell(record.cells, 'required'));
      if (!code) {
        code = nextOutcomeCode(known, fallback) || 'CLO-01';
        // A suggestion that is already used by a stored code moves on to the next free number.
        while (taken.has(code.toLowerCase()) || seen.has(code.toLowerCase())) {
          known.push(code);
          code = nextOutcomeCode(known, fallback);
        }
        known.push(code);
      }
      if (title.length < 2) errors.push({ field: 'title', code: 'TITLE_REQUIRED' });
      if (code.length === 1) errors.push({ field: 'code', code: 'VALUE_TOO_SHORT' });
      if (code.length > MAX_CODE) errors.push({ field: 'code', code: 'VALUE_TOO_LONG' });
      if (title.length > MAX_TITLE) errors.push({ field: 'title', code: 'VALUE_TOO_LONG' });
      if (statementRaw.length > MAX_STATEMENT)
        errors.push({ field: 'statement', code: 'VALUE_TOO_LONG' });
      let required = true;
      if (YES.has(requiredRaw) || !requiredRaw) required = true;
      else if (NO.has(requiredRaw)) required = false;
      else errors.push({ field: 'required', code: 'REQUIRED_INVALID' });
      const lowered = code.toLowerCase();
      if (seen.has(lowered)) errors.push({ field: 'code', code: 'DUPLICATE_CODE_IN_FILE' });
      else if (taken.has(lowered)) errors.push({ field: 'code', code: 'CODE_EXISTS' });
      seen.add(lowered);
      rows.push({
        rowNumber: record.rowNumber,
        code,
        title,
        // The set requires a statement of at least 2 characters; an empty cell reuses the title.
        statement: statementRaw.length >= 2 ? statementRaw : title,
        required,
        errors,
      });
    }
    return rows;
  }
}
