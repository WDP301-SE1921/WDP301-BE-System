import { criterionTotal, rubricCriteria, validateRubric } from '../../src/modules/academic/rubric';

const criteria = [
  { id: 'reasoning', title: 'Lập luận', description: 'Đúng phép biến đổi', maxScore: 3 },
  { id: 'result', title: 'Kết quả', description: 'Kết luận đúng', maxScore: 1 },
];
describe('structured rubric', () => {
  it('accepts legacy rubric and allows incomplete allocation only in draft', () => {
    expect(rubricCriteria(null)).toEqual([]);
    expect(() => validateRubric(criteria, 5, false)).not.toThrow();
    expect(() => validateRubric(criteria, 5)).toThrow(
      'Criterion points must equal question points',
    );
    expect(() => validateRubric(criteria, 4)).not.toThrow();
  });
  it('rejects duplicate ids and invalid criterion maxima', () => {
    expect(() => rubricCriteria([criteria[0], criteria[0]])).toThrow();
    for (const maxScore of [0, -1, NaN, Infinity, 101])
      expect(() => rubricCriteria([{ ...criteria[0], maxScore }])).toThrow();
  });
  it('calculates partial credit and does not trust an AI total', () => {
    expect(
      criterionTotal(criteria, [
        { criterionId: 'result', score: 0.5, feedback: 'Thiếu đơn vị' },
        { criterionId: 'reasoning', score: 2, feedback: 'Đúng một phần' },
      ]),
    ).toBe(2.5);
  });
  it.each([
    [],
    [{ criterionId: 'reasoning', score: 2, feedback: '' }],
    [
      { criterionId: 'reasoning', score: 2, feedback: '' },
      { criterionId: 'reasoning', score: 1, feedback: '' },
    ],
    [
      { criterionId: 'reasoning', score: 4, feedback: '' },
      { criterionId: 'result', score: 1, feedback: '' },
    ],
    [
      { criterionId: 'unknown', score: 2, feedback: '' },
      { criterionId: 'result', score: 1, feedback: '' },
    ],
    [
      { criterionId: 'reasoning', score: NaN, feedback: '' },
      { criterionId: 'result', score: 1, feedback: '' },
    ],
  ])('rejects missing, duplicate, unknown or out-of-range criterion scores %#', (...items) => {
    expect(() => criterionTotal(criteria, items)).toThrow();
  });
});
