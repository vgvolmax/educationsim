import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { prepareLesson } from '../../src/lessons/authoring';
import { createLessonAttempt } from '../../src/lessons/lesson';
import { replay } from '../../src/simulation/replay';
import type { PreparedLesson } from '../../src/lessons/authoring';

const lessons = Array.from({ length: 15 }, (_, i) => 'L' + String(i + 1).padStart(2, '0'));
const read = (path: string) => JSON.parse(readFileSync(new URL('../../content/lessons/' + path, import.meta.url), 'utf8')) as unknown;
const manifest = () => read('evidence/attempts.json') as Record<string, { success: string[]; incorrect: string[] }>;
function prepared(id: string): PreparedLesson {
  const result = prepareLesson(read(id + '.json'));
  if (!result.ok) throw new Error(id + ': ' + JSON.stringify(result.diagnostics));
  return result.value;
}

test('all_lesson_definitions_validate_and_reference_known_components and match canonical IDs', () => {
  for (const id of lessons) {
    const p = prepared(id);
    expect(p.definition.id).toBe(id);
    expect(p.definition.goal.length).toBeGreaterThan(40);
    expect(p.definition.hints.length).toBeGreaterThan(0);
    expect(p.definition.criteria.some(({ type }) => type === 'range' || type === 'difference')).toBe(true);
  }
});
test.each(lessons)('%s has archived successful and incorrect attempts with deterministic replay', (id) => {
  const proof = manifest()[id], lesson = prepared(id);
  expect(proof?.success.length).toBeGreaterThan(1);
  expect(proof?.incorrect.length).toBeGreaterThan(0);
  const run = createLessonAttempt(lesson);
  for (const action of proof!.success) expect(run.perform(action), id + ':' + action).toBe(true);
  expect(run.score().rows.filter((row) => !row.passed), JSON.stringify(run.score())).toEqual([]);
  for (const [key, receipt] of Object.entries(run.record())) {
    expect(receipt, key).not.toBeNull();
    if (!receipt) continue;
    const result = replay(receipt);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) expect(result.value.snapshot).toEqual(run.frameFor(key)?.snapshot);
  }
  run.retry();
  for (const action of proof!.incorrect) expect(run.perform(action), id + ':' + action).toBe(true);
  expect(run.score().passed).toBe(false);
});

test('L15 source and quantities refer to the audited public bill, not a manufactured approval', () => {
  const lesson = prepared('L15').definition;
  const raw = JSON.parse(readFileSync(new URL('../../content/catalog/public-v1.json', import.meta.url), 'utf8'));
  const kit = raw.kits.find((row: { offerId: string }) => row.offerId === lesson.sourceCard?.offerId);
  expect(kit).toMatchObject(lesson.sourceCard!);
  expect(kit.parts).toHaveLength(4);
  expect(kit.parts).toEqual(expect.arrayContaining([expect.objectContaining({ article: '29352', quantity: 8 })]));
  expect(kit.ambiguity).toContain('Перед продажей требуется подтвердить');
});
