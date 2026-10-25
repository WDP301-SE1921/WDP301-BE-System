import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { dateTimeRange, pageArray } from '../../src/common/list-query';
import {
  AcademicProgramQueryDto,
  AssignmentQueryDto,
} from '../../src/modules/academic/academic-list.dto';

describe('list query contract', () => {
  it('includes the entire center-local day and rejects reversed ranges', () => {
    const range = dateTimeRange('2026-10-24', '2026-10-24');
    expect(range.gte?.toISOString()).toBe('2026-10-23T17:00:00.000Z');
    expect(range.lte?.toISOString()).toBe('2026-10-24T16:59:59.999Z');
    expect(() => dateTimeRange('2026-10-25', '2026-10-24')).toThrow('fromDate');
    expect(() => dateTimeRange('2026-02-30')).toThrow('valid calendar date');
    expect(dateTimeRange('2026-10-24T10:00:00').gte?.toISOString()).toBe(
      '2026-10-24T03:00:00.000Z',
    );
  });

  it('parses false without coercing it to true and rejects invalid paging/status', async () => {
    const query = plainToInstance(AcademicProgramQueryDto, {
      page: '2',
      limit: '10',
      isActive: 'false',
      paginated: 'true',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query).toMatchObject({ page: 2, limit: 10, isActive: false, paginated: true });
    const invalid = plainToInstance(AssignmentQueryDto, {
      page: '0',
      limit: '101',
      status: 'UNKNOWN',
    });
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['page', 'limit', 'status']),
    );
  });

  it('keeps the full filtered total for out-of-range pages', () => {
    expect(pageArray(['a', 'b'], { page: 3, limit: 1, paginated: true })).toEqual({
      items: [],
      page: 3,
      limit: 1,
      total: 2,
    });
  });
});
