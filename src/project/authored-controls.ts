import { pointInOutline } from './geometry';
import { equipmentRegistry } from './registry';
import type { Diagnostic, ProjectDocument, Result } from './types';
import type { SimulationScenario } from '../simulation/engine-types';

const unavailable = (linkId: string, message: string): Result<SimulationScenario> => ({ ok: false, diagnostics: [{
  code: 'unbound_live_controls', path: 'controlLinks.' + linkId, severity: 'error', message,
}] });

/** Bind explicit room thermostat demands only where both physical component and measurement have a known law. */
export function bindAuthoredControls(project: ProjectDocument, original: SimulationScenario): Result<SimulationScenario> {
  if (!project.controlLinks.length) return { ok: true, value: original, diagnostics: [] };
  const { devices, wires, bindings } = original.control;
  const usedWires = [...wires], extraDevices: Array<typeof devices[number]> = [], extraBindings: Array<typeof bindings[number]> = [];
  const diagnostics: Diagnostic[] = [];
  const components = new Map(project.components.map((c) => [c.id, c]));
  for (const link of project.controlLinks) {
    const from = components.get(link.from.componentId);
    const control = from && equipmentRegistry.get(from.typeId);
    const source = original.sources.find((s) => s.componentId === link.to.componentId);
    if (!from || control?.variant !== 'air-thermostat' || link.from.portId !== 'demand' || !source || link.to.portId !== 'heat-request') {
      return unavailable(link.id, 'Эта явная управляющая связь пока не имеет расчётного профиля. Защита не заменяется учебными сигналами.');
    }
    const rooms = project.rooms.filter((r) => r.level === from.level && pointInOutline(from.position, r.outline));
    const room = from.roomId ? project.rooms.find((r) => r.id === from.roomId && r.level === from.level) : rooms.length === 1 ? rooms[0] : undefined;
    if (!room) return unavailable(link.id, 'Разместите термостат в одной определённой комнате.');
    const node = 'mounted-' + from.id;
    const probe = node + '-probe';
    if (!extraDevices.some((d) => d.id === node)) {
      const { targetC, deadbandK } = from.parameters;
      extraDevices.push({ id: node, kind: 'thermostat', targetC: typeof targetC === 'number' ? targetC : room.airSetpointC,
        hysteresisC: typeof deadbandK === 'number' ? deadbandK : 1 });
      extraDevices.push({ id: probe, kind: 'sensor', measurement: 'air', sampleId: probe, maxAgeTicks: 1 });
      extraBindings.push({ sampleId: probe, kind: 'room', id: room.id });
      usedWires.push({ id: probe, from: probe, to: node, port: 'temperature' });
    }
    const actuator = source.actuatorIds[0]!;
    const replace = usedWires.findIndex((w) => w.to === actuator && w.port === 'demand');
    if (replace >= 0) usedWires.splice(replace, 1);
    usedWires.push({ id: 'mounted-wire-' + link.id, from: node, to: actuator, port: 'demand' });
    diagnostics.push({ code: 'authored_thermostat', severity: 'warning', path: 'controlLinks.' + link.id,
      componentId: from.id, message: 'Запрос источника берётся с установленного термостата. Предельная защита источника остаётся отдельной.' });
  }
  return { ok: true, diagnostics, value: { ...original, control: { ...original.control,
    devices: [...devices, ...extraDevices], wires: usedWires, bindings: [...bindings, ...extraBindings],
  } } };
}
