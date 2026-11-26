import { describe, expect, test } from 'vitest';
import fixture from '../fixtures/projects/direct-small.json';
import { migrateProject, parseProject, parseProjectJson } from '../../src/project/document';
import { fromSi, parseRussianDecimal, toSi } from '../../src/project/units';

const copy = () => structuredClone(fixture);

function fails(input: unknown, code: string, path?: string) {
  const result = parseProject(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, ...(path ? { path } : {}) }));
  }
}

describe('project document v1', () => {
  test('accepts_valid_v1_and_returns_a_detached_document', () => {
    const input = copy();
    const before = JSON.stringify(input);
    const result = parseProject(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopRoutes).toHaveLength(2);
    expect(result.value).toEqual(input);
    expect(result.value.rooms[0]).not.toBe(input.rooms[0]);
    expect(JSON.stringify(input)).toBe(before);
    expect(migrateProject(input)).toEqual(result);
    expect(parseProjectJson(before)).toEqual(result);
  });

  test('retains a valid empty draft without asserting topology readiness', () => {
    const r = parseProject({
      ...copy(), rooms: [], components: [], hydronicLinks: [], controlLinks: [],
      loopRoutes: [], initialConditions: { airCByRoomId: {}, waterC: 20, gaugePressurePa: 0 },
    });
    expect(r.ok).toBe(true);
  });

  test('returns separate actionable diagnostics for future, old, broken and too-large data', () => {
    fails({ schemaVersion: 2 }, 'future_schema', 'schemaVersion');
    fails({ schemaVersion: 0 }, 'unsupported_schema', 'schemaVersion');
    fails({ schemaVersion: '1' }, 'invalid_schema', 'schemaVersion');
    expect(parseProjectJson('{').ok).toBe(false);
    expect(parseProjectJson(' '.repeat(10 * 1024 * 1024 + 1))).toMatchObject({
      ok: false, diagnostics: [{ code: 'input_too_large' }],
    });
  });

  test('rejects duplicate IDs, nonfinite parameters, invalid dimensions, and unknown fields', () => {
    const fixture = copy();
    const component = fixture.components[0]!;
    fixture.components.push(component);
    fails(fixture, 'duplicate_id', 'components.2.id');
    const badSize = copy();
    badSize.rooms[0]!.heightM = -4;
    fails(badSize, 'invalid_field', 'rooms.0.heightM');
    fails({ ...copy(), environment: { ...copy().environment, outdoorC: Number.NaN } }, 'invalid_json_value');
    fails({ ...copy(), unexpected: true }, 'invalid_field');
  });

  test('rejects broken component, room, link, and catalog references without evaluating port compatibility', () => {
    const missing = copy();
    missing.hydronicLinks[0]!.from.componentId = 'lost';
    missing.loopRoutes[0]!.linkId = 'lost-pipe';
    missing.loopRoutes[1]!.roomId = 'lost-room';
    fails(missing, 'missing_reference', 'hydronicLinks.0.from.componentId');
    fails(missing, 'missing_reference', 'loopRoutes.0.linkId');
    fails(missing, 'missing_reference', 'loopRoutes.1.roomId');
    const needsCatalog = copy().components.map((c, i) => i === 0 ? { ...c, catalogSnapshotId: 'missing' } : c);
    fails({ ...copy(), components: needsCatalog }, 'missing_reference', 'components.0.catalogSnapshotId');
  });

  test('rejects a route above its point budget before interpreting geometry', () => {
    const tooMany = copy();
    tooMany.loopRoutes[0]!.points = Array.from({ length: 1025 }, () => ({ x: 1, y: 0, z: 1 }));
    fails(tooMany, 'invalid_field', 'loopRoutes.0.points');
  });

  test('enforces the aggregate route budget and does not silently normalize a valid title', () => {
    const input = copy();
    input.title = '  Мой проект  ';
    const parsed = parseProject(input);
    expect(parsed.ok && parsed.value.title).toBe(input.title);
    const seed = input.loopRoutes[0]!;
    const points = Array.from({ length: 1024 }, () => ({ x: 1, y: 0, z: 1 }));
    input.loopRoutes = Array.from({ length: 17 }, (_, i) => ({ ...seed, id: `loop-${i}`, points }));
    fails(input, 'route_point_budget', 'loopRoutes');
  });

  test('rejects non-JSON graphs without invoking accessors', () => {
    const getter = Object.defineProperty(copy(), 'title', { enumerable: true, get() { throw new Error('read accessor'); } });
    fails(getter, 'invalid_json_value');
    const cycle: Record<string, unknown> = { ...copy() };
    cycle.self = cycle;
    fails(cycle, 'invalid_json_value');
    fails(Object.create(copy()), 'invalid_json_value');
    fails({ ...copy(), projectId: 'constructor' }, 'invalid_field', 'projectId');
    fails(JSON.parse('{"schemaVersion":1,"__proto__":{"unexpected":true}}'), 'invalid_json_value');
  });
});

test('parses unambiguous Russian decimals and converts named display units', () => {
  expect(parseRussianDecimal(' −2,5 ')).toBe(-2.5);
  expect(parseRussianDecimal('0.125')).toBe(0.125);
  for (const value of ['1 002,5', '1,2.3', '1e3', '0x1', 'NaN', '', '4,']) {
    expect(parseRussianDecimal(value)).toBeNull();
  }
  expect(toSi(200, 'mm')).toBe(0.2);
  expect(toSi(1.5, 'bar')).toBe(150_000);
  expect(fromSi(toSi(2, 'l/min'), 'l/min')).toBeCloseTo(2, 12);
  expect(fromSi(1500, 'kW')).toBe(1.5);
});
