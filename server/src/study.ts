import type { StudyConfig } from './config.js';

/** System Usability Scale: odd items score (v-1), even/reversed items score (5-v), summed and multiplied by 2.5. */
export function susScore(answers: Record<string, number>, q: StudyConfig['questionnaire']): number | null {
  if (q.type !== 'sus' || q.items.length !== 10) return null;
  let sum = 0;
  for (const it of q.items) {
    const v = answers[it.id];
    if (!Number.isInteger(v) || v < 1 || v > 5) return null;
    sum += it.reverse ? 5 - v : v - 1;
  }
  return sum * 2.5;
}
