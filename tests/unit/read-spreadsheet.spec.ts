import { Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
import { CsvFileError } from '../../src/common/csv/read-csv';
import { readSpreadsheet } from '../../src/common/csv/read-spreadsheet';

async function xlsx(build: (sheet: Worksheet) => void): Promise<Buffer> {
  const workbook = new Workbook();
  build(workbook.addWorksheet('Sheet1'));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function errorOf(promise: Promise<unknown>): Promise<CsvFileError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CsvFileError) return error;
    throw error;
  }
  throw new Error('Expected a CsvFileError');
}

describe('shared spreadsheet reader', () => {
  it('reads xlsx like readCsv: diacritics, blank rows counted, numbers, rich text, formulas', async () => {
    const buffer = await xlsx((sheet) => {
      sheet.addRow(['Mã', 'Tên mục tiêu', 'Mô tả']);
      sheet.addRow(['CLO1', '  Giải phương trình  ', 5]);
      sheet.addRow([]);
      sheet.addRow([
        'CLO2',
        { richText: [{ text: 'Đọc ' }, { text: 'đồ thị' }] },
        { formula: 'A1', result: 'kết quả' },
      ]);
    });
    const table = await readSpreadsheet(buffer, 'mau.XLSX', { maxRows: 10 });
    expect(table.header).toEqual({ rowNumber: 1, cells: ['Mã', 'Tên mục tiêu', 'Mô tả'] });
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['CLO1', 'Giải phương trình', '5'] },
      { rowNumber: 4, cells: ['CLO2', 'Đọc đồ thị', 'kết quả'] },
    ]);
  });

  it('writes dates as yyyy-mm-dd', async () => {
    const buffer = await xlsx((sheet) => {
      sheet.addRow(['d']);
      sheet.addRow([new Date(Date.UTC(2026, 10, 19))]);
    });
    const table = await readSpreadsheet(buffer, 'a.xlsx', { maxRows: 5 });
    expect(table.rows[0].cells).toEqual(['2026-11-19']);
  });

  it('throws CSV_TOO_MANY_ROWS past maxRows and CSV_EMPTY for an empty sheet', async () => {
    const many = await xlsx((sheet) => {
      sheet.addRow(['a']);
      for (let i = 0; i < 4; i++) sheet.addRow([`v${i}`]);
    });
    const tooMany = await errorOf(readSpreadsheet(many, 'a.xlsx', { maxRows: 3 }));
    expect(tooMany.code).toBe('CSV_TOO_MANY_ROWS');
    const empty = await xlsx(() => undefined);
    expect((await errorOf(readSpreadsheet(empty, 'a.xlsx', { maxRows: 3 }))).code).toBe(
      'CSV_EMPTY',
    );
  });

  it('enforces the byte cap, reads csv by extension and rejects unknown or corrupt files', async () => {
    const buffer = await xlsx((sheet) => {
      sheet.addRow(['a']);
    });
    const big = await errorOf(readSpreadsheet(buffer, 'a.xlsx', { maxRows: 3, maxBytes: 10 }));
    expect(big.code).toBe('SPREADSHEET_TOO_LARGE');
    const csv = await readSpreadsheet(Buffer.from('Mã;Tên\nA;B'), 'a.csv', { maxRows: 3 });
    expect(csv).toMatchObject({ delimiter: ';', rows: [{ rowNumber: 2, cells: ['A', 'B'] }] });
    const unknown = await errorOf(readSpreadsheet(Buffer.from('a,b'), 'a.txt', { maxRows: 3 }));
    expect(unknown.code).toBe('SPREADSHEET_UNSUPPORTED');
    const corrupt = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage')]);
    expect((await errorOf(readSpreadsheet(corrupt, 'a.xlsx', { maxRows: 3 }))).code).toBe(
      'XLSX_INVALID',
    );
  });
  it('rejects a zip declaring a huge uncompressed size before loading it', async () => {
    const buffer = await xlsx((sheet) => {
      sheet.addRow(['a']);
    });
    const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const crafted = Buffer.from(buffer);
    crafted.writeUInt32LE(0x7fffffff, crafted.readUInt32LE(eocd + 16) + 24);
    const error = await errorOf(readSpreadsheet(crafted, 'a.xlsx', { maxRows: 3 }));
    expect(error.code).toBe('SPREADSHEET_TOO_LARGE');
    const small = await errorOf(
      readSpreadsheet(buffer, 'a.xlsx', { maxRows: 3, maxUncompressedBytes: 10 }),
    );
    expect(small.code).toBe('SPREADSHEET_TOO_LARGE');
  });
});
