import { describe, expect, test } from 'vitest';
import source from '../fixtures/projects/direct-small.json';
import { parseProject } from '../../src/project/document';
import { trainingRegistry } from '../../src/project/registry';
import { checkConnection, validateTopology } from '../../src/project/topology';
import type { ComponentInstance, ProjectDocument } from '../../src/project/types';

function project(): ProjectDocument {
  const parsed = parseProject(source);
  if (!parsed.ok) throw new Error('Invalid test fixture');
  return parsed.value;
}

function component(id: string, typeId: string): ComponentInstance {
  return { id, typeId, position: { x: 0, y: 0, z: 0 }, level: 0, roomId: null, catalogSnapshotId: null, parameters: {} };
}

const port = (componentId: string, portId: string) => ({ componentId, portId });

describe('typed connection decisions', () => {
  test('rejects_incompatible_ports_and_exposes_adapter_need', () => {
    const p = project();
    p.hydronicLinks = [];
    p.components.push(component('p20', 'training-pipe-20'));
    const decision = checkConnection(p, { domain: 'hydronic', from: port('source', 'supply'), to: port('p20', 'in') }, trainingRegistry);
    expect(decision).toMatchObject({ ok: false, reason: 'needs_adapter', adapterTypeIds: ['training-adapter-16-20'] });
    expect(checkConnection(p, { domain: 'hydronic', from: port('source', 'supply'), to: port('manifold', 'feed') }, trainingRegistry)).toEqual({ ok: true });
    expect(checkConnection(p, { domain: 'control', from: port('source', 'supply'), to: port('manifold', 'feed') }, trainingRegistry)).toMatchObject({ reason: 'wrong_domain' });
  });

  test('distinguishes nonexistent, repeated and occupied ports', () => {
    const p = project();
    expect(checkConnection(p, { domain: 'hydronic', from: port('source', 'not-a-port'), to: port('manifold', 'feed') }, trainingRegistry)).toMatchObject({ reason: 'missing_port' });
    expect(checkConnection(p, { domain: 'hydronic', from: port('source', 'supply'), to: port('source', 'supply') }, trainingRegistry)).toMatchObject({ reason: 'same_port' });
    expect(checkConnection(p, { domain: 'hydronic', from: port('source', 'supply'), to: port('manifold', 'feed') }, trainingRegistry)).toMatchObject({ reason: 'occupied_port' });
    expect(validateTopology(p, trainingRegistry)).toEqual([]);
  });

  test('control output can branch; input has one correctly typed writer', () => {
    const p = project();
    p.components.push(
      component('t1', 'training-thermostat'), component('t2', 'training-thermostat'),
      component('m1', 'training-zone-actuator'), component('m2', 'training-zone-actuator'),
      component('sensor', 'training-temperature-sensor'),
    );
    p.controlLinks.push({ id: 'command', from: port('t1', 'demand'), to: port('m1', 'demand') });
    expect(checkConnection(p, { domain: 'control', from: port('t1', 'demand'), to: port('m2', 'demand') }, trainingRegistry)).toEqual({ ok: true });
    expect(checkConnection(p, { domain: 'control', from: port('t2', 'demand'), to: port('m1', 'demand') }, trainingRegistry)).toMatchObject({ reason: 'occupied_port' });
    expect(checkConnection(p, { domain: 'control', from: port('sensor', 'temperature'), to: port('m2', 'demand') }, trainingRegistry)).toMatchObject({ reason: 'wrong_signal' });
    expect(checkConnection(p, { domain: 'control', from: port('m2', 'demand'), to: port('t2', 'demand') }, trainingRegistry)).toMatchObject({ reason: 'wrong_direction' });
  });

  test('diagnoses structurally valid imported links without mutating the draft', () => {
    const p = project();
    p.hydronicLinks[0]!.to.portId = 'not-yet-in-registry';
    const snapshot = structuredClone(p);
    expect(validateTopology(p, trainingRegistry)).toContainEqual(expect.objectContaining({ code: 'missing_port', path: 'hydronicLinks.0.to.portId', portId: 'not-yet-in-registry' }));
    expect(p).toEqual(snapshot);
  });
});
