import { CsvFileError, csvNumberText, readCsv } from '../../src/common/csv/read-csv';

function readError(source: string, maxRows = 10, maxColumns?: number): CsvFileError {
  try {
    readCsv(Buffer.from(source), { maxRows, maxColumns });
  } catch (error) {
    if (error instanceof CsvFileError) return error;
    throw error;
  }
  throw new Error('Expected a CSV error');
}

describe('shared CSV reader', () => {
  it('numbers rows like Excel: header is row 1, blank rows count, cell line breaks do not', () => {
    const table = readCsv(Buffer.from('a,b\r\n"x\r\ny",1\r\n\r\n,\r\nz,2\r'), { maxRows: 10 });
    expect(table.header).toEqual({ rowNumber: 1, cells: ['a', 'b'] });
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['x\r\ny', '1'] },
      { rowNumber: 5, cells: ['z', '2'] },
    ]);
  });

  it('takes the separator from the header row only', () => {
    expect(readCsv(Buffer.from('a;b\nx,y;1'), { maxRows: 10 })).toMatchObject({
      delimiter: ';',
      rows: [{ cells: ['x,y', '1'] }],
    });
    expect(readCsv(Buffer.from('a,b\nx;y,1'), { maxRows: 10 }).delimiter).toBe(',');
    expect(readCsv(Buffer.from('"a;b",c\nx,y'), { maxRows: 10 }).delimiter).toBe(',');
    expect(readCsv(Buffer.from('a\nx'), { maxRows: 10 }).delimiter).toBe(',');
  });

  it('stops reading at the row and column limits', () => {
    expect(readError('a\n1\n\n2\n3', 2).code).toBe('CSV_TOO_MANY_ROWS');
    expect(readCsv(Buffer.from('a\n1\n\n\n2'), { maxRows: 2 }).rows).toHaveLength(2);
    expect(readError(`a\n${','.repeat(10)}`, 10, 5).rows).toEqual([
      { code: 'CSV_INVALID_COLUMNS', rowNumber: 2 },
    ]);
  });

  it('reports a file without any text as empty', () => {
    expect(readError('\uFEFF\r\n , \r\n').code).toBe('CSV_EMPTY');
  });

  it('reports an unclosed quote at the row where the cell starts', () => {
    expect(readError('a,b\n1,2\n3,"open\nstill open').rows).toEqual([
      { code: 'CSV_UNCLOSED_QUOTE', rowNumber: 3 },
    ]);
  });

  it('reads a decimal comma only from semicolon files', () => {
    expect(csvNumberText('0,5', ';')).toBe('0.5');
    expect(csvNumberText('0,5', ',')).toBe('0,5');
    expect(csvNumberText('1.000,5', ';')).toBe('1.000,5');
  });
});
