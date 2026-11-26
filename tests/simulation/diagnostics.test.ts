import { expect, test } from 'vitest';
import { scenario } from '../fixtures/simulation-engine';
import { createSession } from '../../src/simulation/session';
import { branchEvidence, domainPressureEvidence, explainRun } from '../../src/simulation/evidence';

const branch = 'link:pipe-a';
function start() {
  const input = scenario();
  const made = createSession(input);
  if (!made.ok) throw new Error(JSON.stringify(made.diagnostics));
  return { input, run: made.value };
}

test('stopped_branch_has_explanation_not_stale_values', () => {
  const { run } = start();
  run.stepOnce();
  const active = branchEvidence(run.view, branch);
  expect(active.reading).toMatchObject({ status: 'measured' });
  if (active.reading.status !== 'measured') throw new Error('Expected live reading');
  expect(active.reading.value).toBeGreaterThan(0);
  run.command({ kind: 'service', cellId: 'unknown', fillKg: 1, fillC: 10, drainKg: 0 });
  run.stepOnce();
  expect(run.view.stale).toBe(true);
  expect(branchEvidence(run.view, branch)).toMatchObject({ state: 'stopped',
    reading: { status: 'unavailable', lastConfirmedTick: 1 }, target: { kind: 'link', id: 'pipe-a' } });
  expect(explainRun(run.view).some((reason) => reason.code === 'invalid_engine_service' && reason.action.length > 0)).toBe(true);
});

test('fault_message_contains_cause_reading_action and the affected link', () => {
  const { run } = start();
  run.command({ kind: 'fault', command: { kind: 'filter', id: branch, extent: .8 } });
  run.stepOnce();
  const issue = branchEvidence(run.view, branch).reasons.find(({ code }) => code === 'filter_obstruction');
  expect(issue).toMatchObject({ state: 'restricted', target: { kind: 'link', id: 'pipe-a' },
    reading: { status: 'measured', unit: 'л/мин', tick: 1 } });
  expect(issue?.cause).toMatch(/фильтр/i);
  expect(issue?.action).toMatch(/очист/i);
  run.command({ kind: 'fault', command: { kind: 'clean', id: branch } });
  run.stepOnce();
  expect(branchEvidence(run.view, branch).reasons.map((r) => r.code)).not.toContain('filter_obstruction');
});

test('missing_data_is_distinct_from_valid_zero, including pressure and protected states', () => {
  const { run } = start();
  expect(branchEvidence(run.view, branch).reading).toEqual({ status: 'unavailable', lastConfirmedTick: null });
  run.command({ kind: 'fault', command: { kind: 'air', id: branch, extent: 1 } });
  run.command({ kind: 'fault', command: { kind: 'sensor-failure', id: 'supply' } });
  run.stepOnce();
  expect(branchEvidence(run.view, branch)).toMatchObject({ state: 'off', reading: { status: 'measured', value: 0 },
    reasons: [{ code: 'air_lock' }] });
  expect(explainRun(run.view)).toEqual(expect.arrayContaining([
    expect.objectContaining({ state: 'protected', target: { kind: 'component', id: 'limit' } }),
    expect.objectContaining({ state: 'training' }),
  ]));
});

test('unsupported pressure stops the view and does not publish the terminal hydraulic numbers', () => {
  const cfg = scenario();
  const cell = 'component:source:source', domain = cfg.system.hydraulicDomains[0]!.id;
  cfg.serviceCapacityM3ByCell = { [cell]: .004 };
  cfg.pressure = [{ domainId: domain, profile: {
    referenceLiquidM3: .005, referenceC: 20, expansionPerK: 0, atmosphericPa: 100000, referenceGaugePa: 0,
  } }];
  const session = createSession(cfg);
  if (!session.ok) throw new Error(JSON.stringify(session.diagnostics));
  const run = session.value;
  run.stepOnce();
  expect(domainPressureEvidence(run.view, domain)).toMatchObject({
    state: 'active', reading: { status: 'measured', value: 0, unit: 'Па', tick: 1 },
  });
  run.command({ kind: 'service', cellId: cell, fillKg: 1, fillC: 20, drainKg: 0 });
  run.stepOnce();
  expect(domainPressureEvidence(run.view, domain)).toMatchObject({ state: 'stopped',
    reading: { status: 'unavailable' }, reasons: [{ code: 'pressure_capacity_unknown', target: { kind: 'domain', id: domain } }] });
  expect(branchEvidence(run.view, branch).reading).toEqual({ status: 'unavailable', lastConfirmedTick: 1 });
});
