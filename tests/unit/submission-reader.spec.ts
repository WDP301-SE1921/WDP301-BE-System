import { execFileSync } from 'node:child_process';
import { SubmissionReaderService } from '../../src/modules/academic/submission-reader.service';
import * as PDFDocument from 'pdfkit';

describe('submission image reading evidence', () => {
  const file = { id: 'image', storageKey: 'private/key', mimeType: 'image/png', size: 50 };
  const questions = [{ id: 'q1', prompt: 'Giải phương trình' }];
  const good = {
    questionId: 'q1',
    answer: 'x = 4',
    readable: true,
    sources: [{ fileId: 'image', page: 1 }],
    reason: '',
  };
  const json = jest.fn<Promise<unknown>, [string, unknown, string[]]>();
  const readObject = jest.fn().mockResolvedValue(Buffer.from('test-image'));
  const visionAvailable = jest.fn().mockReturnValue(true);
  const reader = new SubmissionReaderService(
    { json, visionAvailable } as never,
    { readObject } as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    readObject.mockResolvedValue(Buffer.from('test-image'));
    visionAvailable.mockReturnValue(true);
    json.mockResolvedValue({ answers: [good] });
  });
  it('returns transcription and source page, sending bytes rather than public URLs', async () => {
    expect(await reader.read([file], questions, [])).toEqual([good]);
    expect(json.mock.calls[0][2][0]).toMatch(/^data:image\/png;base64,/);
  });

  it('does not expose answer keys or rubric to the transcription step', async () => {
    const questionWithPrivateFields = {
      ...questions[0],
      correctAnswer: 'secret',
      rubric: 'secret rubric',
      criteria: [{ title: 'secret' }],
    };
    await reader.read([file], [questionWithPrivateFields], []);
    expect(json.mock.calls[0][1]).toMatchObject({
      questions: [{ id: 'q1', prompt: 'Giải phương trình' }],
    });
    expect(JSON.stringify(json.mock.calls[0][1])).not.toContain('secret');
  });

  it('renders a real two-page PDF before sending images to vision AI', async () => {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ autoFirstPage: false });
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('error', reject);
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.addPage().text('Question 1: 2x + 3 = 11');
      pdf.addPage().text('Answer: x = 4');
      pdf.end();
    });
    // PDF.js loads an ESM worker; execute the actual service in Node, outside Jest's VM.
    const source = `
      const { readFileSync } = require('node:fs');
      const { SubmissionReaderService } = require(process.argv[1]);
      const buffer = readFileSync(0);
      let pageCount = 0, png = false;
      const service = new SubmissionReaderService({
        visionAvailable: () => true,
        json: async (_instruction, _data, images) => {
          pageCount = images.length; png = images.every(s => s.startsWith('data:image/png;base64,'));
          return { answers: [{ questionId: 'q1', answer: 'x = 4', readable: true, sources: [{ fileId: 'pdf', page: 2 }], reason: '' }] };
        }
      }, { readObject: async () => buffer });
      service.read([{ id: 'pdf', mimeType: 'application/pdf', size: buffer.length, storageKey: 'private' }], [{ id: 'q1', prompt: 'Solve' }], [])
        .then(rows => process.stdout.write(JSON.stringify({ pageCount, png, rows })))
        .catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
    `;
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register/transpile-only'),
        '-e',
        source,
        require.resolve('../../src/modules/academic/submission-reader.service'),
      ],
      { input: buffer, encoding: 'utf8', timeout: 30000, windowsHide: true },
    );
    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({
      pageCount: 2,
      png: true,
      rows: [{ sources: [{ fileId: 'pdf', page: 2 }] }],
    });
  });
  it('does not fetch private files if vision is not configured', async () => {
    visionAvailable.mockReturnValue(false);
    await expect(reader.read([file], questions, [])).rejects.toMatchObject({
      code: 'AI_VISION_UNAVAILABLE',
    });
    expect(readObject).not.toHaveBeenCalled();
  });
  it('returns a safe storage error without exposing a private key or upstream message', async () => {
    readObject.mockRejectedValue(new Error('private/key storage credential'));
    await expect(reader.read([file], questions, [])).rejects.toMatchObject({
      code: 'AI_FILE_UNAVAILABLE',
      message: 'Unable to read the submitted file',
    });
    expect(json).not.toHaveBeenCalled();
  });
  it('rejects source pages outside the explicit question file mapping', async () => {
    await expect(
      reader.read([file], questions, [{ questionId: 'q1', answer: '', fileIds: ['another-file'] }]),
    ).rejects.toMatchObject({ code: 'AI_READING_INVALID' });
  });
  it.each([
    { ...good, sources: [{ fileId: 'other', page: 1 }] },
    { ...good, sources: [{ fileId: 'image', page: 99 }] },
    { ...good, sources: [] },
    { ...good, questionId: 'unknown' },
    { ...good, answer: '' },
  ])('rejects fabricated sources or missing work %#', async (value) => {
    json.mockResolvedValue({ answers: [value] });
    await expect(reader.read([file], questions, [])).rejects.toMatchObject({
      code: 'AI_READING_INVALID',
    });
  });
  it('keeps unreadable answers for manual review without inventing a zero', async () => {
    json.mockResolvedValue({
      answers: [{ ...good, readable: false, answer: '', reason: 'Ảnh mờ' }],
    });
    expect((await reader.read([file], questions, []))[0].readable).toBe(false);
  });
  it('enforces aggregate upload limits before downloading', async () => {
    await expect(
      reader.read(
        Array.from({ length: 6 }, () => file),
        questions,
        [],
      ),
    ).rejects.toMatchObject({ code: 'AI_FILE_LIMIT' });
    expect(readObject).not.toHaveBeenCalled();
  });
});
