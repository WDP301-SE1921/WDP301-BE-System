import { Workbook } from 'exceljs';
import { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import {
  OUTCOME_IMPORT_TEMPLATE_HEADERS,
  OutcomeImportService,
  nextOutcomeCode,
} from '../../src/modules/academic/outcome-import.service';

const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;

async function xlsx(rows: unknown[][]): Promise<Express.Multer.File> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('S');
  for (const row of rows) sheet.addRow(row);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname: 'clo.xlsx', size: buffer.length } as Express.Multer.File;
}
function csv(text: string): Express.Multer.File {
  const buffer = Buffer.from(text, 'utf8');
  return { buffer, originalname: 'clo.csv', size: buffer.length } as Express.Multer.File;
}
const codeOf = (work: () => Promise<unknown>): Promise<{ code: string; details?: unknown }> =>
  work().then(
    () => {
      throw new Error('expected failure');
    },
    (error: AppError) => ({ code: error.code, details: error.details }),
  );

function setup(options: { status?: string; stored?: string[] } = {}): {
  service: OutcomeImportService;
  previews: Map<string, Record<string, unknown>>;
  created: Array<Record<string, unknown>>;
  tx: { codes: { rows: string[] } };
} {
  const previews = new Map<string, Record<string, unknown>>();
  const commits = new Map<string, Record<string, unknown>>();
  const created: Array<Record<string, unknown>> = [];
  const stored = options.stored ?? ['MATH-7-01'];
  const codes = { rows: stored };
  const tx = {
    codes,
    $queryRaw: jest.fn((parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join('?');
      if (sql.includes('FROM outcome_sets'))
        return Promise.resolve([{ status: options.status ?? 'DRAFT' }]);
      if (sql.includes('FROM outcome_import_commits'))
        return Promise.resolve([commits.get(String(values[1]))].filter(Boolean));
      return Promise.resolve(codes.rows.map((code) => ({ code })));
    }),
    outcomeImportCommit: {
      findUnique: jest.fn(({ where }: { where: { outcomeSetId_key: { key: string } } }) =>
        Promise.resolve(commits.get(where.outcomeSetId_key.key) ?? null),
      ),
      create: jest.fn(({ data }: { data: { key: string } }) => {
        commits.set(data.key, data);
        return Promise.resolve(data);
      }),
    },
    outcomeImportPreview: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(previews.get(where.id) ?? null),
      ),
    },
    learningOutcome: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: `lo-${created.length}` });
      }),
    },
    auditLog: { create: jest.fn() },
  };
  const db = {
    outcomeSet: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'set-1',
        status: options.status ?? 'DRAFT',
        program: { grade: 7, subjectRecord: { code: 'math' } },
        outcomes: stored.map((code) => ({ code })),
      }),
    },
    outcomeImportPreview: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `pv-${previews.size + 1}`, ...data };
        previews.set(row.id, row);
        return Promise.resolve(row);
      }),
    },
  };
  const repo = {
    db,
    transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as AcademicRepository;
  return { service: new OutcomeImportService(repo), previews, created, tx };
}

type PreviewResult = {
  previewId: string;
  summary: { rows: number; validRows: number; invalidRows: number };
  rows: Array<{
    rowNumber: number;
    code: string;
    required: boolean;
    errors: Array<{ field: string; code: string }>;
  }>;
};

describe('CLO import preview', () => {
  const header = ['Mã', 'Tên mục tiêu', 'Mô tả', 'Bắt buộc (Có/Không)'];

  it('reads Vietnamese headers, suggests blank codes and flags row errors', async () => {
    const { service } = setup();
    const file = await xlsx([
      header,
      ['', 'Giải phương trình', 'Mô tả dài', 'Không'],
      ['MATH-7-01', 'Trùng mã trong bộ', 'x', 'Có'],
      ['MATH-7-09', 'Hợp lệ', '', ''],
      ['MATH-7-09', 'Trùng trong file', 'y', 'Có'],
      ['MATH-7-20', '', 'thiếu tên', 'Có'],
      ['MATH-7-21', 'T'.repeat(256), 'quá dài', 'Có'],
    ]);
    const result = (await service.preview(designer, 'set-1', file)) as PreviewResult;
    const [blank, exists, ok, dup, noTitle, long] = result.rows;
    expect(blank).toMatchObject({ rowNumber: 2, code: 'MATH-7-22', required: false, errors: [] });
    expect(exists.errors).toEqual([{ field: 'code', code: 'CODE_EXISTS' }]);
    expect(ok).toMatchObject({ errors: [], required: true });
    expect(dup.errors).toEqual([{ field: 'code', code: 'DUPLICATE_CODE_IN_FILE' }]);
    expect(noTitle.errors).toEqual([{ field: 'title', code: 'TITLE_REQUIRED' }]);
    expect(long.errors).toEqual([{ field: 'title', code: 'VALUE_TOO_LONG' }]);
    expect(result.summary).toEqual({ rows: 6, validRows: 2, invalidRows: 4 });
  });

  it('accepts csv and english headers', async () => {
    const { service } = setup({ stored: [] });
    const result = (await service.preview(
      designer,
      'set-1',
      csv('code,title,statement,required\nA-01,Một,Mô tả một,yes\n'),
    )) as PreviewResult;
    expect(result.rows[0]).toMatchObject({ code: 'A-01', errors: [] });
  });

  it('suggests from the program when the set is empty', async () => {
    const { service } = setup({ stored: [] });
    const result = (await service.preview(
      designer,
      'set-1',
      csv('Mã,Tên mục tiêu\n,Một\n,Hai\n'),
    )) as PreviewResult;
    expect(result.rows.map((row) => row.code)).toEqual(['MATH-7-01', 'MATH-7-02']);
  });

  it('rejects unreadable files and a missing title column with details', async () => {
    const { service } = setup();
    for (const file of [
      { buffer: Buffer.from('x'), originalname: 'a.txt' } as Express.Multer.File,
      csv('Mã,Mô tả\nA,B\n'),
    ]) {
      const failure = await codeOf(() => service.preview(designer, 'set-1', file));
      expect(failure.code).toBe('OUTCOME_IMPORT_FILE_INVALID');
      expect(failure.details).toBeDefined();
    }
  });

  it('flags one-character codes and an empty file', async () => {
    const { service } = setup();
    const result = (await service.preview(
      designer,
      'set-1',
      csv('Mã,Tên mục tiêu\nA,Một\n'),
    )) as PreviewResult;
    expect(result.rows[0].errors).toEqual([{ field: 'code', code: 'VALUE_TOO_SHORT' }]);
    const failure = await codeOf(() => service.preview(designer, 'set-1', undefined));
    expect(failure).toMatchObject({
      code: 'OUTCOME_IMPORT_FILE_INVALID',
      details: { code: 'FILE_REQUIRED' },
    });
  });

  it('is designer only and needs a draft set', async () => {
    expect((await codeOf(() => setup().service.preview(teacher, 'set-1', csv('a')))).code).toBe(
      'FORBIDDEN',
    );
    const locked = setup({ status: 'APPROVED' });
    expect((await codeOf(() => locked.service.preview(designer, 'set-1', csv('a')))).code).toBe(
      'OUTCOME_SET_LOCKED',
    );
  });
});

