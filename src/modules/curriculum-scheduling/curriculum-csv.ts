import { decodeExportedCsvCell } from '../../common/csv/exported-cell';
import {
  CsvFileError,
  isCsvVersionOne,
  readCsv,
  type CsvRowError,
} from '../../common/csv/read-csv';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const REQUIRED = ['kind', 'sequence', 'title', 'content', 'monthKey'];

export type CsvRow = {
  rowNumber: number;
  kind: string;
  sequence: number | null;
  title: string;
  content: string;
  monthKey: string | null;
};

/**
 * Structural problems throw `CsvFileError` (message = code, `details()` lists rows). Content
 * problems such as a wrong `kind` or an empty title stay per-row errors of the import preview.
 */
export function parseCurriculumCsv(buffer: Buffer): CsvRow[] {
  if (buffer.length > MAX_BYTES) throw new CsvFileError('CSV_TOO_LARGE');
  const table = readCsv(buffer, { maxRows: MAX_ROWS, versionColumn: 'csvVersion' });
  const header = table.header.cells.map((value) => value.trim());
  const versioned = header.includes('csvVersion');
  if (
    new Set(header).size !== header.length ||
    !REQUIRED.every((name) => header.includes(name)) ||
    (versioned &&
      (header.length !== REQUIRED.length + 1 || header[header.length - 1] !== 'csvVersion'))
  )
    throw CsvFileError.fromRows([
      { code: 'CSV_INVALID_HEADER', rowNumber: table.header.rowNumber },
    ]);
  const errors: CsvRowError[] = [];
  for (const record of table.rows) {
    if (record.cells.length !== header.length)
      errors.push({ code: 'CSV_INVALID_COLUMNS', rowNumber: record.rowNumber });
    else if (versioned && !isCsvVersionOne(record.cells[header.length - 1]))
      errors.push({ code: 'CSV_UNSUPPORTED_VERSION', rowNumber: record.rowNumber });
  }
  if (errors.length) throw CsvFileError.fromRows(errors);
  return table.rows.map((record) => {
    const get = (name: string): string => {
      const value = record.cells[header.indexOf(name)] ?? '';
      return (versioned ? decodeExportedCsvCell(value) : value).trim();
    };
    const sequence = get('sequence');
    return {
      rowNumber: record.rowNumber,
      kind: get('kind'),
      sequence: sequence && /^\d+$/.test(sequence) ? Number(sequence) : null,
      title: get('title'),
      content: get('content'),
      monthKey: get('monthKey') || null,
    };
  });
}
