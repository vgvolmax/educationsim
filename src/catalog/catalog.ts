import { z } from 'zod';
import type { Diagnostic, Result } from '../project/types';

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,95}$/i);
const url = z.url({ protocol: /^https$/ }).max(2048);
const context = z.enum(['floor', 'heating', 'radiator', 'service']);
const salesGate = z.enum(['confirmed', 'no_review', 'verify_exact_profile_and_conditions', 'verify_clearance_and_profile', 'out_of_scope', 'hold', 'identify_product']);
const rowReview = z.strictObject({ role: z.string().max(500), use: z.string().max(500), basis: z.string().max(100),
  evidence: z.string().max(3000), next: z.string().max(3000), sources: z.array(url).max(3) });
const offer = z.strictObject({ channel: id, offerId: id, article: z.string().max(240), brand: z.string().max(240),
  title: z.string().min(1).max(700), url, scope: z.enum([...context.options, 'excluded', 'hold', 'unreviewed']),
  salesGate, clearance: z.boolean(), productId: id.optional(), analogue: id.optional(),
  allowedContexts: z.array(context).max(4), review: rowReview.optional() });
const point = z.strictObject({ headPa: z.number().nonnegative(), flowM3s: z.number().nonnegative() });
const profile = z.strictObject({
  id, componentTypeId: id, modelId: z.string().min(1).max(200),
  geometry: z.strictObject({ lengthsMm: z.array(z.number().positive()).max(24), connectors: z.array(z.string().min(1).max(100)).max(24) }),
  ratings: point, curve: z.array(point).min(2).max(100).optional(),
  evidence: z.strictObject({ basis: z.enum(['datasheet', 'store_card', 'training']), source: url.optional(), verification: z.enum(['verified', 'unverified']) }),
});
const kit = z.strictObject({
  id, channel: id, offerId: id, article: z.string().max(240), title: z.string().min(1).max(700), url,
  ambiguity: z.string().max(2400).optional(),
  parts: z.array(z.strictObject({ channel: id, offerId: id, quantity: z.number().positive(), unit: z.enum(['шт.', 'м', 'компл.']),
    article: z.string().max(240), title: z.string().max(700), url, included: z.boolean() })).min(1).max(250),
});
const packageSchema = z.strictObject({ version: z.literal(1), releaseId: id, publishedOn: z.iso.date(),
  offers: z.array(offer).max(10000), products: z.array(profile).max(5000), kits: z.array(kit).max(1000) });
export type CatalogPackage = z.infer<typeof packageSchema>;
export type CatalogOffer = z.infer<typeof offer>;
export type CatalogProfile = z.infer<typeof profile>;
export type CatalogKit = z.infer<typeof kit>;
export type CatalogContext = z.infer<typeof context>;
export const offerKey = (channel: string, offerId: string) => channel + ':' + offerId;

function issue(code: string, path: string, message: string): Diagnostic { return { code, path, message, severity: 'error' }; }
function reject<T>(code: string, path: string, message: string): Result<T> { return { ok: false, diagnostics: [issue(code, path, message)] }; }

export function validateCatalog(raw: unknown): Result<CatalogPackage> {
  const result = packageSchema.safeParse(raw);
  if (!result.success) return reject('invalid_catalog', result.error.issues[0]?.path.map(String).join('.') ?? '', 'Некорректная версия или поля пакета каталога.');
  const p = result.data;
  const products = new Map<string, CatalogProfile>(), offers = new Map<string, CatalogOffer>(), kits = new Map<string, CatalogKit>(), kitIds = new Set<string>();
  for (const product of p.products) {
    if (products.has(product.id)) return reject('duplicate_product', 'products', 'Повторяется идентификатор профиля.');
    if (product.evidence.basis === 'datasheet' && (product.evidence.verification !== 'verified' || !product.evidence.source)) {
      return reject('unverified_datasheet', 'products.' + product.id, 'Паспортная характеристика должна быть проверена и иметь источник.');
    }
    if (product.curve?.some((point, i, values) => i > 0 && (point.flowM3s <= values[i-1]!.flowM3s || point.headPa > values[i-1]!.headPa))) {
      return reject('invalid_curve', 'products.' + product.id, 'Точки должны идти по возрастанию расхода и невозрастанию напора.');
    }
    products.set(product.id, product);
  }
  for (const o of p.offers) {
    const key = offerKey(o.channel, o.offerId);
    if (offers.has(key)) return reject('duplicate_offer', 'offers.' + key, 'Повторяется карточка в том же канале.');
    if (o.productId && !products.has(o.productId)) return reject('missing_profile', 'offers.' + key, 'Ссылка на неизвестный профиль.');
    if (new Set(o.allowedContexts).size !== o.allowedContexts.length ||
        ((o.scope === 'excluded' || o.scope === 'hold') && o.allowedContexts.length)) {
      return reject('invalid_contexts', 'offers.' + key, 'Уточните допустимые контексты; исключённые позиции не допускаются.');
    }
    offers.set(key, o);
  }
  for (const k of p.kits) {
    const key = offerKey(k.channel, k.offerId);
    if (kits.has(key) || kitIds.has(k.id)) return reject('duplicate_kit', 'kits.' + key, 'Повторяется набор.');
    kitIds.add(k.id); kits.set(key, k);
    const head = offers.get(key);
    if (!head || head.url !== k.url || head.article !== k.article) return reject('kit_identity', 'kits.' + key, 'Карточка набора не совпадает по артикулу и адресу.');
    const parts = new Set<string>();
    for (const part of k.parts) {
      const pid = offerKey(part.channel, part.offerId), o = offers.get(pid);
      if (parts.has(pid)) return reject('duplicate_part', 'kits.' + key, 'Позиция дважды указана в составе.');
      if (!o || o.article !== part.article || o.url !== part.url || (part.unit !== 'м' && !Number.isInteger(part.quantity))) {
        return reject('unknown_part', 'kits.' + key, 'Не совпадает карточка компонента или единица количества.');
      }
      parts.add(pid);
    }
  }
  const expanded = new Set<string>();
  const visit = (k: CatalogKit, path: Set<string>): boolean => {
    const key = offerKey(k.channel, k.offerId);
    if (path.has(key) || path.size >= 64) return false;
    if (expanded.has(key)) return true;
    path.add(key);
    for (const part of k.parts) {
      const next = kits.get(offerKey(part.channel, part.offerId));
      if (next && !visit(next, path)) return false;
    }
    path.delete(key); expanded.add(key);
    return true;
  };
  for (const k of p.kits.values()) if (!visit(k, new Set())) return reject('kit_cycle', 'kits.' + k.id, 'Цикл или недопустимая глубина комплектации.');
  return { ok: true, value: p, diagnostics: [] };
}
export function parseCatalogJson(text: string): Result<CatalogPackage> {
  if (text.length > 6 * 1024 * 1024 || new TextEncoder().encode(text).length > 6 * 1024 * 1024) return reject('catalog_limit', '', 'Пакет JSON слишком большой.');
  try { return validateCatalog(JSON.parse(text)); } catch { return reject('catalog_json', '', 'Некорректный JSON каталога.'); }
}
export type RequiredFit = { context: CatalogContext; componentTypeId: string; lengthMm: number; connectors: readonly string[];
  requiredHeadPa: number; requiredFlowM3s: number };
