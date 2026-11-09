import { CsvFileError } from '../../src/common/csv/read-csv';
import { parseCurriculumCsv } from '../../src/modules/curriculum-scheduling/curriculum-csv';

describe('curriculum CSV parser', () => {
  it('decodes exported version 1 text before existing trim normalization', () => {
    const rows = parseCurriculumCsv(
      Buffer.from(
        '\uFEFFkind,sequence,title,content,monthKey,csvVersion\r\n' +
          'LESSON,1,"\'  =Tập hợp, ""số""","\'\'Dòng 1\r\nDòng 2\\|\\q",,1\r\n' +
          "MONTHLY_TEST,,'ordinary,'\t\uFEFF@Đề kiểm tra,2026-11,1\r\n",
      ),
    );
    expect(rows).toEqual([
      {
        rowNumber: 2,
        kind: 'LESSON',
        sequence: 1,
        title: '=Tập hợp, "số"',
        content: "'Dòng 1\r\nDòng 2\\|\\q",
        monthKey: null,
      },
      {
        // Excel row: the line break inside the cell above does not start a new row.
        rowNumber: 3,
        kind: 'MONTHLY_TEST',
        sequence: null,
        title: "'ordinary",
        content: '@Đề kiểm tra',
        monthKey: '2026-11',
      },
    ]);
  });

  it('keeps legacy text and extra legacy columns unchanged', () => {
    expect(
      parseCurriculumCsv(
        Buffer.from(
          "kind,sequence,title,content,monthKey,oldExtra\nLESSON,1,'=Title,''Text,,ignored",
        ),
      )[0],
    ).toMatchObject({ title: "'=Title", content: "''Text" });
  });

  it.each(['2', '01', "'1", '1.0'])('rejects unsupported row version %s', (version) => {
    expect(() =>
      parseCurriculumCsv(
        Buffer.from(
          `kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Title,Text,,${version}`,
        ),
      ),
    ).toThrow('CSV_UNSUPPORTED_VERSION');
  });

  it('only recognizes a final version column with the existing domain headers', () => {
    for (const source of [
      'csvVersion,kind,sequence,title,content,monthKey\n1,LESSON,1,Title,Text,',
      'kind,sequence,title,content,monthKey,csvVersion,extra\nLESSON,1,Title,Text,,1,x',
      'kind,sequence,title,content,monthKey,csvVersion,csvVersion\nLESSON,1,Title,Text,,1,1',
    ])
      expect(() => parseCurriculumCsv(Buffer.from(source))).toThrow('CSV_INVALID_HEADER');
    expect(() =>
      parseCurriculumCsv(
        Buffer.from(
          'kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Title,Text,,1\nLESSON,2,Title,Text,,2',
        ),
      ),
    ).toThrow('CSV_UNSUPPORTED_VERSION');
  });

  it('keeps the exact byte and row count bounds for versioned CSV', () => {
    const header = 'kind,sequence,title,content,monthKey,csvVersion\n';
    const source = header + 'LESSON,1,Title,Text,,1\n';
    const limit = 5 * 1024 * 1024;
    const bytes = Buffer.concat([
      Buffer.from(source),
      Buffer.alloc(limit - Buffer.byteLength(source), ' '),
    ]);
    expect(parseCurriculumCsv(bytes)).toHaveLength(1);
    expect(() => parseCurriculumCsv(Buffer.concat([bytes, Buffer.from(' ')]))).toThrow(
      'CSV_TOO_LARGE',
    );
    expect(
      parseCurriculumCsv(Buffer.from(header + 'LESSON,1,Title,Text,,1\n'.repeat(1000))),
    ).toHaveLength(1000);
    expect(() =>
      parseCurriculumCsv(Buffer.from(header + 'LESSON,1,Title,Text,,1\n'.repeat(1001))),
    ).toThrow('CSV_TOO_MANY_ROWS');
  });

  it('keeps Vietnamese text, quoted commas and multiline content', () => {
    const rows = parseCurriculumCsv(
      Buffer.from(
        '\uFEFFkind,sequence,title,content,monthKey\r\nLESSON,1,"Tập hợp, số","Dòng 1\r\nDòng 2",\r\nMONTHLY_TEST,,Kiểm tra tháng 11,Đề kiểm tra,2026-11\r\n',
      ),
    );
    expect(rows).toEqual([
      {
        rowNumber: 2,
        kind: 'LESSON',
        sequence: 1,
        title: 'Tập hợp, số',
        content: 'Dòng 1\r\nDòng 2',
        monthKey: null,
      },
      {
        rowNumber: 3,
        kind: 'MONTHLY_TEST',
        sequence: null,
        title: 'Kiểm tra tháng 11',
        content: 'Đề kiểm tra',
        monthKey: '2026-11',
      },
    ]);
  });

  it('rejects malformed quoting and missing columns', () => {
    expect(() => parseCurriculumCsv(Buffer.from('kind,title\nLESSON,"unfinished'))).toThrow(
      'CSV_UNCLOSED_QUOTE',
    );
    expect(() => parseCurriculumCsv(Buffer.from('kind,title\nLESSON,test'))).toThrow(
      'CSV_INVALID_HEADER',
    );
    expect(() =>
      parseCurriculumCsv(Buffer.from('kind,sequence,title,content,monthKey\nLESSON,1,Title,Text')),
    ).toThrow('CSV_INVALID_COLUMNS');
    expect(() =>
      parseCurriculumCsv(
        Buffer.from('kind,sequence,title,content,monthKey\nLESSON,1,Title,Text,,extra'),
      ),
    ).toThrow('CSV_INVALID_COLUMNS');
  });

  const excelHeader = 'kind;sequence;title;content;monthKey;csvVersion\r\n';

  function csvError(source: string | Buffer): CsvFileError {
    try {
      parseCurriculumCsv(Buffer.isBuffer(source) ? source : Buffer.from(source));
    } catch (error) {
      if (error instanceof CsvFileError) return error;
      throw error;
    }
    throw new Error('Expected a CSV error');
  }

  it('reads a semicolon file saved by Excel, with or without BOM', () => {
    const body = 'LESSON;1;"Tập hợp; số";Nội dung;;1\r\n';
    for (const source of [excelHeader + body, `\uFEFF${excelHeader}${body}`])
      expect(parseCurriculumCsv(Buffer.from(source))).toEqual([
        {
          rowNumber: 2,
          kind: 'LESSON',
          sequence: 1,
          title: 'Tập hợp; số',
          content: 'Nội dung',
          monthKey: null,
        },
      ]);
  });

  it('treats an empty csvVersion cell as version 1', () => {
    const rows = parseCurriculumCsv(
      Buffer.from(excelHeader + 'LESSON;1;Bài 1;A;;1\r\nLESSON;2;Bài 2;B;;\r\n'),
    );
    expect(rows.map((row) => [row.rowNumber, row.sequence])).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  it('ignores rows that only carry a filled-down csvVersion', () => {
    const rows = parseCurriculumCsv(
      Buffer.from(excelHeader + 'LESSON;1;Bài 1;A;;1\r\n;;;;;1\r\n;;;;;1\r\n'),
    );
    expect(rows).toHaveLength(1);
  });

  it('ignores empty trailing columns Excel writes for its used range', () => {
    const rows = parseCurriculumCsv(
      Buffer.from(
        'kind,sequence,title,content,monthKey,csvVersion,,\r\nLESSON,1,Bài 1,A,,1,,\r\n,,,,,,,\r\nLESSON,2,Bài 2,B,,1,,\r\n',
      ),
    );
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  });

  it('reports a Windows code page file as not UTF-8', () => {
    // "Bài" saved as Windows-1258: 0xE0 is a lone lead byte in UTF-8.
    const source = Buffer.concat([
      Buffer.from('kind,sequence,title,content,monthKey\r\nLESSON,1,B'),
      Buffer.from([0xe0]),
      Buffer.from('i 1,A,\r\n'),
    ]);
    expect(csvError(source).details()).toEqual({
      code: 'CSV_NOT_UTF8',
      rows: [],
      rowErrorCount: 0,
    });
  });

  it('lists every structural problem by Excel row, capped at 20 rows', () => {
    // Row 2 has a multiline cell, row 3 a wrong version, rows 4-27 a missing column.
    const lines = ['LESSON,1,"Dòng 1\r\nDòng 2",A,,1', 'LESSON,2,Bài 2,B,,2'];
    for (let index = 0; index < 24; index++) lines.push(`LESSON,${index + 3},Bài,C`);
    const error = csvError(
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

  it('gives the Excel row of a broken quote and of the header', () => {
    expect(csvError('kind,sequence,title,content,monthKey\r\nLESSON,1,"Bài"x,A,\r\n').rows).toEqual(
      [{ code: 'CSV_INVALID_QUOTE', rowNumber: 2 }],
    );
    expect(csvError('\r\nkind,title\r\nLESSON,Bài\r\n').rows).toEqual([
      { code: 'CSV_INVALID_HEADER', rowNumber: 2 },
    ]);
  });
});
