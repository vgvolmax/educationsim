import { expect, test } from 'vitest';
import roomL from '../fixtures/projects/orthogonal-room.json';
import { planLoop, measureRoute, validateRoute } from '../../src/project/routing';
import type { LoopRouteInput } from '../../src/project/routing';
import type { Point3 } from '../../src/project/types';

const pt = (x: number, z: number, y = 0): Point3 => ({ x, y, z });
const rectangle = {
  outline: [pt(0, 0), pt(5, 0), pt(5, 4), pt(0, 4)],
  exclusions: [],
};
const base: LoopRouteInput = {
  room: rectangle, kind: 'serpentine', spacingM: .15, radiusM: .06,
  start: pt(0, .15), end: pt(0, .3), direction: '+x',
};

test('both_route_styles_work_in_reference_rectangle', () => {
  for (const kind of ['serpentine', 'spiral'] as const) {
    const result = planLoop({ ...base, kind });
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
    if (!result.ok) continue;
    const r = result.value;
    expect(r.kind).toBe(kind);
    expect(r.points[0]).toEqual(base.start);
    expect(r.points.at(-1)).toEqual(base.end);
    expect(r.lengthM).toBeGreaterThan(85);
    expect(r.lengthM).toBeCloseTo(measureRoute(r.points), 0);
    expect(r.bends.length).toBeGreaterThan(15);
    expect(r.bends.every((arc) => arc.radiusM >= base.radiusM)).toBe(true);
    expect(validateRoute(r.points, { room: rectangle }).filter((d) => d.severity === 'error')).toEqual([]);
  }
});

test('l_room_serpentine_respects_zones', () => {
  const result = planLoop({ ...base, room: roomL });
  expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
  if (result.ok) {
    expect(result.value.lengthM).toBeGreaterThan(30);
    expect(validateRoute(result.value.points, { room: roomL }).filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'partial_coverage' }));
  }
});

test('routes_avoid_keepouts and rotating/translating the reference keeps both layouts valid', () => {
  const transform = (p: {x:number;z:number;y?:number}) => pt(17 - p.z, 9 + p.x, p.y);
  const room = { outline: rectangle.outline.map(transform), exclusions: [] };
  for (const kind of ['serpentine', 'spiral'] as const) {
    const result = planLoop({ ...base, room, start: transform(base.start), end: transform(base.end), direction: '+z', kind });
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.points[0]).toEqual(transform(base.start));
      expect(result.value.points.at(-1)).toEqual(transform(base.end));
      expect(validateRoute(result.value.points, { room })).toEqual([]);
    }
  }
  const route = [pt(.2, .2), pt(2, .2), pt(2, 3)];
  expect(validateRoute(route.map(transform), { room })).toEqual([]);
  expect(measureRoute(route.map(transform))).toBeCloseTo(measureRoute(route), 12);
  expect(validateRoute([pt(.25, 1.25), pt(2.5, 1.25)], { room: roomL })).toContainEqual(expect.objectContaining({ code: 'outside_route' }));
});

test('short_radius_and_crossing_are_reported with segment positions', () => {
  const short = planLoop({ ...base, radiusM: .09 });
  expect(short).toMatchObject({ ok: false, diagnostics: [{ code: 'radius_too_short' }] });
  const crossing = [pt(.2, .2), pt(3, 3), pt(.2, 3), pt(3, .2)];
  expect(validateRoute(crossing, { room: rectangle })).toContainEqual(expect.objectContaining({ code: 'same_level_crossing', path: 'points.3', location: expect.any(Object) }));
  const closeCorners = [pt(.2, .2), pt(2, .2), pt(2, .25), pt(4, .25)];
  expect(planLoop({ ...base, kind: 'manual', points: closeCorners, start: closeCorners[0]!, end: closeCorners.at(-1)! })).toMatchObject({
    ok: false, diagnostics: [{ code: 'radius_too_short' }],
  });
});

test('levels_support_riser and mark seams and lead length', () => {
  const riser = [pt(.2, .2), pt(1, .2), pt(1, .2, 3), pt(2, .2, 3)];
  expect(validateRoute(riser, { room: rectangle })).toContainEqual(expect.objectContaining({ code: 'invalid_riser' }));
  expect(validateRoute(riser, { room: rectangle, risers: [{ x: 1, z: .2 }] })).toEqual([]);
  expect(measureRoute(riser)).toBeCloseTo(4.8, 12);
  const result = planLoop({
    ...base, kind: 'manual', start: pt(0, .3), end: pt(4, .3), points: [pt(0, .3), pt(4, .3)],
    supplyLead: [pt(-1, .3), pt(0, .3)], returnLead: [pt(4, .3), pt(5, .3)],
    seams: [[{ x: 2, z: 0 }, { x: 2, z: 1 }]],
  });
  expect(result).toMatchObject({ ok: true, value: { lengthM: 6, sleeves: [pt(2, .3)] } });
});

test('checks route budget before allocating dense paths', () => {
  const large = { outline: [pt(0, 0), pt(400, 0), pt(400, 400), pt(0, 400)], exclusions: [] };
  expect(planLoop({ ...base, room: large, spacingM: .05, radiusM: .02, end: pt(0, .20) })).toMatchObject({ ok: false, diagnostics: [{ code: 'route_budget' }] });
});

test('does not cross a pipe at the same height or accept a backtrack on an adjacent segment', () => {
  const horizontal = [pt(.2, .2), pt(3, .2)];
  const existingRoutes = [[pt(2, 0), pt(2, 1)]];
  expect(validateRoute(horizontal, { room: rectangle, existingRoutes })).toContainEqual(expect.objectContaining({ code: 'same_level_crossing' }));
  expect(validateRoute(horizontal.map((p) => ({ ...p, y: 2 })), { room: rectangle, existingRoutes })).toEqual([]);
  expect(validateRoute([...horizontal, pt(1, .2)], { room: rectangle })).toContainEqual(expect.objectContaining({ code: 'same_level_crossing' }));
});

test('enforces project-wide point budget and preserves bend checks at floor entry', () => {
  const crowded = Array.from({ length: 16 }, () => Array.from({ length: 1024 }, () => pt(20, 20)));
  expect(planLoop({ ...base, existingRoutes: crowded })).toMatchObject({ ok: false, diagnostics: [{ code: 'route_budget' }] });
  const manual = [pt(0, .5), pt(2, .5)];
  expect(planLoop({ ...base, kind: 'manual', points: manual, start: manual[0]!, end: manual[1]!,
    supplyLead: [pt(0, .1), manual[0]!] })).toMatchObject({ ok: false, diagnostics: [{ code: 'lead_angle' }] });
});
