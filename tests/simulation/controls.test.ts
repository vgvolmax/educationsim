import { expect, test } from 'vitest';
import { compileControls, advanceControls } from '../../src/simulation/controls';
import type { ControlGraph, ControlInput, ControlWire, ControlDevice } from '../../src/simulation/controls';
import { regulateSource } from '../../src/simulation/sources';

const sensor = (id: string, measurement: 'air' | 'return' | 'floor' | 'supply'): ControlDevice =>
  ({ id, kind: 'sensor', measurement, sampleId: id, maxAgeTicks: 1 });
const actuator = (id: string, normally: 'NC' | 'NO' = 'NC', wantsLimiter = false): ControlDevice =>
  ({ id, kind: 'actuator', normally, travelSeconds: 2, wantsLimiter });
const wire = (from: string, to: string, port: string): ControlWire => ({ id: from + '-' + to + '-' + port, from, to, port });
function graph(devices: ControlDevice[], wires: ControlWire[]): ControlGraph {
  const result = compileControls(devices, wires);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function step(g: ControlGraph, partial: Partial<ControlInput>) {
  const result = advanceControls(g, { tick: 1, seconds: 1, powered: true, samples: {}, ...partial });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}
const thermostat: ControlDevice = { id: 'therm', kind: 'thermostat', targetC: 22, hysteresisC: .5 };

test('one_thermostat_drives_two_loops and uses previous-snapshot age', () => {
  const g = graph([sensor('air', 'air'), thermostat, actuator('a'), actuator('b')],
    [wire('air', 'therm', 'temperature'), wire('therm', 'a', 'demand'), wire('therm', 'b', 'demand')]);
  const cold = step(g, { samples: { air: { tick: 0, celsius: 20 } }, sourceAvailable: { a: true } }).value;
  expect(cold.actuators.a).toMatchObject({ requested: true, commandOpen: true, opening: .5, heatEffective: true });
  expect(cold.actuators.b).toMatchObject({ requested: true, commandOpen: true, opening: .5, heatEffective: false });
  const hysteresis = step(g, { tick: 2, previous: cold, samples: { air: { tick: 1, celsius: 22.2 } } }).value;
  expect(hysteresis.actuators.a).toMatchObject({ requested: true, opening: 1 });
  const stale = step(g, { tick: 3, previous: hysteresis, samples: { air: { tick: 1, celsius: 19 } } });
  expect(stale.value.actuators.a!.requested).toBe(false);
  expect(stale.diagnostics).toContainEqual(expect.objectContaining({ code: 'sensor_unavailable' }));
});
test('floor_limit_keeps_air_setpoint; rtl_uses_return_sensor only', () => {
  const limiter: ControlDevice = { id: 'limit', kind: 'surface-limit', limitC: 29, hysteresisC: 1, latching: false };
  const g = graph([sensor('air', 'air'), sensor('floor', 'floor'), thermostat, limiter, actuator('a', 'NC', true)], [
    wire('air', 'therm', 'temperature'), wire('floor', 'limit', 'temperature'),
    wire('therm', 'a', 'demand'), wire('limit', 'a', 'permit'),
  ]);
  const result = step(g, { samples: { air: { tick: 0, celsius: 17 }, floor: { tick: 0, celsius: 30 } } }).value;
  expect(result.actuators.a).toMatchObject({ requested: true, permitted: false, commandOpen: false });
  expect(result.setpointsC.therm).toBe(22);
  const rtl: ControlDevice = { id: 'rtl', kind: 'rtl', limitC: 38, hysteresisC: 1, latching: false };
  expect(compileControls([sensor('feed', 'supply'), rtl], [wire('feed', 'rtl', 'temperature')])).toMatchObject({
    ok: false, diagnostics: [{ code: 'incompatible_control_signal' }],
  });
  const r = graph([sensor('back', 'return'), rtl, actuator('a', 'NC', true)],
    [wire('back', 'rtl', 'temperature'), wire('rtl', 'a', 'permit')]);
  expect(step(r, { manualDemand: { a: true }, samples: { back: { tick: 0, celsius: 39 } } }).value.actuators.a!.commandOpen).toBe(false);
});
test('power_loss_respects_nc_no_and_travel without declaring that a failed-open valve heats', () => {
  const g = graph([actuator('nc'), actuator('no', 'NO')], []);
  const first = step(g, { manualDemand: { nc: true }, sourceAvailable: { nc: true, no: true } }).value;
  const out = step(g, { tick: 2, previous: first, powered: false, manualDemand: { nc: true },
    sourceAvailable: { nc: true, no: true }, seconds: .5 }).value;
  expect(out.actuators.nc).toMatchObject({ requested: true, powered: false, opening: .25, commandOpen: false, heatEffective: false });
  expect(out.actuators.no).toMatchObject({ powered: false, opening: .75, commandOpen: false, heatEffective: false });
});
test('wiring_exposes_multiple_writers_and_zero_delay_loop but allows an explicit delay', () => {
  const a: ControlDevice = { id: 'a', kind: 'and', signal: 'demand', inputs: 1 };
  const b: ControlDevice = { id: 'b', kind: 'or', signal: 'demand', inputs: 1 };
  expect(compileControls([a, b], [wire('a', 'b', 'i1'), wire('b', 'a', 'i1')])).toMatchObject({ ok: false, diagnostics: [{ code: 'zero_delay_cycle' }] });
  expect(compileControls([a, b, actuator('valve')], [wire('a', 'valve', 'demand'), wire('b', 'valve', 'demand')])).toMatchObject({ ok: false, diagnostics: [{ code: 'multiple_control_writers' }] });
  const delay: ControlDevice = { id: 'd', kind: 'delay', signal: 'demand', initial: true };
  const g = graph([a, delay, actuator('valve')], [wire('d', 'a', 'i1'), wire('a', 'd', 'in'), wire('a', 'valve', 'demand')]);
  expect(step(g, {}).value.actuators.valve!.requested).toBe(true);
});

test('v12_connected_limiter_overrides_manual_and_demand, disconnected is reported honestly', () => {
  const high: ControlDevice = { id: 'limit', kind: 'high-limit', limitC: 45, hysteresisC: 2, latching: true };
  const devices = [sensor('air', 'air'), sensor('supply', 'supply'), thermostat, high, actuator('a', 'NC', true), actuator('b', 'NC', true)];
  const g = graph(devices, [wire('air', 'therm', 'temperature'), wire('therm', 'a', 'demand'), wire('therm', 'b', 'demand'),
    wire('supply', 'limit', 'temperature'), wire('limit', 'a', 'permit')]);
  const r = step(g, { samples: { supply: { tick: 0, celsius: 48 }, air: { tick: 0, celsius: 18 } }, manualDemand: { a: true, b: true } });
  expect(r.value.actuators.a).toMatchObject({ requested: true, commandOpen: false, permitted: false });
  expect(r.value.actuators.b).toMatchObject({ requested: true, commandOpen: true, permitted: true });
  expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: 'limiter_disconnected', componentId: 'b' }));
});
test('sensor_failure_and_reset_follow_profile, reset requires a cool valid sample', () => {
  const high: ControlDevice = { id: 'limit', kind: 'high-limit', limitC: 45, hysteresisC: 2, latching: true };
  const g = graph([sensor('s', 'supply'), high, actuator('a', 'NC', true)], [wire('s', 'limit', 'temperature'), wire('limit', 'a', 'permit')]);
  const fault = step(g, { manualDemand: { a: true } }).value;
  expect(fault.actuators.a!.permitted).toBe(false);
  expect(fault.events.map((x) => x.kind)).toContain('limiter-tripped');
  const hot = step(g, { tick: 2, previous: fault, samples: { s: { tick: 1, celsius: 46 } }, reset: ['limit'], manualDemand: { a: true } }).value;
  expect(hot.actuators.a!.permitted).toBe(false);
  const cool = step(g, { tick: 3, previous: hot, samples: { s: { tick: 2, celsius: 42 } }, reset: ['limit'], manualDemand: { a: true } }).value;
  expect(cool.actuators.a!.permitted).toBe(true);
  expect(cool.events.map((x) => x.kind)).toContain('limiter-reset');
});
test('heat_pump_reports_minimum_flow and weather_curve_respects_source_limit', () => {
  const config = { kind: 'heat-pump' as const, ratedPowerW: 3000, maximumSupplyC: 45, minimumFlowM3s: .00005,
    weather: { coldOutdoorC: -20, coldSupplyC: 55, warmOutdoorC: 10, warmSupplyC: 25 } };
  const input = { demand: true, manual: true, powered: true, available: true, permitted: true,
    outdoorC: -30, requestedPowerW: 4000, supplyC: 32, flowM3s: .00001 };
  expect(regulateSource(config, input)).toMatchObject({ ok: true, value: { requested: true, powerW: 0, targetC: 45, reason: 'minimum-flow' } });
  expect(regulateSource(config, { ...input, flowM3s: .00006 })).toMatchObject({ ok: true, value: { powerW: 3000, targetC: 45, reason: 'heating' } });
  expect(regulateSource(config, { ...input, flowM3s: .00006, permitted: false })).toMatchObject({ ok: true, value: { powerW: 0, reason: 'blocked' } });
});

test('an incomplete permit network cannot present a false claim of protection', () => {
  const and: ControlDevice = { id: 'safe', kind: 'and', signal: 'permit', inputs: 2 };
  const limit: ControlDevice = { id: 'limit', kind: 'high-limit', limitC: 45, hysteresisC: 2, latching: true };
  const result = step(graph([sensor('s', 'supply'), limit, and, actuator('a', 'NC', true)],
    [wire('s', 'limit', 'temperature'), wire('limit', 'safe', 'i1'), wire('safe', 'a', 'permit')]),
    { samples: { s: { tick: 0, celsius: 30 } }, manualDemand: { a: true } });
  expect(result.value.actuators.a).toMatchObject({ commandOpen: false, permitted: false });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'limiter_disconnected', componentId: 'a' }));
  expect(compileControls([{ ...and, kind: 'or' }], [])).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_control_device' }] });
  expect(compileControls([{ id: 'delay', kind: 'delay', signal: 'permit', initial: true }], [])).toMatchObject({
    ok: false, diagnostics: [{ code: 'invalid_control_device' }],
  });
});
