import { transferLiquid } from './liquid-inventory';
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
  const result = transferLiquid(cell, cp, exchange);
  if (!result || result.next.temperatureC === null) return null; // B04 needs a nonempty thermal cell.
  return { next: { massKg: result.next.massKg, temperatureC: result.next.temperatureC },
    makeupJ: result.makeupJ, drainJ: result.drainJ };
}
