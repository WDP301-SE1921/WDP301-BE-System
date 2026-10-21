export type CsvRow = {
  rowNumber: number;
  kind: string;
  sequence: number | null;
  title: string;
  content: string;
  monthKey: string | null;
};

export function parseCurriculumCsv(buffer: Buffer): CsvRow[] {
  if (buffer.length > 5 * 1024 * 1024) throw new Error('CSV_TOO_LARGE');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  const records: Array<{ rowNumber: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let rowNumber = 1;
  const finishCell = (): void => {
    cells.push(cell);
    cell = '';
    closed = false;
  };
  const finishRow = (): void => {
    finishCell();
    records.push({ rowNumber, cells });
    cells = [];
    rowNumber = line + 1;
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
      } else {
        cell += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (char === '"') {
      if (cell || closed) throw new Error('CSV_INVALID_QUOTE');
      quoted = true;
    } else if (char === ',') finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      finishRow();
      line++;
    } else {
      if (closed && char !== ' ' && char !== '\t') throw new Error('CSV_INVALID_QUOTE');
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  if (cell || cells.length || closed) finishRow();
  if (!records.length) throw new Error('CSV_EMPTY');
  const header = records.shift()!.cells.map((value) => value.trim());
  const required = ['kind', 'sequence', 'title', 'content', 'monthKey'];
  if (new Set(header).size !== header.length || !required.every((name) => header.includes(name)))
    throw new Error('CSV_INVALID_HEADER');
  const rows = records.filter((record) => record.cells.some((value) => value.trim()));
  if (rows.length > 1000) throw new Error('CSV_TOO_MANY_ROWS');
  if (rows.some((record) => record.cells.length !== header.length))
    throw new Error('CSV_INVALID_COLUMNS');
  return rows.map((record) => {
    const get = (name: string): string => record.cells[header.indexOf(name)]?.trim() ?? '';
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