export function recommendation(p: CatalogPackage, key: string, fit: RequiredFit) {
  const o = p.offers.find((o) => offerKey(o.channel, o.offerId) === key);
  const no = (reason: string) => ({ eligible: false as const, reason });
  if (!o || !o.article || !o.brand || o.scope === 'excluded' || o.scope === 'hold' || o.clearance || o.salesGate !== 'confirmed') {
    return no('offer_unapproved');
  }
  if (!o.allowedContexts.includes(fit.context)) return no('context_mismatch');
  const profile = p.products.find((c) => c.id === o.productId);
  if (!profile || profile.evidence.basis !== 'datasheet' || profile.evidence.verification !== 'verified' || !profile.evidence.source) {
    return no('profile_unverified');
  }
  if (profile.componentTypeId !== fit.componentTypeId || !profile.geometry.lengthsMm.includes(fit.lengthMm) ||
      fit.connectors.length !== profile.geometry.connectors.length ||
      !fit.connectors.length || !fit.connectors.every((port, i) => profile.geometry.connectors[i] === port)) return no('geometry_mismatch');
  if (![fit.requiredHeadPa, fit.requiredFlowM3s].every((n) => Number.isFinite(n) && n >= 0)) return no('invalid_operating_point');
  let head = profile.ratings.headPa, maxFlow = profile.ratings.flowM3s;
  if (profile.curve) {
    const i = profile.curve.findIndex((p) => p.flowM3s >= fit.requiredFlowM3s);
    if (i < 0 || fit.requiredFlowM3s < profile.curve[0]!.flowM3s) return no('outside_verified_range');
    const a = profile.curve[Math.max(0, i - 1)]!, b = profile.curve[i]!;
    head = i === 0 ? a.headPa : a.headPa + (b.headPa - a.headPa) * (fit.requiredFlowM3s - a.flowM3s) / (b.flowM3s - a.flowM3s);
    maxFlow = b.flowM3s;
  }
  return fit.requiredHeadPa <= head && fit.requiredFlowM3s <= maxFlow
    ? { eligible: true as const, offer: structuredClone(o), profile: structuredClone(profile) } : no('outside_verified_range');
}
export function adjustProfile(profile: CatalogProfile, edited: Partial<CatalogProfile['ratings']>): CatalogProfile {
  const copy = structuredClone(profile);
  delete copy.curve;
  return { ...copy, ratings: { ...copy.ratings, ...edited }, evidence: { basis: 'training', verification: 'unverified' } };
}
export function teachingAnalogue(o: CatalogOffer) {
  return o.scope !== 'excluded' && o.scope !== 'hold' && o.analogue ? { typeId: o.analogue, basis: 'training' as const } : null;
}
export function createCatalogArchive(initial: CatalogPackage) {
  const start = validateCatalog(initial);
  if (!start.ok) throw new Error(start.diagnostics[0].message);
  let activeId = start.value.releaseId;
  const records = new Map([[activeId, start.value]]);
  return {
    active: () => structuredClone(records.get(activeId)!),
    resolve: (releaseId: string, productId: string) => {
      const item = records.get(releaseId)?.products.find((p) => p.id === productId);
      return item ? structuredClone(item) : undefined;
    },
    activate: (raw: unknown): Result<CatalogPackage> => {
      const result = validateCatalog(raw);
      if (!result.ok) return result;
      if (records.has(result.value.releaseId)) return reject('release_exists', 'releaseId', 'Выпуск с таким номером уже сохранён.');
      records.set(result.value.releaseId, result.value); activeId = result.value.releaseId;
      return { ok: true, value: structuredClone(result.value), diagnostics: [] };
    },
  };
}
