const scale = {
  m: 1, mm: 0.001, s: 1, min: 60,
  kg: 1, Pa: 1, kPa: 1000, bar: 100_000,
  W: 1, kW: 1000, J: 1, kJ: 1000,
  '°C': 1, 'm³/s': 1, 'l/min': 0.001 / 60, 'm³/h': 1 / 3600,
} as const;
export type DisplayUnit = keyof typeof scale;

export function parseRussianDecimal(text: string): number | null {
  const clean = text.trim().replace(/^−/, '-');
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(clean)) return null;
  const value = Number(clean.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function finiteConversion(result: number): number {
  if (!Number.isFinite(result)) throw new RangeError('Unit conversion requires a finite result');
  return result;
}

export function toSi(value: number, unit: DisplayUnit): number {
  return finiteConversion(value * scale[unit]);
}

export function fromSi(value: number, unit: DisplayUnit): number {
  return finiteConversion(value / scale[unit]);
}
