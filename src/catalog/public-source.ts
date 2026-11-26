import { parseCatalogCsv } from './import.ts';
import { validateCatalog } from './catalog.ts';
import type { CatalogContext, CatalogKit, CatalogOffer, CatalogPackage } from './catalog.ts';

const contexts = new Set<CatalogContext>(['floor', 'heating', 'radiator', 'service']);
const confirmedTeachingRoles = new Map<string, string>([
  ['Монтажный термоблок GAPPO G1494', 'training-thermostat'],
  ['Газовый отопительный котёл', 'training-heat-source'],
  ['Электрический котёл', 'training-electric-boiler'],
  ['Гидравлический разделитель', 'training-hydraulic-separator'],
  ['Дифференциальный перепускной клапан', 'training-bypass'],
  ['Обратный клапан', 'training-check'],
  ['Манометр', 'training-pressure-gauge'],
  ['Поворотный магнитный шламоуловитель', 'training-magnetic-separator'],
  ['Поворотный сепаратор воздуха', 'training-air-separator'],
  ['Предохранительный клапан 1,5 бар', 'training-relief-valve'],
  ['Насосно-смесительный узел ICMA M054', 'training-pump-mixing-group'],
  ['Многослойная труба GAPPO Stabil', 'training-pipe-20'],
  ['Труба PE-Xa/EVOH 16×2 мм', 'training-loop-pipe'],
  ['Переходник STOUT', 'training-adapter-16-20'],
  ['Термометр погружной или накладной', 'training-thermometer'],
  ['Радиаторный запорный или ручной клапан', 'training-ball-valve'],
  ['Шаровой кран RTP', 'training-ball-valve'],
  ['Косой сетчатый фильтр MVI', 'training-strainer'],
  ['Сетчатый фильтр GAPPO или ZEGOR', 'training-strainer'],
  ['Сетчатый фильтр RTP', 'training-strainer'],
  ['Сетчатый фильтр STI', 'training-strainer'],
  ['Сетчатые фильтры VALTEC', 'training-strainer'],
]);
const knownArticles = new Map<string, string>([
  ['29352', 'training-eurocone'], ['39511', 'training-end-block'],
  ['39798', 'training-pump-mixing-group'], ['ZRS25/6G-130 Pro', 'training-circulator'],
]);
const parser = (text: string) => {
  const result = parseCatalogCsv(text);
  if (!result.ok) throw new Error(result.diagnostics[0].path + ': ' + result.diagnostics[0].message);
  return result.value;
};
function need(v: string | undefined, name: string): string {
  if (!v) throw new Error('Missing ' + name);
  return v;
}

export function compilePublicSources(assortmentText: string, reviewText: string, kitsText: string): CatalogPackage {
  const input = parser(assortmentText), review = parser(reviewText), kitRows = parser(kitsText);
  const reviews = new Map(review.map((row) => [need(row.offer_id, 'review offer id'), row]));
  if (reviews.size !== review.length) throw new Error('Duplicate review offer');
  const used = new Set<string>();
  const offers: CatalogOffer[] = input.map((row) => {
    const offerId = need(row.offer_id, 'offer id'), url = need(row.url, 'offer URL');
    const ruling = reviews.get(offerId);
    const article = row.article ?? '', brand = row.brand ?? '';
    if (row.scope_status === 'check_application' && (!ruling || ruling.article !== article || ruling.card_url !== url || ruling.brand !== brand)) {
      throw new Error('Unmatched review: ' + offerId);
    }
    if (ruling && row.scope_status !== 'check_application') throw new Error('Review outside expected source scope: ' + offerId);
    if (ruling) used.add(offerId);
    const scope = (ruling?.review_status ?? (row.scope_status === 'water_floor' ? 'floor' : 'excluded')) as CatalogOffer['scope'];
    const allowedContexts = contexts.has(scope as CatalogContext) ? [scope as CatalogContext] : [];
    const analogue = allowedContexts.length > 0 ? (ruling ? confirmedTeachingRoles.get(ruling.engineering_role ?? '') :
      knownArticles.get(article)) : undefined;
    const salesGate = (ruling?.sales_gate ?? (scope === 'excluded' ? 'out_of_scope' : 'no_review')) as CatalogOffer['salesGate'];
    return { channel: 'volmax', offerId, article, brand, url, title: need(row.name, 'offer name'), scope, salesGate,
      clearance: ruling?.clearance_on_source_card === 'yes', ...(analogue && { analogue }), allowedContexts,
      ...(ruling && { review: { role: need(ruling.engineering_role, 'review role'), use: need(ruling.usage_context, 'review context'),
        basis: need(ruling.basis, 'review evidence type'), evidence: need(ruling.evidence, 'review evidence'),
        next: need(ruling.before_sku_recommendation, 'further review'), sources: [url, ruling.technical_source_url, ruling.additional_source_url].filter((s): s is string => !!s) } }) };
  });
  if (used.size !== reviews.size) throw new Error('Orphan review row');
  const byId = new Map(offers.map((o) => [o.offerId, o]));
  const kits = new Map<string, CatalogKit>();
  for (const row of kitRows) {
    const offerId = need(row.kit_offer_id, 'kit offer id'), card = byId.get(offerId);
    if (!card || card.url !== row.kit_url || card.article !== row.kit_article) throw new Error('Kit identity mismatch: ' + offerId);
    let kit = kits.get(offerId);
    if (!kit) {
      kit = { id: 'kit-' + offerId, channel: card.channel, offerId, article: card.article, title: card.title, url: card.url, parts: [],
        ...(row.series === 'Эко' && { ambiguity: 'Описание категории говорит об отсутствии адаптеров, но опубликованный состав карточки перечисляет евроконусы. Перед продажей требуется подтвердить фактический состав.' }) };
      kits.set(offerId, kit);
    }
    kit.parts.push({ channel: card.channel, offerId: need(row.component_offer_id, 'part offer id'), article: row.component_article ?? '',
      title: row.component_name ?? '', url: need(row.component_url, 'part URL'), quantity: Number(row.quantity),
      unit: row.unit as CatalogKit['parts'][number]['unit'], included: true });
  }
  const result = validateCatalog({ version: 1, releaseId: 'volmax-public-20261126-v1', publishedOn: '2026-11-26',
    offers, products: [], kits: [...kits.values()] });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.path + ': ' + d.message).join('\n'));
  return result.value;
}
