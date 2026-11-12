import { Prisma } from '@prisma/client';

import {
  moneyText,
  weekdayName,
  weeklySlotsText,
} from '../../src/modules/registration-flow/registration-text';

describe('registration email text', () => {
  it('names ISO weekdays the Vietnamese way: Monday is Thứ 2, Sunday is Chủ nhật', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(weekdayName)).toEqual([
      'Thứ 2',
      'Thứ 3',
      'Thứ 4',
      'Thứ 5',
      'Thứ 6',
      'Thứ 7',
      'Chủ nhật',
    ]);
  });

  it('lists weekly slots in week order without changing the input', () => {
    const slots = [
      { weekday: 7, startTime: '08:00', endTime: '09:30' },
      { weekday: 1, startTime: '19:45', endTime: '21:15' },
      { weekday: 1, startTime: '18:00', endTime: '19:30' },
    ];
    expect(weeklySlotsText(slots)).toBe(
      'Thứ 2, 18:00-19:30; Thứ 2, 19:45-21:15; Chủ nhật, 08:00-09:30',
    );
    expect(slots[0]?.weekday).toBe(7);
  });

  it('groups money digits like a Vietnamese receipt', () => {
    expect(moneyText(new Prisma.Decimal('1500000.00'), 'VND')).toBe('1.500.000 VND');
    expect(moneyText('3600000', 'VND')).toBe('3.600.000 VND');
    expect(moneyText(1250.5, 'VND')).toBe('1.250,5 VND');
  });
});
