import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Prisma } from '@prisma/client';
import {
  LearningOutcomeWriteDto,
  OutcomeSourceReviewDto,
} from '../../src/modules/academic/academic.dto';
import { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import type { NotificationRecipientsService } from '../../src/modules/notifications/notification-recipients.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';

const base = {
  code: 'TOAN-8-01',
  title: 'Giải phương trình',
  statement: 'Giải được phương trình bậc nhất một ẩn.',
};

async function errorsOf(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(LearningOutcomeWriteDto, body);
  return (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).map(
    (error) => error.property,
  );
}

describe('LearningOutcomeWriteDto with optional sources (B3)', () => {
  it('accepts a CLO without any source', async () => {
    expect(await errorsOf(base)).toEqual([]);
  });

  it('turns blank sources into null and keeps omitted ones undefined', async () => {
    const dto = plainToInstance(LearningOutcomeWriteDto, {
      ...base,
      sourceTitle: '',
      sourceUrl: '   ',
      sourceNote: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.sourceTitle).toBeNull();
    expect(dto.sourceUrl).toBeNull();
    expect(dto.sourceNote).toBeNull();
    expect(dto.sourceLocator).toBeUndefined();
  });

  it('still checks length and http(s) URLs when a source is given', async () => {
    expect(
      await errorsOf({
        ...base,
        sourceTitle: 'C',
        sourceUrl: 'https://moet.gov.vn/chuong-trinh.pdf',
        sourceLocator: 'x',
      }),
    ).toEqual(['sourceTitle', 'sourceLocator']);
    expect(await errorsOf({ ...base, sourceUrl: 'ftp://moet.gov.vn/chuong-trinh.pdf' })).toEqual([
      'sourceUrl',
    ]);
    expect(await errorsOf({ ...base, sourceUrl: 'moet.gov.vn/chuong-trinh.pdf' })).toEqual([
      'sourceUrl',
    ]);
  });

  it('accepts short sources such as "Trang 45" and a short statement (C29)', async () => {
    expect(
      await errorsOf({
        ...base,
        statement: 'Đọc hiểu',
        sourceTitle: 'SGK',
        sourceLocator: 'Trang 45',
        sourceUrl: 'http://a.vn',
      }),
    ).toEqual([]);
    expect(await errorsOf({ ...base, statement: 'x' })).toEqual(['statement']);
  });

  it('validates the source review body (C30)', async () => {
    const check = async (body: Record<string, unknown>): Promise<string[]> =>
      (
        await validate(plainToInstance(OutcomeSourceReviewDto, body), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((error) => error.property);
    expect(await check({ sourceLocator: 'Trang 45', sourceNote: 'Khớp' + ' ý' })).toEqual([]);
    expect(await check({ sourceLocator: 'x', sourceNote: 'ok' })).toEqual([
      'sourceLocator',
      'sourceNote',
    ]);
    expect(await check({ sourceLocator: 'Tr 5', sourceNote: 'Đúng ý', expectedRevision: 0 })).toEqual([
      'expectedRevision',
    ]);
  });

  it('rejects a non-string source with 400 instead of crashing', async () => {
    expect(await errorsOf({ ...base, sourceUrl: 123 })).toEqual(['sourceUrl']);
  });

  it('accepts an optional expectedRevision and rejects a bad one', async () => {
    expect(await errorsOf({ ...base, expectedRevision: 2 })).toEqual([]);
    expect(await errorsOf({ ...base, expectedRevision: 0 })).toEqual(['expectedRevision']);
  });
});

describe('curriculum review notifications for shared drafts (B2, C17)', () => {
  function events(submitter: string | null): {
    record: jest.Mock;
    service: NotificationEventsService;
    tx: Prisma.TransactionClient;
  } {
    const record = jest.fn();
    const tx = {
      curriculumUnit: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          designerId: 'designer-a',
          title: 'Toán 8',
          reviewerTeacherId: 'teacher',
          technicalReviewedAt: new Date(),
        }),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(submitter ? { actorUserId: submitter } : null),
      },
    };
    const service = new NotificationEventsService(
      { record } as unknown as NotificationsService,
      { roles: jest.fn().mockResolvedValue([]) } as unknown as NotificationRecipientsService,
    );
    return { record, service, tx: tx as unknown as Prisma.TransactionClient };
  }

  function recipientsOf(record: jest.Mock): unknown {
    return (record.mock.calls[0] as [unknown, { recipients: unknown }])[1].recipients;
  }

  it('tells both the author and the designer who submitted it last', async () => {
    const { record, service, tx } = events('designer-b');
    await service.curriculum(tx, 'teacher', 'unit', 'CURRICULUM_CHANGES_REQUESTED', 'Cần sửa.', 'k');
    expect(recipientsOf(record)).toEqual([{ userId: 'designer-a' }, { userId: 'designer-b' }]);
  });

  it('sends once when the author submitted it', async () => {
    const { record, service, tx } = events('designer-a');
    await service.curriculum(tx, 'manager', 'unit', 'CURRICULUM_APPROVED', 'Đã duyệt.', 'k');
    expect(recipientsOf(record)).toEqual([{ userId: 'designer-a' }]);
  });

  it('falls back to the author when no submission was audited', async () => {
    const { record, service, tx } = events(null);
    await service.curriculum(tx, 'manager', 'unit', 'CURRICULUM_APPROVED', 'Đã duyệt.', 'k');
    expect(recipientsOf(record)).toEqual([{ userId: 'designer-a' }]);
  });
});
