import { decodeExportedCsvCell } from '../../common/csv/exported-cell';
import { CsvFileError, isCsvVersionOne, type CsvRowError } from '../../common/csv/read-csv';
import { readSpreadsheet } from '../../common/csv/read-spreadsheet';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_CODES_PER_ROW = 50;
const REQUIRED = ['kind', 'sequence', 'title', 'content', 'monthKey'];
/** Optional column with the CLO codes of a lesson; both header spellings are accepted. */
const OUTCOME_HEADERS = ['outcomeCodes', 'Mã mục tiêu'].map(normalizeHeader);

/** Unikey may type accents decomposed, and people change letter case. */
function normalizeHeader(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type CsvRow = {
  rowNumber: number;
  kind: string;
  sequence: number | null;
  title: string;
  content: string;
  monthKey: string | null;
  /** Distinct CLO codes written in the file (empty without the optional column). */
  outcomeCodes: string[];
};

/** Splits "A1, A2;A3" into distinct trimmed codes, first spelling wins, case-insensitive. */
export function splitOutcomeCodes(value: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of value.split(/[,;\n]/)) {
    const code = part.trim();
    if (code && !seen.has(code.toUpperCase())) {
      seen.add(code.toUpperCase());
      codes.push(code);
    }
  }
  return codes;
}

/**
 * Reads a `.csv` or `.xlsx` lesson file. Structural problems throw `CsvFileError` (message =
 * code, `details()` lists rows). Content problems such as a wrong `kind` or an empty title stay
 * per-row errors of the import preview.
 */
export async function parseCurriculumCsv(
  buffer: Buffer,
  filename = 'import.csv',
): Promise<CsvRow[]> {
  if (buffer.length > MAX_BYTES) throw new CsvFileError('CSV_TOO_LARGE');
  const isXlsx = buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC);
  // Text files were accepted under any name before Excel support, so only a zip keeps its name.
  const table = await readSpreadsheet(buffer, isXlsx ? filename : 'import.csv', {
    maxRows: MAX_ROWS,
    versionColumn: 'csvVersion',
  });
  const header = table.header.cells.map((value) => value.trim());
  const versioned = header.includes('csvVersion');
  const outcomeColumns = header.flatMap((name, index) =>
    OUTCOME_HEADERS.includes(normalizeHeader(name)) ? [index] : [],
  );
  const outcomeIndex = outcomeColumns.length ? outcomeColumns[0] : -1;
  const knownColumns = REQUIRED.length + (outcomeColumns.length ? 1 : 0) + 1;
  if (
    new Set(header).size !== header.length ||
    !REQUIRED.every((name) => header.includes(name)) ||
    outcomeColumns.length > 1 ||
    (versioned && (header.length !== knownColumns || header[header.length - 1] !== 'csvVersion'))
  )
    throw CsvFileError.fromRows([
      { code: 'CSV_INVALID_HEADER', rowNumber: table.header.rowNumber },
    ]);
  const errors: CsvRowError[] = [];
  // Excel drops trailing empty cells of a row, so only text files must match the header width.
  const cellsOf = (cells: string[]): string[] =>
    isXlsx && cells.length < header.length
      ? [...cells, ...Array<string>(header.length - cells.length).fill('')]
      : cells;
  for (const record of table.rows) {
    const cells = cellsOf(record.cells);
    if (cells.length !== header.length)
      errors.push({ code: 'CSV_INVALID_COLUMNS', rowNumber: record.rowNumber });
    else if (versioned && !isCsvVersionOne(cells[header.length - 1]))
      errors.push({ code: 'CSV_UNSUPPORTED_VERSION', rowNumber: record.rowNumber });
  }
  if (errors.length) throw CsvFileError.fromRows(errors);
  return table.rows.map((record) => {
    const cells = cellsOf(record.cells);
    const at = (index: number): string => {
      const value = cells[index] ?? '';
      return (versioned ? decodeExportedCsvCell(value) : value).trim();
    };
    const get = (name: string): string => at(header.indexOf(name));
    // An Excel date cell reads as YYYY-MM-DD; the month key is only YYYY-MM.
    const month = get('monthKey').replace(/^(\d{4}-\d{2})-\d{2}$/, '$1');
    const sequence = get('sequence');
    return {
      rowNumber: record.rowNumber,
      kind: get('kind'),
      sequence: sequence && /^\d+$/.test(sequence) ? Number(sequence) : null,
      title: get('title'),
      content: get('content'),
      monthKey: month || null,
      outcomeCodes: outcomeIndex >= 0 ? splitOutcomeCodes(at(outcomeIndex)) : [],
    };
  });
}

export { MAX_CODES_PER_ROW };
