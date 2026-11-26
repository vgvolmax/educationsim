const levels = [
  { pixelScale: 1, particleStride: 1 },
  { pixelScale: .8, particleStride: 2 },
  { pixelScale: .65, particleStride: 4 },
] as const;

export function createSceneQuality() {
  let index = 0, slow = 0, fast = 0, windowSamples = 0;
  return {
    get level() { return levels[index]!; },
    sample(ms: number): boolean {
      if (!Number.isFinite(ms) || ms <= 0 || ms > 300) { slow = 0; fast = 0; windowSamples = 0; return false; }
      if (ms > 35) slow++;
      fast = ms < 22 ? fast + 1 : 0;
      if (++windowSamples === 24) {
        windowSamples = 0;
        const overloaded = slow >= 6;
        slow = 0;
        if (overloaded && index < levels.length - 1) { index++; fast = 0; return true; }
      }
      if (fast < 90 || index === 0) return false;
      index--; slow = 0; fast = 0; windowSamples = 0;
      return true;
    },
  };
}