describe('CLO import commit', () => {
  async function previewed(service: OutcomeImportService, text: string): Promise<string> {
    const result = (await service.preview(designer, 'set-1', csv(text))) as PreviewResult;
    return result.previewId;
  }

  it('creates every row once and replays the same key', async () => {
    const { service, created } = setup();
    const id = await previewed(service, 'Mã,Tên mục tiêu,Mô tả\nA-01,Một,Mô tả một\n,Hai,\n');
    const first = await service.commit(designer, 'set-1', id, 'key-1');
    const again = await service.commit(designer, 'set-1', id, 'key-1');
    expect(first).toMatchObject({ createdCount: 2 });
    expect(again).toEqual(first);
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({ code: 'MATH-7-02', statement: 'Hai', required: true });
  });

  it('refuses another preview under a used key, and a missing key', async () => {
    const { service } = setup();
    const a = await previewed(service, 'Tên mục tiêu\nMột\n');
    const b = await previewed(service, 'Tên mục tiêu\nHai\n');
    await service.commit(designer, 'set-1', a, 'key-1');
    expect((await codeOf(() => service.commit(designer, 'set-1', b, 'key-1'))).code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect((await codeOf(() => service.commit(designer, 'set-1', b, undefined))).code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });

  it('rejects rows with errors, foreign or expired previews, locked sets and other roles', async () => {
    const { service, previews, created } = setup();
    const bad = await previewed(service, 'Mã,Tên mục tiêu\nMATH-7-01,Một\n');
    expect((await codeOf(() => service.commit(designer, 'set-1', bad, 'k1'))).code).toBe(
      'INVALID_IMPORT',
    );
    const good = await previewed(service, 'Tên mục tiêu\nMột\n');
    expect(
      (await codeOf(() => service.commit({ ...designer, id: 'other' }, 'set-1', good, 'k2'))).code,
    ).toBe('OUTCOME_IMPORT_PREVIEW_STALE');
    expect((await codeOf(() => service.commit(designer, 'set-1', 'nope', 'k3'))).code).toBe(
      'OUTCOME_IMPORT_PREVIEW_STALE',
    );
    previews.get(good)!.expiresAt = new Date(Date.now() - 1000);
    expect((await codeOf(() => service.commit(designer, 'set-1', good, 'k4'))).code).toBe(
      'OUTCOME_IMPORT_PREVIEW_STALE',
    );
    expect((await codeOf(() => service.commit(teacher, 'set-1', good, 'k5'))).code).toBe(
      'FORBIDDEN',
    );
    const locked = setup({ status: 'REVIEWED' });
    expect((await codeOf(() => locked.service.commit(designer, 'set-1', 'x', 'k6'))).code).toBe(
      'OUTCOME_SET_LOCKED',
    );
    expect(created).toHaveLength(0);
  });

  it('turns a code taken after the preview into a stale preview', async () => {
    const { service, tx } = setup({ stored: [] });
    const id = await previewed(service, 'Mã,Tên mục tiêu\nA-01,Một\n');
    tx.codes.rows = ['a-01'];
    expect((await codeOf(() => service.commit(designer, 'set-1', id, 'k1'))).code).toBe(
      'OUTCOME_IMPORT_PREVIEW_STALE',
    );
  });
});

describe('CLO import template', () => {
  it('is an xlsx with the four headers and one example row', async () => {
    const { service } = setup();
    const file = await service.template(designer);
    expect(file.type).toContain('spreadsheetml');
    const workbook = new Workbook();
    await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, ...OUTCOME_IMPORT_TEMPLATE_HEADERS]);
    expect(sheet.rowCount).toBe(2);
    expect((await codeOf(() => service.template(teacher))).code).toBe('FORBIDDEN');
  });
});

describe('nextOutcomeCode', () => {
  it('increments the highest trailing number and keeps its width', () => {
    expect(nextOutcomeCode(['MATH-7-04', 'MATH-7-99'])).toBe('MATH-7-100');
    expect(nextOutcomeCode(['MATH-7-04'])).toBe('MATH-7-05');
    expect(nextOutcomeCode([], { subjectCode: 'math', grade: 7 })).toBe('MATH-7-01');
    expect(nextOutcomeCode([])).toBe('');
  });
});
