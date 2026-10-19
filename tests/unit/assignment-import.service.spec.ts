import { HttpStatus } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { AcademicAiService } from '../../src/integrations/academic-ai.service';
import { AcademicAccessService } from '../../src/modules/academic/academic-access.service';
import { AssignmentImportService } from '../../src/modules/academic/assignment-import.service';

jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));
jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }));

const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
const csv = 'kind,prompt,choices,correctAnswer,rubric,maxScore\nESSAY,Giải thích,,,Lập luận,2';
function upload(name: string, body: Buffer): Express.Multer.File {
  return { originalname: name, size: body.length, buffer: body } as Express.Multer.File;
}

describe('assignment import preview', () => {
  let service: AssignmentImportService;
  let classroom: jest.Mock<Promise<void>, [AuthenticatedUser, string]>;
  let available: jest.Mock<boolean>;
  let json: jest.Mock<Promise<unknown>>;

  beforeEach(() => {
    jest.clearAllMocks();
    classroom = jest.fn<Promise<void>, [AuthenticatedUser, string]>().mockResolvedValue(undefined);
    available = jest.fn<boolean, []>().mockReturnValue(true);
    json = jest
      .fn<Promise<unknown>, []>()
      .mockResolvedValue({ questions: [{ kind: 'ESSAY', prompt: 'Giải thích' }] });
    service = new AssignmentImportService(
      { classroom } as unknown as AcademicAccessService,
      { available, json } as unknown as AcademicAiService,
    );
  });

  it('authorizes the role and class before reading any file or contacting AI', async () => {
    await expect(
      service.preview(
        { ...teacher, role: 'PARENT' },
        'class',
        upload('test.csv', Buffer.from(csv)),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(classroom).not.toHaveBeenCalled();
    classroom.mockRejectedValue(new AppError('FORBIDDEN', 'Other class', HttpStatus.FORBIDDEN));
    await expect(
      service.preview(teacher, 'other', upload('test.docx', Buffer.from([80, 75, 3, 4]))),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mammoth.extractRawText).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('previews CSV without AI or saving records', async () => {
    available.mockReturnValue(false);
    const preview = await service.preview(teacher, 'class', upload('test.csv', Buffer.from(csv)));
    expect(preview).toMatchObject({
      format: 'CSV',
      usedAi: false,
      warnings: [],
      fileName: 'test.csv',
    });
    expect(preview.questions).toHaveLength(1);
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects absent, oversized and mismatched binary files', async () => {
    await expect(service.preview(teacher, 'class')).rejects.toMatchObject({
      code: 'ASSIGNMENT_IMPORT_FILE_REQUIRED',
    });
    await expect(
      service.preview(teacher, 'class', upload('test.csv', Buffer.alloc(5 * 1024 * 1024 + 1))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_FILE_TOO_LARGE' });
    await expect(
      service.preview(teacher, 'class', upload('test.docx', Buffer.from(csv))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_INVALID_FILE_TYPE' });
  });

  it('reports unavailable AI before extracting a document', async () => {
    available.mockReturnValue(false);
    await expect(
      service.preview(teacher, 'class', upload('test.docx', Buffer.from([80, 75, 3, 4]))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_AI_UNAVAILABLE', statusCode: 503 });
    expect(mammoth.extractRawText).not.toHaveBeenCalled();
  });

  it('keeps source evidenced answers and omits invented keys/rubrics with warnings', async () => {
    jest
      .mocked(mammoth.extractRawText)
      .mockResolvedValue({ value: 'Q1: A or B?\nAnswer: A\nQ2: Explain.', messages: [] });
    json.mockResolvedValue({
      title: 'Bài tập',
      questions: [
        {
          kind: 'MULTIPLE_CHOICE',
          prompt: 'A or B?',
          choices: ['A', 'B'],
          correctAnswer: 'A',
          answerEvidence: 'Answer: A',
          maxScore: 2,
        },
        {
          kind: 'ESSAY',
          prompt: 'Explain.',
          rubric: 'Invented rubric',
          rubricEvidence: 'Invented rubric',
          maxScore: 3,
        },
      ],
    });
    const preview = await service.preview(
      teacher,
      'class',
      upload('test.docx', Buffer.from([80, 75, 3, 4])),
    );
    expect(preview.questions[0].correctAnswer).toBe('A');
    expect(preview.questions[1].rubric).toBeUndefined();
    expect(preview.warnings).toHaveLength(3);
    expect(preview.usedAi).toBe(true);
    expect(json).toHaveBeenCalledWith(expect.stringContaining('Never solve questions'), {
      sourceText: 'Q1: A or B?\nAnswer: A\nQ2: Explain.',
    });
  });

  it('rejects empty/scanned PDFs and releases the parser', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(PDFParse).mockImplementation(
      () =>
        ({
          getText: jest.fn().mockResolvedValue({ pages: [{ text: '' }], total: 1 }),
          destroy,
        }) as unknown as PDFParse,
    );
    await expect(
      service.preview(teacher, 'class', upload('test.pdf', Buffer.from('%PDF-1.7'))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_EMPTY_DOCUMENT' });
    expect(destroy).toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('reports encrypted PDFs distinctly and releases the parser on errors', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(PDFParse).mockImplementation(
      () =>
        ({
          getText: jest.fn().mockRejectedValue(new Error('Password required')),
          destroy,
        }) as unknown as PDFParse,
    );
    await expect(
      service.preview(teacher, 'class', upload('test.pdf', Buffer.from('%PDF-1.7'))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_ENCRYPTED_PDF' });
    expect(destroy).toHaveBeenCalled();
  });

  it('bounds extracted content and maps provider failure to a stable error', async () => {
    jest
      .mocked(mammoth.extractRawText)
      .mockResolvedValue({ value: 'x'.repeat(100001), messages: [] });
    await expect(
      service.preview(teacher, 'class', upload('test.docx', Buffer.from([80, 75, 3, 4]))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_TEXT_TOO_LARGE' });
    expect(json).not.toHaveBeenCalled();
    jest.mocked(mammoth.extractRawText).mockResolvedValue({ value: 'Question', messages: [] });
    json.mockRejectedValue(new Error('Provider rejected'));
    await expect(
      service.preview(teacher, 'class', upload('test.docx', Buffer.from([80, 75, 3, 4]))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_AI_FAILED' });
  });

  it('bounds PDF pages and preview warnings', async () => {
    jest.mocked(PDFParse).mockImplementation(
      () =>
        ({
          getText: jest.fn().mockResolvedValue({ pages: [{ text: 'Question' }], total: 101 }),
          destroy: jest.fn().mockResolvedValue(undefined),
        }) as unknown as PDFParse,
    );
    await expect(
      service.preview(teacher, 'class', upload('test.pdf', Buffer.from('%PDF-1.7'))),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IMPORT_TEXT_TOO_LARGE' });
    jest.mocked(mammoth.extractRawText).mockResolvedValue({ value: 'Question', messages: [] });
    json.mockResolvedValue({
      questions: Array.from({ length: 100 }, () => ({
        kind: 'MULTIPLE_CHOICE',
        prompt: 'Question',
        choices: ['A', 'B'],
        correctAnswer: 'A',
        answerEvidence: 'Not in document',
      })),
    });
    const preview = await service.preview(
      teacher,
      'class',
      upload('test.docx', Buffer.from([80, 75, 3, 4])),
    );
    expect(preview.warnings).toHaveLength(300);
    expect(preview.questions.every((question) => !question.correctAnswer)).toBe(true);
  });

  it('expires a stalled extraction without calling AI', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(mammoth.extractRawText).mockReturnValue(new Promise(() => undefined));
      const pending = service.preview(
        teacher,
        'class',
        upload('test.docx', Buffer.from([80, 75, 3, 4])),
      );
      const rejected = expect(pending).rejects.toMatchObject({
        code: 'ASSIGNMENT_IMPORT_EXTRACTION_FAILED',
      });
      await jest.advanceTimersByTimeAsync(15001);
      await rejected;
      expect(json).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
