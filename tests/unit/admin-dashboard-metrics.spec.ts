import {
  dailySeries,
  expiringWithoutRenewal,
  groupTotals,
  monthKeys,
  previousRange,
  resolveDashboardRange,
  sensitiveKind,
  topPayers,
  vietnamDay,
} from '../../src/modules/admin/admin-dashboard-metrics';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'NO_ERROR';
}

describe('vietnamDay', () => {
  it('uses the center day (UTC+7), not the UTC day', () => {
    expect(vietnamDay(new Date('2026-11-12T18:30:00.000Z'))).toBe('2026-11-13');
    expect(vietnamDay(new Date('2026-11-12T16:59:59.000Z'))).toBe('2026-11-12');
  });
});

describe('resolveDashboardRange', () => {
  it('defaults to the first day of the month through today', () => {
    expect(resolveDashboardRange({}, '2026-11-13')).toEqual({
      fromDate: '2026-11-01',
      toDate: '2026-11-13',
    });
  });

  it('never reaches past today so comparisons use elapsed days only', () => {
    expect(
      resolveDashboardRange({ fromDate: '2026-11-01', toDate: '2026-11-30' }, '2026-11-13'),
    ).toEqual({ fromDate: '2026-11-01', toDate: '2026-11-13' });
  });

  it('rejects a start after the end', () => {
    expect(
      code(() =>
        resolveDashboardRange({ fromDate: '2026-11-10', toDate: '2026-11-01' }, '2026-11-13'),
      ),
    ).toBe('INVALID_DATE_RANGE');
  });

  it('rejects ranges longer than 366 days', () => {
    expect(
      code(() =>
        resolveDashboardRange({ fromDate: '2025-01-01', toDate: '2026-11-13' }, '2026-11-13'),
      ),
    ).toBe('DATE_RANGE_TOO_LONG');
  });
});

describe('previousRange', () => {
  it('compares the same days of the previous month for a month-to-date range', () => {
    expect(previousRange('2026-11-01', '2026-11-13')).toEqual({
      fromDate: '2026-10-01',
      toDate: '2026-10-13',
    });
  });

  it('clamps to the end of a shorter previous month', () => {
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
    });
  });

  it('shifts other ranges back by their own length', () => {
    expect(previousRange('2026-11-07', '2026-11-13')).toEqual({
      fromDate: '2026-10-31',
      toDate: '2026-11-06',
    });
  });
});

