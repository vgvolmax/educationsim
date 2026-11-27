import { expect, test } from 'vitest';
import { cameraMovement, cameraTravel } from '../../src/views/scene/camera-motion';

test('arrows and physical WASD are aliases; diagonals have the same speed', () => {
  expect(cameraMovement(new Set(['KeyW', 'ArrowUp']))).toEqual({ forward: 1, right: 0 });
  expect(cameraMovement(new Set(['KeyA', 'ArrowRight']))).toEqual({ forward: 0, right: 0 });
  const v = cameraMovement(new Set(['KeyS', 'ArrowRight']));
  expect(v.forward).toBeLessThan(0);
  expect(v.right).toBeGreaterThan(0);
  expect(Math.hypot(v.forward, v.right)).toBeCloseTo(1);
});
test('pans in the horizontal camera plane and caps travel after a stalled frame', () => {
  expect(cameraTravel({ forward: 1, right: 0 }, { x: 0, z: -2 }, 10, .02)).toEqual({ x: 0, z: -.15 });
  expect(cameraTravel({ forward: 0, right: 1 }, { x: 0, z: -2 }, 10, 20)).toEqual({ x: .375, z: 0 });
});
