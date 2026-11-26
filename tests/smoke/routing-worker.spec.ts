import { expect, test } from '@playwright/test';

test('max_density_request_is_cancellable_and_preserves_route in a real Worker', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const script = '/src/project/routing-client.ts';
    const { createRoutingClient } =
      await import(script) as typeof import('../../src/project/routing-client');
    const pt = (x: number, z: number) => ({ x, y: 0, z });
    const start = pt(0, .15), end = pt(0, .30);
    const input = {
      room: { outline: [pt(0, 0), pt(5, 0), pt(5, 4), pt(0, 4)], exclusions: [] },
      kind: 'spiral', direction: '+x', spacingM: .15, radiusM: .06, start, end,
    } as const;
    const profile = {
      revision: 4,
      route: { kind: 'manual' as const, points: [start, pt(1, .15), pt(1, .30), end], bends: [], lengthM: 2.15, sleeves: [] },
    };
    let revision = profile.revision;
    const client = createRoutingClient(() => revision);
    const normalized = input;
    const dense = {
      ...normalized, spacingM: .05, radiusM: .02, end: pt(0, .20),
      room: { outline: [pt(0, 0), pt(400, 0), pt(400, 400), pt(0, 400)], exclusions: [] },
    };
    const work = client.request(dense);
    const cancelAction = client.cancel();
    const cancelled = await work;
    const rejected = await client.request(dense);
    const staleWork = client.request({ ...input, room: { ...input.room, outline: [...input.room.outline] } });
    revision++;
    const stale = await staleWork;
    revision = profile.revision + 2;
    const baseline = { ...profile, revision };
    const preview = await client.request({ ...input, room: { ...input.room, outline: [...input.room.outline] } });
    const protectedManual = client.applyPreview(baseline, preview, false);
    const changedProfile = { ...baseline, revision: revision + 1 };
    const staleApply = client.applyPreview(changedProfile, preview, true) === changedProfile;
    const old = preview;
    const fresh = await client.request(normalized);
    const refusesSuperseded = client.applyPreview(baseline, old, true) === baseline;
    const applied = client.applyPreview(baseline, fresh, true);
    return {
      cancelled: cancelled.status, stale: stale.status, cancelAction,
      kept: client.applyPreview(profile, cancelled, true) === profile,
      budget: rejected.status === 'failed' ? rejected.diagnostics[0]?.code : rejected.status,
      keepsManual: protectedManual === baseline,
      staleApply, refusesSuperseded,
      previewStatus: preview.status, pointCount: applied.route?.points.length, kind: applied.route?.kind,
    };
  });
  expect(result).toMatchObject({
    cancelled: 'cancelled', stale: 'stale', cancelAction: true, kept: true, keepsManual: true,
    staleApply: true, refusesSuperseded: true, budget: 'route_budget', previewStatus: 'ready', kind: 'spiral',
  });
  expect(result.pointCount).toBeGreaterThan(20);
});
