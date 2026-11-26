import { expect, test } from 'vitest';
import { prepareLesson } from '../../src/lessons/authoring';
import { createLessonAttempt, freeCopy } from '../../src/lessons/lesson';
import { firstLesson } from '../../src/lessons/first-lesson';
import { replay } from '../../src/simulation/replay';

function prepared(raw: unknown = firstLesson) {
  const result = prepareLesson(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

test('criterion_uses_calculated_value, not just pressing the expected button', () => {
  const attempt = createLessonAttempt(prepared());
  expect(attempt.score().rows.find((r) => r.id === 'moving')?.passed).toBe(false);
  expect(attempt.perform('step')).toBe(true);
  expect(attempt.score().rows.find((r) => r.id === 'moving')?.passed).toBe(true);
  expect(attempt.record().main?.untilTick).toBe(1);
});

test('locked_action_stays_in_lesson_scope and retry_restores_seeded_project', () => {
  const attempt = createLessonAttempt(prepared());
  expect(attempt.perform('power-off')).toBe(false);
  expect(attempt.perform('step')).toBe(true);
  const before = attempt.record().main!;
  expect(replay(before).ok).toBe(true);
  attempt.retry();
  expect(attempt.frame()?.snapshot.tick).toBe(0);
  expect(attempt.score().passed).toBe(false);
});

test('free_copy_unlocks_controls and keeps the authored template immutable', () => {
  const lesson = prepared();
  const copy = freeCopy(lesson, 'main', 'new-copy');
  expect(copy?.project.projectId).toBe('new-copy');
  copy!.project.rooms.splice(0, 1);
  expect(freeCopy(lesson, 'main', 'another-copy')?.project.rooms).toHaveLength(1);
});

test('invalid_rule_has_author_diagnostic for a bound gauge that does not exist', () => {
  const def = structuredClone(firstLesson);
  const broken = { ...def, criteria: [{ ...def.criteria[0]!, type: 'range', metric: 'flow', target: 'link:missing', min: 0, max: 1 }] };
  expect(prepareLesson(broken)).toMatchObject({ ok: false, diagnostics: [{ code: 'lesson_reference', path: 'criteria.moving' }] });
});

test('right_component_for_wrong_reason_is_partial and working redundant purchase is rejected', () => {
  const core = structuredClone(firstLesson);
  const puzzle = { ...core,
    actions: [
      { id: 'choose-fit', label: 'Подходящий узел', type: 'answer', field: 'choice', value: 'fit' },
      { id: 'reason-right', label: 'Верная причина', type: 'answer', field: 'explanation', value: 'curve' },
      { id: 'reason-wrong', label: 'Неверная причина', type: 'answer', field: 'explanation', value: 'headline' },
      { id: 'kit-plus', label: 'Комплект', type: 'quantity', item: 'kit', delta: 1 },
      { id: 'extra-plus', label: 'Лишний насос', type: 'quantity', item: 'extra-pump', delta: 1 },
      { id: 'extra-minus', label: 'Убрать насос', type: 'quantity', item: 'extra-pump', delta: -1 },
    ], criteria: [
      { id: 'selected', label: 'Выбор', type: 'answer', field: 'choice', value: 'fit' },
      { id: 'reason', label: 'Обоснование', type: 'answer', field: 'explanation', value: 'curve' },
      { id: 'basket', label: 'Без лишнего', type: 'basket', quantities: { kit: 1 } },
    ] };
  const attempt = createLessonAttempt(prepared(puzzle));
  for (const action of ['choose-fit', 'reason-wrong', 'kit-plus']) expect(attempt.perform(action)).toBe(true);
  expect(attempt.score()).toMatchObject({ status: 'partial', passed: false });
  attempt.perform('reason-right'); attempt.perform('extra-plus');
  expect(attempt.score().rows.find((r) => r.id === 'basket')?.passed).toBe(false);
  attempt.perform('extra-minus');
  expect(attempt.score().passed).toBe(true);
});