describe('monthKeys', () => {
  it('lists the last n months ending with the current one', () => {
    expect(monthKeys('2026-02-15', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('dailySeries', () => {
  it('fills every day of the range, summing amounts by center day', () => {
    const rows = [
      { at: new Date('2026-11-01T02:00:00.000Z'), amount: 100 },
      { at: new Date('2026-11-01T18:00:00.000Z'), amount: 50 },
      { at: new Date('2026-11-01T05:00:00.000Z'), amount: 25 },
    ];
    expect(dailySeries(rows, '2026-11-01', '2026-11-03')).toEqual([
      { date: '2026-11-01', total: 125 },
      { date: '2026-11-02', total: 50 },
      { date: '2026-11-03', total: 0 },
    ]);
  });
});

describe('groupTotals', () => {
  it('sums by key, counts rows and sorts by total descending', () => {
    const rows = [
      { amount: 100, key: 'math' },
      { amount: 300, key: 'physics' },
      { amount: 50, key: 'math' },
      { amount: 10, key: null },
    ];
    expect(
      groupTotals(rows, (row) => (row.key ? { key: row.key, label: row.key.toUpperCase() } : null)),
    ).toEqual([
      { key: 'physics', label: 'PHYSICS', total: 300, receipts: 1 },
      { key: 'math', label: 'MATH', total: 150, receipts: 2 },
    ]);
  });
});

describe('topPayers', () => {
  it('groups by parent email case-insensitively with distinct students and classes', () => {
    const rows = [
      {
        parentEmail: 'A@x.com',
        studentName: 'Lan',
        classId: 'c1',
        amount: 200,
        at: new Date('2026-11-02T00:00:00Z'),
      },
      {
        parentEmail: 'a@x.com',
        studentName: 'Minh',
        classId: 'c2',
        amount: 300,
        at: new Date('2026-11-05T00:00:00Z'),
      },
      {
        parentEmail: 'b@x.com',
        studentName: 'Hoa',
        classId: 'c1',
        amount: 400,
        at: new Date('2026-11-03T00:00:00Z'),
      },
    ];
    expect(topPayers(rows, 5)).toEqual([
      {
        email: 'a@x.com',
        total: 500,
        receipts: 2,
        students: 2,
        classes: 2,
        lastAt: new Date('2026-11-05T00:00:00Z'),
      },
      {
        email: 'b@x.com',
        total: 400,
        receipts: 1,
        students: 1,
        classes: 1,
        lastAt: new Date('2026-11-03T00:00:00Z'),
      },
    ]);
  });

  it('keeps only the requested number of parents', () => {
    const rows = ['a', 'b', 'c'].map((name, index) => ({
      parentEmail: `${name}@x.com`,
      studentName: name,
      classId: 'c1',
      amount: index + 1,
      at: new Date('2026-11-01T00:00:00Z'),
    }));
    expect(topPayers(rows, 2).map((row) => row.email)).toEqual(['c@x.com', 'b@x.com']);
  });
});

describe('expiringWithoutRenewal', () => {
  const base = {
    status: 'ACTIVE',
    startDate: '2026-08-15',
    packageMonths: 3,
    monthlyFee: 900_000,
  };

  it('lists active packages ending within the window, soonest first, with an estimate', () => {
    const rows = expiringWithoutRenewal(
      [
        { ...base, id: 'e1', studentId: 's1', classId: 'c1', endDate: '2026-11-20' },
        { ...base, id: 'e2', studentId: 's2', classId: 'c1', endDate: '2026-11-15' },
        { ...base, id: 'e3', studentId: 's3', classId: 'c1', endDate: '2026-12-30' },
      ],
      '2026-11-13',
      14,
    );
    expect(rows.map((row) => [row.id, row.daysLeft, row.estimate])).toEqual([
      ['e2', 2, 2_700_000],
      ['e1', 7, 2_700_000],
    ]);
  });

  it('skips a package already renewed for the same student and class', () => {
    const rows = expiringWithoutRenewal(
      [
        { ...base, id: 'old', studentId: 's1', classId: 'c1', endDate: '2026-11-20' },
        {
          ...base,
          id: 'new',
          studentId: 's1',
          classId: 'c1',
          startDate: '2026-11-20',
          endDate: '2027-02-20',
        },
      ],
      '2026-11-13',
      30,
    );
    expect(rows).toEqual([]);
  });

  it('ignores ended enrollments and packages already past', () => {
    const rows = expiringWithoutRenewal(
      [
        {
          ...base,
          id: 'ended',
          studentId: 's1',
          classId: 'c1',
          status: 'ENDED',
          endDate: '2026-11-20',
        },
        { ...base, id: 'past', studentId: 's2', classId: 'c1', endDate: '2026-11-10' },
      ],
      '2026-11-13',
      30,
    );
    expect(rows).toEqual([]);
  });
});

describe('sensitiveKind', () => {
  it('classifies audit actions an admin must watch', () => {
    expect(sensitiveKind('ADMIN_RECORD_DELETE')).toBe('DELETE');
    expect(sensitiveKind('PARENT_ACCOUNT_DELETE')).toBe('DELETE');
    expect(sensitiveKind('ADMIN_RECORD_RESTORE')).toBe('RESTORE');
    expect(sensitiveKind('REGISTRATION_CANCEL_DRAFT')).toBe('CANCEL');
    expect(sensitiveKind('CLASS_SESSION_CANCELLED')).toBe('CANCEL');
    expect(sensitiveKind('CLASS_TEACHER_ASSIGNED')).toBe('TEACHER');
    expect(sensitiveKind('ADMIN_SESSIONS_REVOKE')).toBe('SECURITY');
    expect(sensitiveKind('STUDENT_END_STUDY')).toBe('END_STUDY');
  });

  it('returns null for routine actions', () => {
    expect(sensitiveKind('PROFILE_UPDATED')).toBeNull();
  });
});
