import { Workbook } from 'exceljs';
import type { CellValue, Row } from 'exceljs';
import { CsvFileError, readCsv } from './read-csv';
import type { CsvRecord, CsvTable, ReadCsvOptions } from './read-csv';

export type ReadSpreadsheetOptions = ReadCsvOptions & {
  /** File size cap in bytes; a bigger buffer throws `SPREADSHEET_TOO_LARGE` before parsing. */
  maxBytes?: number;
  /** Total inflated size of all zip entries of an .xlsx; default 30 MB (zip bomb guard). */
  maxUncompressedBytes?: number;
};

const DEFAULT_MAX_UNCOMPRESSED = 30 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_COLUMNS = 200;
/** Every .xlsx is a zip archive: `PK\x03\x04`. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Reads the first sheet of an `.xlsx`, or a `.csv` through `readCsv`, into the same table shape.
 * Failures are `CsvFileError`: `SPREADSHEET_TOO_LARGE`, `SPREADSHEET_UNSUPPORTED` (neither type),
 * `XLSX_INVALID` (corrupt or no sheet), `CSV_TOO_MANY_ROWS`, `CSV_INVALID_COLUMNS`, `CSV_EMPTY`,
 * plus the CSV codes. Cell values become trimmed text; a blank row is skipped but still counts
 * in the row numbers (header = the first row with text, as Excel shows it).
 */
export async function readSpreadsheet(
  buffer: Buffer,
  filename: string,
  options: ReadSpreadsheetOptions,
): Promise<CsvTable> {
  if (buffer.length > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
    throw new CsvFileError('SPREADSHEET_TOO_LARGE');
  }
  const isZip = buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC);
  const name = filename.trim().toLowerCase();
  if (isZip && !name.endsWith('.csv')) return readXlsx(buffer, options);
  if (!isZip && name.endsWith('.csv')) return readCsv(buffer, options);
  throw new CsvFileError('SPREADSHEET_UNSUPPORTED');
}

async function readXlsx(buffer: Buffer, options: ReadSpreadsheetOptions): Promise<CsvTable> {
  assertZipSize(buffer, options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED);
  const workbook = new Workbook();
  try {
    // exceljs types want the old Buffer type; the runtime accepts any Buffer.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new CsvFileError('XLSX_INVALID');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new CsvFileError('XLSX_INVALID');
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  let header = null as CsvRecord | null;
  let versionIndex = -1;
  const rows: CsvRecord[] = [];
  const tooWide = (rowNumber: number): CsvFileError =>
    new CsvFileError('CSV_INVALID_COLUMNS', [{ code: 'CSV_INVALID_COLUMNS', rowNumber }]);
  sheet.eachRow({ includeEmpty: false }, (row: Row, rowNumber: number) => {
    const cells = rowCells(row);
    if (!header) {
      if (!cells.some(hasText)) return;
      const trimmed = withoutTrailingBlanks(cells, 0);
      if (trimmed.length > maxColumns) throw tooWide(rowNumber);
      header = { rowNumber, cells: trimmed };
      versionIndex = options.versionColumn ? trimmed.indexOf(options.versionColumn) : -1;
      return;
    }
    const trimmed = withoutTrailingBlanks(cells, header.cells.length);
    if (!trimmed.some((value, index) => index !== versionIndex && hasText(value))) return;
    if (trimmed.length > maxColumns) throw tooWide(rowNumber);
    rows.push({ rowNumber, cells: trimmed });
    if (rows.length > options.maxRows) throw new CsvFileError('CSV_TOO_MANY_ROWS');
  });
  if (!header) throw new CsvFileError('CSV_EMPTY');
  return { delimiter: ',', header, rows };
}

function rowCells(row: Row): string[] {
  const cells: string[] = [];
  for (let column = 1; column <= row.cellCount; column++) {
    cells.push(cellText(row.getCell(column).value));
  }
  return cells;
}

function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  if ('richText' in value) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }
  if ('error' in value) return '';
  if ('formula' in value || 'sharedFormula' in value) return cellText(value.result as CellValue);
  if ('text' in value) return cellText(value.text as CellValue); // hyperlink
  return '';
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function withoutTrailingBlanks(cells: string[], keep: number): string[] {
  let end = cells.length;
  while (end > keep && !hasText(cells[end - 1])) end--;
  return end === cells.length ? cells : cells.slice(0, end);
}

/**
 * Reads the zip central directory (no inflating) and rejects archives with too many entries or a
 * declared uncompressed size over the cap, before exceljs builds the whole cell model.
 */
function assertZipSize(buffer: Buffer, maxUncompressed: number): void {
  const invalid = (): CsvFileError => new CsvFileError('XLSX_INVALID');
  const tooLarge = (): CsvFileError => new CsvFileError('SPREADSHEET_TOO_LARGE');
  let eocd = -1;
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();
  const entries = buffer.readUInt16LE(eocd + 10);
  const dirOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || dirOffset === 0xffffffff) throw tooLarge(); // zip64: not a normal xlsx
  if (entries > MAX_ZIP_ENTRIES) throw tooLarge();
  let total = 0;
  let offset = dirOffset;
  for (let entry = 0; entry < entries; entry++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff) throw tooLarge();
    total += size;
    if (total > maxUncompressed) throw tooLarge();
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}
