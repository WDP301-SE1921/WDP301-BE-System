import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as mammoth from 'mammoth';
import * as PDFDocument from 'pdfkit';

// A tiny, in-memory DOCX fixture avoids accepting a package mock as extraction evidence.
function docxBuffer(text: string): Buffer {
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      'word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ],
  ];
  const locals: Buffer[] = [];
  const entries: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of files) {
    const name = Buffer.from(path);
    const data = Buffer.from(content);
    const compressed = deflateRawSync(data);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    const block = Buffer.concat([local, name, compressed]);
    locals.push(block);
    entries.push(Buffer.concat([entry, name]));
    offset += block.length;
  }
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function pdfBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.text(text);
    document.end();
  });
}

describe('real assignment document extraction libraries', () => {
  it('extracts Vietnamese text from an actual DOCX archive', async () => {
    const result = await mammoth.extractRawText({
      buffer: docxBuffer('Câu 1: Giải thích phân số.'),
    });
    expect(result.value).toContain('Câu 1: Giải thích phân số.');
  });

  it('extracts text from an actual PDF and releases its parser', async () => {
    // PDF.js uses an ESM worker. Run it in real Node rather than Jest's VM sandbox.
    const source = `const { PDFParse } = require(process.argv[1]);
const { readFileSync } = require('node:fs');
const parser = new PDFParse({ data: readFileSync(0) });
(async () => {
  try {
    const result = await parser.getText({ first: 100 });
    process.stdout.write(JSON.stringify({ text: result.pages[0].text, total: result.total }));
  } finally { await parser.destroy(); }
})().catch(() => { process.exitCode = 1; });`;
    const output = execFileSync(process.execPath, ['-e', source, require.resolve('pdf-parse')], {
      input: await pdfBuffer('Question 1: Explain a fraction.'),
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({
      text: expect.stringContaining('Question 1: Explain a fraction.') as unknown,
      total: 1,
    });
  });
});
