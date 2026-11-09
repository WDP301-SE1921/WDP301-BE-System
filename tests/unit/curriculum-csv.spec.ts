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
        rowNumber: 4,
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

  it.each(['', '2', '01', "'1", '1.0'])(
    'rejects unsupported or empty row version %s',
    (version) => {
      expect(() =>
        parseCurriculumCsv(
          Buffer.from(
            `kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Title,Text,,${version}`,
          ),
        ),
      ).toThrow('CSV_UNSUPPORTED_VERSION');
    },
  );

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
          'kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Title,Text,,1\nLESSON,2,Title,Text,,',
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
        rowNumber: 4,
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
});
