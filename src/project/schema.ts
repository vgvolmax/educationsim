import { z } from 'zod';

import { projectLimits } from './limits';

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,95}$/i)
  .refine((value) => value !== 'constructor' && value !== 'prototype');
const name = z.string().max(200).refine((value) => value.trim().length > 0);
const finite = z.number();
const meters = finite.min(-100_000).max(100_000);
const dimensions = finite.gt(0).max(100_000);
const temperature = finite.min(-273.15).max(2000);
const level = z.int().min(-32).max(127);
const point2 = z.strictObject({ x: meters, z: meters });
const point3 = z.strictObject({ x: meters, y: meters, z: meters });
const parameters = z.record(id, z.union([finite, z.boolean(), z.string().max(300), z.null()]));
const endpoint = z.strictObject({ componentId: id, portId: id });

const room = z.strictObject({
  id, name, level, heightM: dimensions,
  outline: z.array(point2).min(3).max(256),
  wallLossWPerK: finite.nonnegative(),
  floorLossWPerK: finite.nonnegative(),
  airCapacityJPerK: finite.positive(),
  airSetpointC: temperature,
  surfaceLimitC: temperature,
  floorFinishId: id,
  exclusions: z.array(z.strictObject({ origin: point2, widthM: dimensions, depthM: dimensions })).max(128),
  openings: z.array(z.strictObject({ from: point2, to: point2 })).max(128),
});

const component = z.strictObject({
  id, typeId: id, position: point3, level, roomId: id.nullable(),
  catalogSnapshotId: id.nullable(), parameters,
});

const points = z.array(point3).max(projectLimits.routePoints);
const hydronicLink = z.strictObject({
  id, from: endpoint, to: endpoint, points, materialId: id,
  innerDiameterM: dimensions, localLossCoefficient: finite.nonnegative().optional(),
});
const controlLink = z.strictObject({ id, from: endpoint, to: endpoint });
const loopRoute = z.strictObject({
  id, roomId: id, linkId: id,
  kind: z.enum(['manual', 'serpentine', 'spiral']),
  spacingM: dimensions,
  points: points.min(2),
});
const snapshot = z.strictObject({
  id, productId: id, typeId: id,
  catalogReleaseId: id,
  basis: z.enum(['manufacturer', 'training', 'reference']),
  catalogCard: z.strictObject({ key: z.string().min(1).max(200), context: z.enum(['floor', 'heating', 'radiator', 'service']).optional(), article: z.string().max(240), title: z.string().min(1).max(700) }).optional(),
  sourceUrls: z.array(z.url({ protocol: /^https$/ }).max(2048)).max(32),
  parameters,
});

export const projectSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: id, title: name,
  revision: z.int().nonnegative(), catalogReleaseId: id, modelVersion: id,
  environment: z.strictObject({
    outdoorC: temperature, belowFloorC: temperature,
    fluid: z.enum(['water', 'propylene-glycol', 'ethylene-glycol']),
    glycolMassFraction: finite.min(0).max(1).optional(),
  }),
  rooms: z.array(room).max(projectLimits.rooms),
  components: z.array(component).max(projectLimits.components),
  hydronicLinks: z.array(hydronicLink).max(projectLimits.linksPerDomain),
  controlLinks: z.array(controlLink).max(projectLimits.linksPerDomain),
  loopRoutes: z.array(loopRoute).max(projectLimits.linksPerDomain),
  appliedCatalogSnapshots: z.array(snapshot).max(projectLimits.components),
  initialConditions: z.strictObject({
    airCByRoomId: z.record(id, temperature), waterC: temperature, gaugePressurePa: finite.nonnegative(),
  }),
  viewPreferences: z.strictObject({ mode: z.enum(['2d', '3d']), level }),
});
