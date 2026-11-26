import { expect, test } from 'vitest';
import builtin from '../../content/catalog/public-v1.json';
import { validateCatalog } from '../../src/catalog/catalog';
import { analogueAvailability, catalogueSnapshot, previewAnalogueReplacement } from '../../src/catalog/mounting';
import { createTemplateProject } from '../../src/project/templates';
import { applyProjectCommand } from '../../src/project/reducer';
import { trainingRegistry } from '../../src/project/registry';
import { compileLiveScenario } from '../../src/project/live-scenario';

const catalog = validateCatalog(builtin);
const start = createTemplateProject('direct', 'catalog-fixture');
if (!catalog.ok || !start.ok) throw new Error('Fixtures invalid');
test('radiator profile fails an actual floor-loop replacement but permits its own context', () => {
  const valve = catalog.value.offers.find((o) => o.offerId === '35285')!;
  expect(analogueAvailability(valve, 'floor').allowed).toBe(false);
  expect(analogueAvailability(valve, 'radiator').allowed).toBe(true);
  const snapshot = catalogueSnapshot(valve, catalog.value.releaseId, 'training-ball-valve', 'valve-snapshot', 'radiator');
  const existing = start.value.components.find((c) => c.id === 'manifold')!;
  expect(previewAnalogueReplacement(start.value, existing, snapshot, 'replace-catalog'))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'catalog_context_mismatch' }] });
});
test('a mounting catalogue label remains a nonhydraulic teaching component', () => {
  const o = { ...catalog.value.offers[0]!, analogue: 'training-wall-cabinet', scope: 'heating' as const,
    allowedContexts: ['heating' as const], salesGate: 'no_review' as const };
  const snapshot = catalogueSnapshot(o, catalog.value.releaseId, 'training-wall-cabinet', 'cabinet-snapshot', 'heating');
  const applied = applyProjectCommand(start.value, { commandId: 'mount-cabinet', kind: 'add_component', catalogSnapshot: snapshot,
    component: { id: 'fitted-cabinet', typeId: snapshot.typeId, roomId: null, level: 0, position: { x: 1, y: 0, z: 1 },
      catalogSnapshotId: snapshot.id, parameters: {} } }, trainingRegistry);
  if (!applied.ok) throw new Error(JSON.stringify(applied.diagnostics));
  const before = compileLiveScenario(start.value, 'direct'), after = compileLiveScenario(applied.value, 'direct');
  if (!before.ok || !after.ok) throw new Error('Cannot compare scenes');
  expect(after.value.system.hydraulicChannels).toEqual(before.value.system.hydraulicChannels);
  expect(after.value.system.components.some((c) => c.id === 'fitted-cabinet' && c.catalogSnapshotId === snapshot.id)).toBe(true);
});
