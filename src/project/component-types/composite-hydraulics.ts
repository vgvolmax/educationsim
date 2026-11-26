import type { HydraulicInputs } from '../../simulation/hydraulics';
import type { PumpInput } from '../../simulation/pump';
import type { MixingValveInput, ValveInput } from '../../simulation/valves';
import type { CompiledSystem } from '../../simulation/types';
import { equipmentRegistry, validateEquipmentSettings } from '../registry';
import type { ComponentType, Result } from '../types';

const variants = new Set(['two-way-mix', 'three-way-mix', 'pump-mixing-group', 'passive-mixing-group', 'dynamic-manifold', 'direct-pump-group']);
type ParameterValues = ComponentType['defaultParameters'];

/** Opt-in teaching laws for the composite paths. Use only for zero-SKU fixtures.
 * The caller still supplies link friction, independent source/pipe laws, and thermal/control bindings. */
export function trainingCompositeHydraulics(system: CompiledSystem): Result<HydraulicInputs> {
  const resistance: Record<string, HydraulicInputs['resistance'][string]> = {};
  const pumps: Record<string, PumpInput> = {};
  const valves: Record<string, ValveInput> = {};
  const mixingValves: MixingValveInput[] = [];
  const channels = new Map(system.hydraulicChannels.map((channel) => [channel.id, channel]));
  for (const component of system.components) {
    const definition = equipmentRegistry.get(component.typeId);
    if (!definition || !variants.has(definition.variant)) continue;
    if (component.catalogSnapshotId !== null) return { ok: false, diagnostics: [{
      code: 'training_profile_with_catalog', severity: 'error', path: 'components.' + component.id,
      message: 'Учебные характеристики нельзя применять к паспортному изделию.',
    }] };
    const checked = validateEquipmentSettings(component.typeId, component.parameters);
    if (!checked.ok) return checked;
    const p: ParameterValues = { ...definition.component.defaultParameters, ...checked.value };
    const channelId = (local: string) => 'component:' + component.id + ':' + local;
    for (const { id: local } of definition.component.hydraulics?.channels ?? []) {
      const id = channelId(local);
      const channel = channels.get(id);
      if (!channel) return { ok: false, diagnostics: [{
        code: 'missing_composite_channel', severity: 'error', path: id, message: 'Не найдена ветвь учебного узла.',
      }] };
      // Generic low-resistance teaching branch, not a manufacturer's Kv or pressure-drop claim.
      resistance[id] = { linearPaPerM3s: 2e7 };
      if (channel.kind === 'pump') {
        const points = [{ flowM3s: 0, headPa: Number(p.maxHeadPa) }, { flowM3s: Number(p.maxFlowM3s), headPa: 0 }];
        const blockReverse = p.checkValve === true;
        pumps[id] = p.mode === 'constant-pressure' ? { mode: 'constant-pressure', points, targetPa: Number(p.targetPa), blockReverse }
          : { mode: 'fixed-speed', points, blockReverse };
      }
    }
    if (definition.variant === 'dynamic-manifold') valves[channelId('branch-regulator')] = { kind: 'regulator',
      flowM3s: Number(p.flowLimitM3s), minPa: Number(p.minimumDeltaPa), maxPa: Number(p.maximumDeltaPa) };
    if (definition.variant === 'two-way-mix') valves[channelId('passive')] = { kind: 'two-way', opening: Number(p.position) };
    if (['pump-mixing-group', 'passive-mixing-group', 'three-way-mix'].includes(definition.variant)) {
      mixingValves.push({ first: channelId('hot-valve'), second: channelId('recirculation'), position: Number(p.position) });
    }
  }
  return { ok: true, value: { resistance, pumps, valves, mixingValves }, diagnostics: [] };
}
