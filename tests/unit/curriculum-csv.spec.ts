import { parseCurriculumCsv } from '../../src/modules/curriculum-scheduling/curriculum-csv';

describe('curriculum CSV parser', () => {
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
