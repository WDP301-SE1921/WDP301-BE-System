/** One structural problem of a CSV row. `rowNumber` is the row Excel shows (header = 1). */
export type CsvRowError = { code: string; rowNumber: number };

/** Clients read `details.rows` to say "Dòng N"; the list is capped so a broken file stays small. */
export const CSV_MAX_ROW_ERRORS = 20;

/**
 * Structural CSV failure. `message` is the code so existing callers keep matching on it;
 * `details()` is the stable `error.details` payload of the import routes.
 */
export class CsvFileError extends Error {
  constructor(
    public readonly code: string,
    public readonly rows: CsvRowError[] = [],
    public readonly rowErrorCount = rows.length,
  ) {
    super(code);
    this.name = CsvFileError.name;
  }

  static fromRows(errors: CsvRowError[]): CsvFileError {
    return new CsvFileError(errors[0].code, errors.slice(0, CSV_MAX_ROW_ERRORS), errors.length);
  }

  details(): { code: string; rows: CsvRowError[]; rowErrorCount: number } {
    return { code: this.code, rows: this.rows, rowErrorCount: this.rowErrorCount };
  }
}

export type CsvRecord = { rowNumber: number; cells: string[] };

export type CsvTable = { delimiter: ',' | ';'; header: CsvRecord; rows: CsvRecord[] };

export type ReadCsvOptions = {
  /** Non-blank data rows allowed; one more throws `CSV_TOO_MANY_ROWS` while reading. */
  maxRows: number;
  /** Cells allowed in one row, so a file of separators cannot allocate millions of cells. */
  maxColumns?: number;
  /** A row whose only value sits in this column (Excel users fill it down) counts as blank. */
  versionColumn?: string;
};

const DEFAULT_MAX_COLUMNS = 200;

/**
 * Reads a UTF-8 CSV saved by Excel or exported by the web app: drops the BOM, takes `,` or `;`
 * from the header row, keeps quoted separators and line breaks inside a cell, skips blank rows
 * and the empty trailing columns Excel writes for its used range.
 */
export function readCsv(buffer: Buffer, options: ReadCsvOptions): CsvTable {
  const source = decodeUtf8(buffer);
  const delimiter = headerDelimiter(source);
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const rows: CsvRecord[] = [];
  // Assigned inside finishRow; the cast keeps TypeScript from narrowing it to null below.
  let header = null as CsvRecord | null;
  let versionIndex = -1;
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let rowNumber = 1;
  const finishCell = (): void => {
    cells.push(cell);
    cell = '';
    closed = false;
    if (cells.length > maxColumns)
      throw new CsvFileError('CSV_INVALID_COLUMNS', [{ code: 'CSV_INVALID_COLUMNS', rowNumber }]);
  };
  const finishRow = (): void => {
    finishCell();
    const record = { rowNumber, cells };
    cells = [];
    rowNumber++;
    if (!header) {
      if (!record.cells.some(hasText)) return;
      header = { rowNumber: record.rowNumber, cells: withoutTrailingBlanks(record.cells, 0) };
      versionIndex = options.versionColumn
        ? header.cells.findIndex((name) => name.trim() === options.versionColumn)
        : -1;
      return;
    }
    const trimmed = withoutTrailingBlanks(record.cells, header.cells.length);
    if (!trimmed.some((value, index) => index !== versionIndex && hasText(value))) return;
    rows.push({ rowNumber: record.rowNumber, cells: trimmed });
    if (rows.length > options.maxRows) throw new CsvFileError('CSV_TOO_MANY_ROWS');
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell || closed) throw quoteError('CSV_INVALID_QUOTE', rowNumber);
      quoted = true;
    } else if (char === delimiter) finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      finishRow();
    } else {
      if (closed && char !== ' ' && char !== '\t') throw quoteError('CSV_INVALID_QUOTE', rowNumber);
      if (!closed) cell += char;
    }
  }
  if (quoted) throw quoteError('CSV_UNCLOSED_QUOTE', rowNumber);
  if (cell || cells.length || closed) finishRow();
  if (!header) throw new CsvFileError('CSV_EMPTY');
  return { delimiter, header, rows };
}

/** Rows a user adds in Excel often leave `csvVersion` empty; version 1 is the only version. */
export function isCsvVersionOne(value: string): boolean {
  const version = value.trim();
  return version === '' || version === '1';
}

/** Excel set to a Vietnamese locale writes `0,5` in a `;` file; `,` files keep `0.5` only. */
export function csvNumberText(value: string, delimiter: ',' | ';'): string {
  return delimiter === ';' && /^\d+,\d+$/.test(value) ? value.replace(',', '.') : value;
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    // Excel's plain "CSV (Comma delimited)" saves in the Windows code page (1258 in Vietnam).
    throw new CsvFileError('CSV_NOT_UTF8');
  }
}

/** Column names never contain `,` or `;`, so the header alone tells which one Excel used. */
function headerDelimiter(source: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  let lineHasText = false;
  for (const char of source) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) {
      // Leading blank lines are skipped like the reader does; the first line with text decides.
      if (lineHasText || commas || semicolons) break;
      continue;
    } else if (!quoted && char === ',') commas++;
    else if (!quoted && char === ';') semicolons++;
    if (char.trim()) lineHasText = true;
  }
  return semicolons > commas ? ';' : ',';
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/** Excel writes every column of its used range; blank cells past the header carry nothing. */
function withoutTrailingBlanks(cells: string[], keep: number): string[] {
  let end = cells.length;
  while (end > keep && !hasText(cells[end - 1])) end--;
  return end === cells.length ? cells : cells.slice(0, end);
}

function quoteError(code: string, rowNumber: number): CsvFileError {
  return new CsvFileError(code, [{ code, rowNumber }]);
}
