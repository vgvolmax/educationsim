import type { HydraulicSnapshot } from './hydraulics';
import type { CompiledSystem } from './types';

type Stream = { cellId: string; conductance: number };
export type Junction = { input: Stream[]; output: Stream[]; heatInWPerK: number; heatOutWPerK: number };

export function thermalJunctions(system: CompiledSystem, hydraulics: HydraulicSnapshot, cellByChannel: ReadonlyMap<string, string>):
  { junctions: Junction[] } | { code: string; path: string } {
  const profiles = new Map(system.hydraulicDomains.map((domain) => [domain.id, domain.fluid]));
  const junctionMap = new Map<string, Junction>();
  function at(domain: string, node: string): Junction {
    const id = JSON.stringify([domain, node]);
    let j = junctionMap.get(id);
    if (!j) {
      j = { input: [], output: [], heatInWPerK: 0, heatOutWPerK: 0 };
      junctionMap.set(id, j);
    }
    return j;
  }
  for (const channel of system.hydraulicChannels) {
    const profile = profiles.get(channel.domainId);
    const solution = hydraulics.channels[channel.id];
    const flow = solution?.flowM3s;
    const cellId = cellByChannel.get(channel.id);
    if (flow === undefined || !Number.isFinite(flow) || !profile || !cellId ||
        (solution?.state !== 'open' && flow !== 0)) return { code: 'invalid_thermal_flow', path: channel.id };
    if (flow === 0) continue;
    const conductance = Math.abs(flow) * profile.densityKgM3 * profile.specificHeatJkgK;
    if (!Number.isFinite(conductance) || conductance <= 0) return { code: 'invalid_thermal_flow', path: channel.id };
    const up = at(channel.domainId, flow > 0 ? channel.from : channel.to);
    const down = at(channel.domainId, flow > 0 ? channel.to : channel.from);
    up.output.push({ cellId, conductance }); up.heatOutWPerK += conductance;
    down.input.push({ cellId, conductance }); down.heatInWPerK += conductance;
  }
  for (const [id, j] of junctionMap) {
    const difference = Math.abs(j.heatInWPerK - j.heatOutWPerK);
    if (!Number.isFinite(difference) || !j.input.length || !j.output.length ||
        difference > Math.max(1e-6, 1e-6 * Math.max(j.heatInWPerK, j.heatOutWPerK))) {
      return { code: 'unbalanced_thermal_flow', path: id };
    }
  }
  return { junctions: [...junctionMap.values()] };
}

/** Inflow energy is allocated by outgoing flow share. Sum of transfers is zero up to rounding. */
export function advectiveWatts(junctions: readonly Junction[], temperatures: ReadonlyMap<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  const add = (id: string, w: number): void => { result.set(id, (result.get(id) ?? 0) + w); };
  for (const j of junctions) {
    let enthalpy = 0;
    for (const stream of j.input) {
      const q = stream.conductance * temperatures.get(stream.cellId)!;
      add(stream.cellId, -q); enthalpy += q;
    }
    for (const stream of j.output) add(stream.cellId, enthalpy * (stream.conductance / j.heatOutWPerK));
  }
  return result;
}
