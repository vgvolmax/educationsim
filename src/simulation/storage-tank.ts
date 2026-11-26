import { finiteTemperature } from './mixing';
import type { CompiledSystem } from './types';

export type CellState = { massKg: number; temperatureC: number };
export type StorageBinding = { id: string; kind: 'buffer' | 'hydraulic-separator'; channelIds: readonly string[] };
export type ServiceExchange = { cellId: string; fillKg: number; fillC: number; drainKg: number };

export function bindStorage(system: CompiledSystem, stores: readonly StorageBinding[]): Map<string, string> | null {
  const domains = new Map(system.hydraulicChannels.map((channel) => [channel.id, channel.domainId]));
  const bindings = new Map<string, string>();
  const seen = new Set<string>();
  for (const store of stores) {
    if (!store.id || seen.has(store.id) || domains.has(store.id) || !store.channelIds.length ||
        (store.kind !== 'buffer' && store.kind !== 'hydraulic-separator')) return null;
    seen.add(store.id);
    const domain = domains.get(store.channelIds[0]!);
    if (!domain) return null;
    for (const channel of store.channelIds) {
      if (domains.get(channel) !== domain || bindings.has(channel)) return null;
      bindings.set(channel, store.id);
    }
  }
  return bindings;
}

/** Drain then add the declared mass; no implicit fluid, volume, or topology change. */
export function applyService(cell: CellState, cp: number, exchange: ServiceExchange):
  { next: CellState; makeupJ: number; drainJ: number } | null {
  const { fillKg, fillC, drainKg } = exchange;
  if (!Number.isFinite(fillKg) || fillKg < 0 || !Number.isFinite(drainKg) || drainKg < 0 ||
      drainKg > cell.massKg || !finiteTemperature(fillC)) return null;
  const massKg = cell.massKg - drainKg + fillKg;
  const makeupJ = fillKg * cp * fillC, drainJ = drainKg * cp * cell.temperatureC;
  const temperatureC = ((cell.massKg - drainKg) * cell.temperatureC + fillKg * fillC) / massKg;
  return Number.isFinite(massKg) && massKg > 0 && finiteTemperature(temperatureC) &&
    Number.isFinite(makeupJ) && Number.isFinite(drainJ) ? { next: { massKg, temperatureC }, makeupJ, drainJ } : null;
}
