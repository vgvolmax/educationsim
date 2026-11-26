export const particleBudget = 2048;
export const visualTimeScale = .35;

export function pipeFlow(flowM3s: number | null | undefined, diameterM: number) {
  if (flowM3s == null || !Number.isFinite(flowM3s) || !Number.isFinite(diameterM) || diameterM <= 0) return null;
  const area = Math.PI * diameterM * diameterM / 4;
  const speedMps = flowM3s / area, lMin = flowM3s * 60_000;
  return Number.isFinite(speedMps) && Number.isFinite(lMin) ? { speedMps, lMin } : null;
}

export function particleDistance(offset: number, elapsed: number, velocity: number, length: number) {
  if (![offset, elapsed, velocity, length].every(Number.isFinite) || length <= 0) return 0;
  const position = offset + elapsed * velocity * visualTimeScale;
  return ((position % length) + length) % length;
}
