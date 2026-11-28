import { equipmentRegistry } from '../project/registry';
import { teachingAnalogue } from './catalog';
import type { CatalogOffer } from './catalog';

export type CatalogVisual = { typeId: string; name: string; variant?: string; outlets?: number };
const rules: readonly (readonly [RegExp, string])[] = [
  [/^насосно[- ]смесительн|^смесительный узел/, 'passive-mixing-group'],
  [/^насосная группа|^компактная насосная группа/, 'direct-pump-group'],
  [/^циркуляционный насос|^насос циркуляционный/, 'circulator'],
  [/^расширительный бак/, 'expansion-vessel'],
  [/^группа безопасности/, 'safety-group'],
  [/^котел электрический/, 'electric-boiler'],
  [/^котел газовый/, 'heat-source'],
  [/^тепловой насос/, 'heat-pump'],
  [/^труба (?:pex|pert|pe[- ]?[rx]|ре[- ]?х|evoh)/, 'loop-pipe'],
  [/^евроконус|^qs-\d+,\s*евроконус|^муфта аксиальная.*евроконус/, 'eurocone'],
  [/^муфта/, 'coupling'],
  [/^угольник|^угол аксиальный/, 'elbow'],
  [/^тройник/, 'tee'],
  [/^заглушка/, 'cap'],
  [/^адаптер коллекторный|^переходник под плоское уплотнение/, 'adapter-16-20'],
  [/^шкаф (?:внутренний|наружный|коллекторный)/, 'wall-cabinet'],
  [/^(?:кронштейн для (?:креп\S*\s+)?коллектор|крепление коллектор)/, 'bracket'],
  [/^плита для теплого пола.*бобышк|^мат .*бобышк/, 'stud-mat'],
  [/^пластина теплораспределительная/, 'dry-plate'],
  [/^подложка для теплого пола/, 'underlay'],
  [/^пленка для теплого пола/, 'film'],
  [/^расходомер/, 'flowmeter'],
  [/^конечные элементы для коллектора/, 'end-block'],
  [/^комнатный термостат/, 'thermostat'],
  [/^сервопривод для смесительного клапана|^сервопривод .*120\s*(?:с|s)/, 'mix-actuator'],
  [/^сервопривод нормально/, 'zone-actuator'],
  [/^(?:g\d+\s+)?термоголовка.*(?:выносным|погружным) датчиком/, 'remote-head'],
  [/^термостатический смесительный клапан|^трехходовой смесительный клапан/, 'three-way-mix'],
  [/^манометр|^термоманометр/, 'pressure-gauge'],
  [/^термометр/, 'thermometer'],
  [/^фильтр (?:грубой|механической|косой|сет)/, 'strainer'],
  [/^кран шаровой/, 'ball-valve'],
  [/^обратный клапан/, 'check'],
  [/^перепускной клапан/, 'bypass'],
  [/^предохранительный клапан/, 'relief-valve'],
  [/^воздухоотводчик/, 'air-vent'],
  [/^поворотный сепаратор воздуха/, 'air-separator'],
  [/^поворотный магнитный сепаратор/, 'magnetic-separator'],
];

function visual(typeId: string, overrides?: Omit<Partial<CatalogVisual>, 'typeId'>): CatalogVisual | undefined {
  const model = equipmentRegistry.get(typeId);
  return model && { typeId, name: model.titleRu, ...overrides };
}

/** Models depict the visible product family. Only catalogue mounting policy approves SKU-backed installation. */
export function catalogVisual(offer: CatalogOffer): CatalogVisual | undefined {
  const analogue = teachingAnalogue(offer);
  const approved = analogue && visual(analogue.typeId);
  if (approved) return approved;

  const title = offer.title.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const outletsText = title.match(/(?:^|\D)(\d{1,2})\s*(?:[-‐]\s*)?(?:вых|контур)/)?.[1] ??
    title.match(/(?:вых|выходов)\s*(\d{1,2})/)?.[1];
  const outlets = Number(outletsText);
  if (/^(?:гидрострелка|гидравлическ.*(?:разделител|стрелк)|коллектор.*гидроразделител)/.test(title)) {
    const combined = /с коллектором|коллектор.*гидроразделител/.test(title);
    return visual('training-hydraulic-separator', combined ? { name: 'Гидроразделитель с коллектором', variant: 'separator-manifold', outlets } : undefined);
  }
  if (/^коллектор(?:ная группа|\s|,)/.test(title) && outlets >= 1 && outlets <= 12) {
    const plain = /б\/расходомеров|без расходомеров/.test(title);
    if (/расходомер/.test(title) && !plain) {
      if (/^коллектор \(расходомеры\)/.test(title)) return visual('training-supply-manifold', { outlets });
      const id = outlets === 2 ? 'training-manifold-two-way' : 'training-manifold-' + outlets + '-way';
      return visual(id) ?? visual('training-manifold-two-way', { outlets });
    }
    return visual('training-supply-manifold', { name: 'Распределительная гребёнка', outlets, variant: plain ? 'pair-plain' : 'supply-manifold' });
  }

  if (/^термоголовка/.test(title) && !/датчик/.test(title))
    return visual('training-remote-head', { name: 'Радиаторная термоголовка', variant: 'radiator-head' });
  if (/^(?:насосно[- ]смесительный узел|смесительный узел)/.test(title) && /(?:со? встроенным насосом|с насосом)/.test(title))
    return visual('training-pump-mixing-group');
  const rule = rules.find(([pattern]) => pattern.test(title));
  return rule && visual('training-' + rule[1]);
}
