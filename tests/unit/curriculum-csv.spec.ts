import { Workbook } from 'exceljs';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import { CsvFileError } from '../../src/common/csv/read-csv';
import {
  parseCurriculumCsv,
  splitOutcomeCodes,
} from '../../src/modules/curriculum-scheduling/curriculum-csv';

const row = (extra: Record<string, unknown>): Record<string, unknown> => ({
  outcomeCodes: [],
  ...extra,
});

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Bài học');
  for (const values of rows) sheet.addRow(values);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('curriculum CSV parser', () => {
  it('decodes exported version 1 text before existing trim normalization', async () => {
    const rows = await parseCurriculumCsv(
      Buffer.from(
        '﻿kind,sequence,title,content,monthKey,csvVersion\r\n' +
          'LESSON,1,"\'  =Tập hợp, ""số""","\'\'Dòng 1\r\nDòng 2\\|\\q",,1\r\n' +
          "MONTHLY_TEST,,'ordinary,'\t﻿@Đề kiểm tra,2026-11,1\r\n",
      ),
    );
    expect(rows).toEqual([
      row({
        rowNumber: 2,
        kind: 'LESSON',
        sequence: 1,
        title: '=Tập hợp, "số"',
        content: "'Dòng 1\r\nDòng 2\\|\\q",
        monthKey: null,
      }),
      row({
        // Excel row: the line break inside the cell above does not start a new row.
        rowNumber: 3,
        kind: 'MONTHLY_TEST',
        sequence: null,
        title: "'ordinary",
        content: '@Đề kiểm tra',
        monthKey: '2026-11',
      }),
    ]);
  });

  it('keeps legacy text and extra legacy columns unchanged', async () => {
    const rows = await parseCurriculumCsv(
      Buffer.from(
        "kind,sequence,title,content,monthKey,oldExtra\nLESSON,1,'=Title,''Text,,ignored",
      ),
    );
    expect(rows[0]).toMatchObject({ title: "'=Title", content: "''Text", outcomeCodes: [] });
  });

  it.each(['2', '01', "'1", '1.0'])('rejects unsupported row version %s', async (version) => {
    await expect(
      parseCurriculumCsv(
        Buffer.from(
          `kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Title,Text,,${version}`,
        ),
      ),
    ).rejects.toThrow('CSV_UNSUPPORTED_VERSION');
  });

  it('only recognizes a final version column with the existing domain headers', async () => {
    for (const source of [
      'csvVersion,kind,sequence,title,content,monthKey\n1,LESSON,1,Title,Text,',
      'kind,sequence,title,content,monthKey,csvVersion,extra\nLESSON,1,Title,Text,,1,x',
      'kind,sequence,title,content,monthKey,csvVersion,csvVersion\nLESSON,1,Title,Text,,1,1',
    ])
      await expect(parseCurriculumCsv(Buffer.from(source))).rejects.toThrow('CSV_INVALID_HEADER');
    await expect(
      parseCurriculumCsv(
        Buffer.from(
          'kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Title,Text,,1\nLESSON,2,Title,Text,,2',
        ),
      ),
    ).rejects.toThrow('CSV_UNSUPPORTED_VERSION');
  });

  it('keeps the exact byte and row count bounds for versioned CSV', async () => {
    const header = 'kind,sequence,title,content,monthKey,csvVersion\n';
    const source = header + 'LESSON,1,Title,Text,,1\n';
    const limit = 5 * 1024 * 1024;
    const bytes = Buffer.concat([
      Buffer.from(source),
      Buffer.alloc(limit - Buffer.byteLength(source), ' '),
    ]);
    await expect(parseCurriculumCsv(bytes)).resolves.toHaveLength(1);
    await expect(parseCurriculumCsv(Buffer.concat([bytes, Buffer.from(' ')]))).rejects.toThrow(
      'CSV_TOO_LARGE',
    );
    await expect(
      parseCurriculumCsv(Buffer.from(header + 'LESSON,1,Title,Text,,1\n'.repeat(1000))),
    ).resolves.toHaveLength(1000);
    await expect(
      parseCurriculumCsv(Buffer.from(header + 'LESSON,1,Title,Text,,1\n'.repeat(1001))),
    ).rejects.toThrow('CSV_TOO_MANY_ROWS');
  });

  it('keeps Vietnamese text, quoted commas and multiline content', async () => {
    const rows = await parseCurriculumCsv(
      Buffer.from(
        '﻿kind,sequence,title,content,monthKey\r\nLESSON,1,"Tập hợp, số","Dòng 1\r\nDòng 2",\r\nMONTHLY_TEST,,Kiểm tra tháng 11,Đề kiểm tra,2026-11\r\n',
      ),
    );
    expect(rows).toEqual([
      row({
        rowNumber: 2,
        kind: 'LESSON',
        sequence: 1,
        title: 'Tập hợp, số',
        content: 'Dòng 1\r\nDòng 2',
        monthKey: null,
      }),
      row({
        rowNumber: 3,
        kind: 'MONTHLY_TEST',
        sequence: null,
        title: 'Kiểm tra tháng 11',
        content: 'Đề kiểm tra',
        monthKey: '2026-11',
      }),
    ]);
  });

  it('rejects malformed quoting and missing columns', async () => {
    await expect(parseCurriculumCsv(Buffer.from('kind,title\nLESSON,"unfinished'))).rejects.toThrow(
      'CSV_UNCLOSED_QUOTE',
    );
    await expect(parseCurriculumCsv(Buffer.from('kind,title\nLESSON,test'))).rejects.toThrow(
      'CSV_INVALID_HEADER',
    );
    await expect(
      parseCurriculumCsv(Buffer.from('kind,sequence,title,content,monthKey\nLESSON,1,Title,Text')),
    ).rejects.toThrow('CSV_INVALID_COLUMNS');
    await expect(
      parseCurriculumCsv(
        Buffer.from('kind,sequence,title,content,monthKey\nLESSON,1,Title,Text,,extra'),
      ),
    ).rejects.toThrow('CSV_INVALID_COLUMNS');
  });

  const excelHeader = 'kind;sequence;title;content;monthKey;csvVersion\r\n';

  async function csvError(source: string | Buffer): Promise<CsvFileError> {
    try {
      await parseCurriculumCsv(Buffer.isBuffer(source) ? source : Buffer.from(source));
    } catch (error) {
      if (error instanceof CsvFileError) return error;
      throw error;
    }
    throw new Error('Expected a CSV error');
  }

  it('reads a semicolon file saved by Excel, with or without BOM', async () => {
    const body = 'LESSON;1;"Tập hợp; số";Nội dung;;1\r\n';
    for (const source of [excelHeader + body, `﻿${excelHeader}${body}`])
      await expect(parseCurriculumCsv(Buffer.from(source))).resolves.toEqual([
        row({
          rowNumber: 2,
          kind: 'LESSON',
          sequence: 1,
          title: 'Tập hợp; số',
          content: 'Nội dung',
          monthKey: null,
        }),
      ]);
  });

  it('treats an empty csvVersion cell as version 1', async () => {
    const rows = await parseCurriculumCsv(
      Buffer.from(excelHeader + 'LESSON;1;Bài 1;A;;1\r\nLESSON;2;Bài 2;B;;\r\n'),
    );
    expect(rows.map((item) => [item.rowNumber, item.sequence])).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  it('ignores rows that only carry a filled-down csvVersion', async () => {
    const rows = await parseCurriculumCsv(
      Buffer.from(excelHeader + 'LESSON;1;Bài 1;A;;1\r\n;;;;;1\r\n;;;;;1\r\n'),
    );
    expect(rows).toHaveLength(1);
  });

  it('ignores empty trailing columns Excel writes for its used range', async () => {
    const rows = await parseCurriculumCsv(
      Buffer.from(
        'kind,sequence,title,content,monthKey,csvVersion,,\r\nLESSON,1,Bài 1,A,,1,,\r\n,,,,,,,\r\nLESSON,2,Bài 2,B,,1,,\r\n',
      ),
    );
    expect(rows.map((item) => item.rowNumber)).toEqual([2, 4]);
  });

  it('reports a Windows code page file as not UTF-8', async () => {
    // "Bài" saved as Windows-1258: 0xE0 is a lone lead byte in UTF-8.
    const source = Buffer.concat([
      Buffer.from('kind,sequence,title,content,monthKey\r\nLESSON,1,B'),
      Buffer.from([0xe0]),
      Buffer.from('i 1,A,\r\n'),
    ]);
    expect((await csvError(source)).details()).toEqual({
      code: 'CSV_NOT_UTF8',
      rows: [],
      rowErrorCount: 0,
    });
  });

  it('lists every structural problem by Excel row, capped at 20 rows', async () => {
    // Row 2 has a multiline cell, row 3 a wrong version, rows 4-27 a missing column.
    const lines = ['LESSON,1,"Dòng 1\r\nDòng 2",A,,1', 'LESSON,2,Bài 2,B,,2'];
    for (let index = 0; index < 24; index++) lines.push(`LESSON,${index + 3},Bài,C`);
    const error = await csvError(
      'kind,sequence,title,content,monthKey,csvVersion\r\n' + lines.join('\r\n'),
    );
    expect(error.code).toBe('CSV_UNSUPPORTED_VERSION');
    expect(error.rowErrorCount).toBe(25);
    expect(error.rows).toHaveLength(20);
    expect(error.rows.slice(0, 2)).toEqual([
      { code: 'CSV_UNSUPPORTED_VERSION', rowNumber: 3 },
      { code: 'CSV_INVALID_COLUMNS', rowNumber: 4 },
    ]);
  });

  it('gives the Excel row of a broken quote and of the header', async () => {
    expect(
      (await csvError('kind,sequence,title,content,monthKey\r\nLESSON,1,"Bài"x,A,\r\n')).rows,
    ).toEqual([{ code: 'CSV_INVALID_QUOTE', rowNumber: 2 }]);
    expect((await csvError('\r\nkind,title\r\nLESSON,Bài\r\n')).rows).toEqual([
      { code: 'CSV_INVALID_HEADER', rowNumber: 2 },
    ]);
  });

  describe('outcome codes and Excel', () => {
    it('reads the optional outcomeCodes column (comma or semicolon, distinct, trimmed)', async () => {
      const rows = await parseCurriculumCsv(
        Buffer.from(
          'kind,sequence,title,content,monthKey,outcomeCodes\r\n' +
            'LESSON,1,Bài 1,A,,"CLO1, CLO2;clo1"\r\nLESSON,2,Bài 2,B,,\r\n',
        ),
      );
      expect(rows.map((item) => item.outcomeCodes)).toEqual([['CLO1', 'CLO2'], []]);
    });

    it('accepts the Vietnamese header before csvVersion, but not both spellings', async () => {
      const rows = await parseCurriculumCsv(
        Buffer.from(
          'kind,sequence,title,content,monthKey,Mã mục tiêu,csvVersion\r\nLESSON,1,Bài 1,A,,CLO3,1\r\n',
        ),
      );
      expect(rows[0].outcomeCodes).toEqual(['CLO3']);
      await expect(
        parseCurriculumCsv(
          Buffer.from(
            'kind,sequence,title,content,monthKey,outcomeCodes,Mã mục tiêu\r\nLESSON,1,Bài 1,A,,A,B\r\n',
          ),
        ),
      ).rejects.toThrow('CSV_INVALID_HEADER');
    });

    it('reads an .xlsx file with and without the code column', async () => {
      const withCodes = await xlsx([
        ['kind', 'sequence', 'title', 'content', 'monthKey', 'outcomeCodes'],
        ['LESSON', 1, 'Tập hợp', 'Nội dung', '', 'CLO1, CLO2'],
        ['LESSON', 2, 'Số tự nhiên', 'Nội dung 2'],
      ]);
      await expect(parseCurriculumCsv(withCodes, 'bai-hoc.xlsx')).resolves.toEqual([
        row({
          rowNumber: 2,
          kind: 'LESSON',
          sequence: 1,
          title: 'Tập hợp',
          content: 'Nội dung',
          monthKey: null,
          outcomeCodes: ['CLO1', 'CLO2'],
        }),
        row({
          rowNumber: 3,
          kind: 'LESSON',
          sequence: 2,
          title: 'Số tự nhiên',
          content: 'Nội dung 2',
          monthKey: null,
        }),
      ]);
      const legacy = await xlsx([
        ['kind', 'sequence', 'title', 'content', 'monthKey'],
        ['LESSON', 1, 'Bài 1', 'A'],
      ]);
      await expect(parseCurriculumCsv(legacy, 'a.xlsx')).resolves.toHaveLength(1);
    });

    it('rejects a broken or wrongly named spreadsheet', async () => {
      await expect(parseCurriculumCsv(Buffer.from('PK\x03\x04garbage'), 'a.xlsx')).rejects.toThrow(
        'XLSX_INVALID',
      );
      const file = await xlsx([['kind']]);
      await expect(parseCurriculumCsv(file, 'a.csv')).rejects.toThrow('SPREADSHEET_UNSUPPORTED');
    });

    it('splits codes on comma, semicolon and line breaks', () => {
      expect(splitOutcomeCodes(' A1 ,B2;;a1\nC3 ')).toEqual(['A1', 'B2', 'C3']);
      expect(splitOutcomeCodes('')).toEqual([]);
    });
  });
});

describe('curriculum import with outcome codes', () => {
  const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
  const header = 'kind,sequence,title,content,monthKey,outcomeCodes\r\n';

  function setup(): {
    service: CurriculumSchedulingService;
    db: Record<string, Record<string, jest.Mock>>;
    stored: { rows: unknown };
  } {
    const unit = {
      id: 'unit',
      programId: 'program',
      designerId: designer.id,
      status: 'DRAFT',
      revision: 3,
      lessons: [],
    };
    const stored = { rows: null as unknown };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
      curriculumUnit: {
        findUnique: jest.fn().mockResolvedValue(unit),
        update: jest.fn().mockResolvedValue({ revision: 4 }),
      },
      learningOutcome: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'o-draft',
            code: 'CLO1',
            outcomeSetId: 'set-d',
            outcomeSet: { status: 'DRAFT', version: 1, level: 'L8' },
          },
          {
            id: 'o-app',
            code: 'CLO1',
            outcomeSetId: 'set-a',
            outcomeSet: { status: 'APPROVED', version: 1, level: 'L8' },
          },
          {
            id: 'o2',
            code: 'CLO2',
            outcomeSetId: 'set-d',
            outcomeSet: { status: 'DRAFT', version: 1, level: 'L8' },
          },
        ]),
      },
      curriculumImportPreview: {
        create: jest.fn().mockImplementation(({ data }: { data: { rows: unknown } }) => {
          stored.rows = data.rows;
          return Promise.resolve({ id: 'preview', expiresAt: new Date(Date.now() + 60_000) });
        }),
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: 'preview',
            unitId: 'unit',
            actorUserId: designer.id,
            mode: 'APPEND',
            expectedRevision: 3,
            expiresAt: new Date(Date.now() + 60_000),
            rows: stored.rows,
          }),
        ),
      },
      curriculumImportCommit: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      lesson: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', sequence: 1 },
          { id: 'l2', sequence: 2 },
        ]),
      },
      lessonOutcome: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ outcome: { outcomeSetId: 'set-old' } }]),
      },
      classSession: { count: jest.fn().mockResolvedValue(0) },
      curriculumFeedback: { count: jest.fn().mockResolvedValue(0) },
    };
    db.$transaction.mockImplementation((action: (tx: unknown) => Promise<unknown>) => action(db));
    return {
      service: new CurriculumSchedulingService(
        db as unknown as DatabaseService,
        { curriculum: jest.fn(), schedule: jest.fn() } as unknown as NotificationEventsService,
      ),
      db: db as unknown as Record<string, Record<string, jest.Mock>>,
      stored,
    };
  }

  const file = (text: string, name = 'bai.csv'): Express.Multer.File =>
    ({ buffer: Buffer.from(text), originalname: name }) as Express.Multer.File;

  type PreviewRows = { rows: Array<Record<string, unknown> & { errors: unknown[] }> };
  const withoutErrors = (preview: PreviewRows): Array<Record<string, unknown>> =>
    preview.rows.map(({ errors: _errors, ...rest }) => rest);

  it('flags an unknown CLO code as a row error and still previews the rest', async () => {
    const { service, db } = setup();
    const preview = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,"CLO1,CLO9"\r\nLESSON,2,Bài 2,B,,CLO2\r\n'),
      'APPEND',
    )) as PreviewRows & { summary: unknown };
    expect(preview.summary).toMatchObject({ rows: 2, validRows: 1, invalidRows: 1 });
    expect(preview.rows[0].outcomeCodes).toEqual(['CLO1', 'CLO9']);
    expect(preview.rows[0].errors).toEqual([
      { rowNumber: 2, field: 'outcomeCodes', code: 'UNKNOWN_OUTCOME_CODE', codes: ['CLO9'] },
    ]);
    expect(preview.rows[1].errors).toEqual([]);
    expect(db.lesson.createMany).not.toHaveBeenCalled();
  });

  it('accepts an .xlsx upload in the preview', async () => {
    const { service } = setup();
    const book = await xlsx([
      ['kind', 'sequence', 'title', 'content', 'monthKey', 'outcomeCodes'],
      ['LESSON', 1, 'Bài 1', 'A', '', 'CLO2'],
    ]);
    const preview = (await service.importPreview(
      designer,
      'unit',
      { buffer: book, originalname: 'bai.xlsx' } as Express.Multer.File,
      'APPEND',
    )) as { summary: unknown };
    expect(preview.summary).toMatchObject({ rows: 1, invalidRows: 0 });
  });

  it('keeps the CSV_REQUIRED code with a CSV-or-Excel message', async () => {
    const { service } = setup();
    await expect(
      service.importPreview(designer, 'unit', undefined, 'APPEND'),
    ).rejects.toMatchObject({
      code: 'CSV_REQUIRED',
      message: expect.stringContaining('Excel') as unknown,
    });
  });

  it('accepts a legacy CSV without the column and never reads the outcomes', async () => {
    const { service, db } = setup();
    const preview = (await service.importPreview(
      designer,
      'unit',
      file('kind,sequence,title,content,monthKey\nLESSON,1,Bài 1,A,\n'),
      'APPEND',
    )) as { summary: unknown };
    expect(preview.summary).toMatchObject({ invalidRows: 0 });
    expect(db.learningOutcome.findMany).not.toHaveBeenCalled();
  });

  it('commit links the new lessons to CLOs, preferring the approved set', async () => {
    const { service, db } = setup();
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,"CLO1,CLO2"\r\nLESSON,2,Bài 2,B,,\r\n'),
      'APPEND',
    )) as PreviewRows;
    await service.importCommit(
      designer,
      'unit',
      {
        previewId: 'preview',
        expectedRevision: 3,
        mode: 'APPEND',
        rows: withoutErrors(previewed),
      } as never,
      'key-1',
    );
    expect(db.lesson.createMany).toHaveBeenCalledTimes(1);
    expect(db.lessonOutcome.createMany).toHaveBeenCalledWith({
      data: [
        { lessonId: 'l1', outcomeId: 'o-app' },
        { lessonId: 'l1', outcomeId: 'o2' },
      ],
      skipDuplicates: true,
    });
  });

  it('commit refuses rows with an unknown code', async () => {
    const { service, db } = setup();
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,NOPE\r\n'),
      'APPEND',
    )) as PreviewRows;
    await expect(
      service.importCommit(
        designer,
        'unit',
        {
          previewId: 'preview',
          expectedRevision: 3,
          mode: 'APPEND',
          rows: withoutErrors(previewed),
        } as never,
        'key-2',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    expect(db.lesson.createMany).not.toHaveBeenCalled();
    expect(db.lessonOutcome.createMany).not.toHaveBeenCalled();
  });

  const outcome = (
    id: string,
    code: string,
    setId: string,
    status: string,
    version: number,
    level = 'L8',
  ): unknown => ({ id, code, outcomeSetId: setId, outcomeSet: { status, version, level } });

  it('picks the newest APPROVED set version, else the newest DRAFT', async () => {
    const { service, db } = setup();
    db.learningOutcome.findMany.mockResolvedValue([
      outcome('a1', 'CLO1', 'set-a1', 'APPROVED', 1),
      outcome('a2', 'CLO1', 'set-a2', 'APPROVED', 2),
      outcome('d3', 'CLO1', 'set-d3', 'DRAFT', 3),
      outcome('d1', 'CLO2', 'set-d1', 'DRAFT', 1),
      outcome('d2', 'CLO2', 'set-d2', 'DRAFT', 2),
    ]);
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,"CLO1,CLO2"\r\n'),
      'APPEND',
    )) as PreviewRows;
    expect(previewed.rows[0].errors).toEqual([]);
    await service.importCommit(
      designer,
      'unit',
      {
        previewId: 'preview',
        expectedRevision: 3,
        mode: 'APPEND',
        rows: withoutErrors(previewed),
      } as never,
      'key-3',
    );
    expect(db.lessonOutcome.createMany).toHaveBeenCalledWith({
      data: [
        { lessonId: 'l1', outcomeId: 'a2' },
        { lessonId: 'l1', outcomeId: 'd2' },
      ],
      skipDuplicates: true,
    });
  });

  it('flags a code that exists in APPROVED sets of different levels as ambiguous', async () => {
    const { service, db } = setup();
    db.learningOutcome.findMany.mockResolvedValue([
      outcome('a1', 'CLO1', 'set-a1', 'APPROVED', 2, 'L8'),
      outcome('a2', 'CLO1', 'set-a2', 'APPROVED', 1, 'L9'),
      outcome('o2', 'CLO2', 'set-d', 'DRAFT', 1),
    ]);
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,"CLO1,CLO2"\r\n'),
      'APPEND',
    )) as PreviewRows;
    expect(previewed.rows[0].errors).toEqual([
      { rowNumber: 2, field: 'outcomeCodes', code: 'AMBIGUOUS_OUTCOME_CODE', codes: ['CLO1'] },
    ]);
  });

  it('REPLACE locks old and new sets, removes old links first and writes the new ones', async () => {
    const { service, db } = setup();
    db.lesson.count.mockResolvedValue(0);
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,CLO2\r\n'),
      'REPLACE',
    )) as PreviewRows;
    db.curriculumImportPreview.findUnique.mockImplementation(() =>
      Promise.resolve({
        id: 'preview',
        unitId: 'unit',
        actorUserId: designer.id,
        mode: 'REPLACE',
        expectedRevision: 3,
        expiresAt: new Date(Date.now() + 60_000),
        rows: previewed.rows.map(({ errors: _errors, ...rest }) => rest),
      }),
    );
    await service.importCommit(
      designer,
      'unit',
      {
        previewId: 'preview',
        expectedRevision: 3,
        mode: 'REPLACE',
        rows: withoutErrors(previewed),
      } as never,
      'key-4',
    );
    const raw = db.$queryRaw as unknown as jest.Mock;
    const locks = raw.mock.calls.map((call) => (call as unknown[])[1]);
    expect(locks).toEqual(['unit', 'set-d', 'set-old']);
    expect(db.lessonOutcome.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      raw.mock.invocationCallOrder[2],
    );
    expect(db.lessonOutcome.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.lessonOutcome.createMany.mock.invocationCallOrder[0],
    );
    expect(db.lessonOutcome.createMany).toHaveBeenCalledWith({
      data: [{ lessonId: 'l1', outcomeId: 'o2' }],
      skipDuplicates: true,
    });
  });

  it('commit rows without the echoed outcomeCodes do not match the preview', async () => {
    const { service } = setup();
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,CLO2\r\n'),
      'APPEND',
    )) as PreviewRows;
    const rows = withoutErrors(previewed).map(({ outcomeCodes: _codes, ...rest }) => rest);
    await expect(
      service.importCommit(
        designer,
        'unit',
        { previewId: 'preview', expectedRevision: 3, mode: 'APPEND', rows } as never,
        'key-5',
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_PREVIEW_STALE' });
  });

  it('flags a row with more than 50 codes', async () => {
    const { service } = setup();
    const codes = Array.from({ length: 51 }, (_, index) => 'CLO' + (index + 1)).join(',');
    const previewed = (await service.importPreview(
      designer,
      'unit',
      file(header + 'LESSON,1,Bài 1,A,,"' + codes + '"\r\n'),
      'APPEND',
    )) as PreviewRows;
    expect(previewed.rows[0].errors).toEqual([
      { rowNumber: 2, field: 'outcomeCodes', code: 'TOO_MANY_OUTCOME_CODES' },
    ]);
  });
});

describe('curriculum import header and month tolerance', () => {
  it('matches the CLO header decomposed and in any case', async () => {
    const decomposed = 'Mã mục tiêu'.normalize('NFD').toUpperCase();
    const rows = await parseCurriculumCsv(
      Buffer.from(
        'kind,sequence,title,content,monthKey,' + decomposed + '\r\nLESSON,1,Bài,A,,X1\r\n',
      ),
    );
    expect(rows[0].outcomeCodes).toEqual(['X1']);
  });

  it('cuts an Excel date cell in monthKey to YYYY-MM', async () => {
    const book = await xlsx([
      ['kind', 'sequence', 'title', 'content', 'monthKey'],
      ['LESSON', 1, 'Bài 1', 'A', new Date('2026-01-01T00:00:00Z')],
    ]);
    const rows = await parseCurriculumCsv(book, 'a.xlsx');
    expect(rows[0].monthKey).toBe('2026-01');
  });
});
