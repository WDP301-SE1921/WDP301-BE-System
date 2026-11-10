import { assertRule } from './academic-access.service';
import { isRecord } from '../../integrations/academic-ai.service';

export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  maxScore: number;
}
export interface CriterionScore {
  criterionId: string;
  score: number;
  feedback: string;
}
export function rubricCriteria(value: unknown): RubricCriterion[] {
  if (value == null) return [];
  assertRule(
    Array.isArray(value) && value.length <= 30,
    'INVALID_RUBRIC',
    'Rubric must contain at most 30 criteria',
  );
  const items = value as unknown[];
  assertRule(
    items.every(
      (c) =>
        isRecord(c) &&
        typeof c.id === 'string' &&
        c.id.length > 0 &&
        c.id.length <= 100 &&
        typeof c.title === 'string' &&
        c.title.trim().length > 0 &&
        c.title.length <= 255 &&
        typeof c.description === 'string' &&
        c.description.length <= 5000 &&
        typeof c.maxScore === 'number' &&
        Number.isFinite(c.maxScore) &&
        c.maxScore > 0 &&
        c.maxScore <= 100,
    ),
    'INVALID_RUBRIC',
    'Invalid rubric criterion',
  );
  const criteria = items as RubricCriterion[];
  assertRule(
    new Set(criteria.map((c) => c.id)).size === criteria.length,
    'INVALID_RUBRIC',
    'Duplicate criterion id',
  );
  return criteria;
}
export function validateRubric(value: unknown, maxScore: number, complete = true): void {
  const criteria = rubricCriteria(value);
  if (complete && criteria.length)
    assertRule(
      Math.abs(criteria.reduce((n, c) => n + c.maxScore, 0) - maxScore) < 0.005,
      'RUBRIC_TOTAL_MISMATCH',
      'Criterion points must equal question points',
    );
}
export function criterionTotal(criteria: RubricCriterion[], value: unknown): number {
  assertRule(
    Array.isArray(value) && value.length === criteria.length,
    'INVALID_CRITERION_SCORES',
    'Score every criterion',
  );
  const scores = value as unknown[];
  assertRule(
    scores.every(
      (s) =>
        isRecord(s) &&
        typeof s.criterionId === 'string' &&
        typeof s.score === 'number' &&
        Number.isFinite(s.score) &&
        typeof s.feedback === 'string' &&
        s.feedback.length <= 5000,
    ),
    'INVALID_CRITERION_SCORES',
    'Invalid criterion score',
  );
  const items = scores as CriterionScore[];
  assertRule(
    new Set(items.map((s) => s.criterionId)).size === items.length,
    'INVALID_CRITERION_SCORES',
    'Duplicate criterion score',
  );
  for (const c of criteria) {
    const item = items.find((s) => s.criterionId === c.id);
    assertRule(
      item && item.score >= 0 && item.score <= c.maxScore,
      'INVALID_CRITERION_SCORES',
      'Criterion score outside range',
    );
  }
  return Math.round(items.reduce((n, s) => n + s.score, 0) * 100) / 100;
}
