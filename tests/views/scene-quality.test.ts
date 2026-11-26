import { expect, test } from 'vitest';
import { createSceneQuality } from '../../src/views/scene/quality';

test('reduces only presentation after sustained slow frames and recovers hysteretically', () => {
  const q = createSceneQuality();
  expect(q.level).toEqual({ pixelScale: 1, particleStride: 1 });
  for (let i = 0; i < 40; i++) q.sample(16.7);
  q.sample(4000); // background/tab suspension is not a hardware score
  for (let i = 0; i < 6; i++) q.sample(52);
  expect(q.level.pixelScale).toBe(1);
  for (let i = 0; i < 42; i++) q.sample(52);
  expect(q.level.pixelScale).toBeLessThan(1);
  expect(q.level.particleStride).toBeGreaterThan(1);
  for (let i = 0; i < 210; i++) q.sample(16.7);
  expect(q.level).toEqual({ pixelScale: 1, particleStride: 1 });
});

test('handles periodic slow frames even when fast frames interrupt them', () => {
  const q = createSceneQuality();
  for (let i = 0; i < 48; i++) q.sample(i % 3 ? 16.7 : 50);
  expect(q.level).toEqual({ pixelScale: .65, particleStride: 4 });
});
