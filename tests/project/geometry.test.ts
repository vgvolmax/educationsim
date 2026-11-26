import { expect, test } from 'vitest';
import fixture from '../fixtures/projects/orthogonal-room.json';
import { measureOutline, pointInOutline, segmentInsideRoom, validateOutline } from '../../src/project/geometry';

test('orthogonal L outline has winding-independent 16 m² and excludes the corner cutout', () => {
  const p = fixture.outline;
  expect(validateOutline(p)).toEqual([]);
  expect(validateOutline([...p].reverse())).toEqual([]);
  expect(measureOutline(p)).toBe(16);
  expect(pointInOutline({ x: 4, z: 3 }, p)).toBe(false);
  expect(pointInOutline({ x: 3, z: 3 }, p)).toBe(true);
});

test('detects a stroke crossing the cutout even though both endpoints are inside', () => {
  expect(segmentInsideRoom({ x: 4.8, z: 1.8 }, { x: 2.8, z: 3.8 }, { outline: fixture.outline, exclusions: [] })).toBe(false);
  expect(segmentInsideRoom({ x: 2.8, z: 1.8 }, { x: 2.8, z: 3.8 }, fixture)).toBe(true);
});

test('detects keepout traversal with both endpoints outside the keepout', () => {
  expect(segmentInsideRoom({ x: 0.25, z: 1.25 }, { x: 2.5, z: 1.25 }, fixture)).toBe(false);
  expect(segmentInsideRoom({ x: 0.25, z: 0.75 }, { x: 2.5, z: 0.75 }, fixture)).toBe(true);
});

test('rejects self-crossing orthogonal outlines and nonorthogonal walls', () => {
  const crossing = [
    { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 1, z: 4 },
    { x: 1, z: -1 }, { x: 3, z: -1 }, { x: 3, z: 2 }, { x: 0, z: 2 },
  ];
  expect(validateOutline(crossing)).toContainEqual(expect.objectContaining({ code: 'self_intersection' }));
  expect(validateOutline([{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 1 }, { x: 2, z: 0 }])).toContainEqual(expect.objectContaining({ code: 'nonorthogonal_wall' }));
});
