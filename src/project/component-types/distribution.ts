import { b, c, hydraulics, junction, material, n, passive, signal, terminal, tube } from './definitions';
import type { EquipmentSpec } from './definitions';

const sourceSettings = {
  supplyC: n('Предельная подача', '°C', 20, 90, 40), powerW: n('Учебная мощность', 'Вт', 100, 100_000, 6000),
  minimumFlowM3s: n('Минимальный расход', 'м³/с', 0, .005, 0),
  deadbandK: n('Гистерезис', 'К', .1, 10, 2), integratedPump: b('Встроенный насос', false),
  integratedVessel: b('Встроенный расширительный бак', false), integratedSafety: b('Встроенная группа безопасности', false),
};
const pipeSettings = { lengthM: n('Длина', 'м', .01, 2000, 1), innerDiameterM: n('Внутренний диаметр', 'м', .004, .2, .012),
  oxygenBarrier: b('Кислородный барьер', true), roughnessM: n('Шероховатость', 'м', 0, .005, .000005), material: c('Материал', ['polymer', 'metal'], 'polymer') };
const fittingSettings = { lossK: n('Местное сопротивление', 'K', 0, 100, .6), nominalMm: n('Номинальный размер', 'мм', 4, 100, 16) };
const pumpSettings = { maxHeadPa: n('Напор на нулевом расходе', 'Па', 1000, 250_000, 30_000),
  maxFlowM3s: n('Край учебной кривой', 'м³/с', .000001, .03, .0001), checkValve: b('Внутренний обратный клапан', false),
  mode: c('Режим', ['fixed-speed', 'constant-pressure'], 'fixed-speed'),
  targetPa: n('Уставка перепада', 'Па', 100, 250000, 18000),
  faceToFaceM: n('Монтажная длина', 'м', .05, .5, .13) };
const outletCount = (count: 1 | 2) => n('Число выводов этой схемы', 'шт.', count, count, count);
const valveInput = signal('command', 'input', 'actuator');
const regulatedManifold = hydraulics([tube('feed'), tube('return'), tube('supply-1'), tube('return-1')], {
  portNodes: { feed: 'supply', return: 'return', 'supply-1': 'regulated-out', 'return-1': 'return' },
  channels: [{ id: 'branch-regulator', from: 'supply', to: 'regulated-out', kind: 'passive' }],
});
const mixer = (kind: 'pump' | 'passive' | 'three-way') => {
  const blend = kind === 'three-way' ? 'mixed' : 'blend';
  return hydraulics([tube('hot'), tube('return'), tube('mixed'), valveInput, ...(kind === 'pump'
    ? [signal('power', 'input', 'relay')] : [])], {
    portNodes: { hot: 'hot', return: 'return', mixed: 'mixed' },
    channels: [
      { id: 'hot-valve', from: 'hot', to: blend, kind: 'passive' },
      { id: 'recirculation', from: 'return', to: blend, kind: 'passive' },
      ...(kind === 'three-way' ? [] : [{ id: 'delivery', from: blend, to: 'mixed', kind }]),
    ], ...(kind === 'pump' ? { pressureReference: 'return' } : {}),
  });
};

export const distribution: EquipmentSpec[] = [
  ...([['gas-boiler', 'Газовый котёл', 'training-heat-source'], ['electric-boiler', 'Электрический котёл', undefined], ['heat-pump', 'Тепловой насос', undefined]] as const)
    .map(([variant, titleRu, id]): EquipmentSpec => ({
      id, family: 'source', variant, titleRu, shape: passive('source', [signal('heat-request', 'input', 'demand')]),
      model: `source:${variant}`, settings: { ...sourceSettings,
        ...(variant === 'heat-pump' && { minimumFlowM3s: n('Минимальный расход', 'м³/с', .000001, .005, .00005) }) },
      readings: ['temperature', 'power', 'status'], installation: 'Замкнутый обратный путь, допустимые давление и подача.',
    })),
  { id: 'training-external-source', family: 'source', variant: 'external-source', titleRu: 'Внешняя подача через теплообменник',
    shape: hydraulics(['primary-in', 'primary-out', 'secondary-in', 'secondary-out'].map((id) => tube(id)), {
      portNodes: { 'primary-in': 'pi', 'primary-out': 'po', 'secondary-in': 'si', 'secondary-out': 'so' },
      channels: [{ id: 'primary', from: 'pi', to: 'po', kind: 'exchanger' }, { id: 'secondary', from: 'si', to: 'so', kind: 'exchanger' }],
      heatExchange: { primary: 'primary', secondary: 'secondary', uaParameter: 'uaWPerK' },
    }), model: 'thermal:exchanger', settings: { uaWPerK: n('Теплопередача', 'Вт/К', 1, 100_000, 500) }, readings: ['temperature', 'power'],
    installation: 'Два отдельных пути жидкости; не соединять стороны напрямую.' },
  ...([['main-pipe', 'Магистральная труба', 'training-pipe-20'], ['riser', 'Стояк', undefined], ['loop-pipe', 'Труба петли', undefined]] as const)
    .map(([variant, titleRu, id]): EquipmentSpec => ({ id, family: 'conveyance', variant, titleRu, shape: passive(),
      model: 'hydraulic:pipe', settings: pipeSettings, readings: ['flow', 'pressure', 'temperature'],
      installation: variant === 'riser' ? 'Вертикальный переход между явно заданными уровнями.' : 'Отсутствие пересечений в одном уровне; допустимая трасса.' })),
  { family: 'conveyance', variant: 'pipe-insulation', titleRu: 'Теплоизоляция магистрали', shape: material, mode: 'material',
    model: 'thermal:pipe-insulation', settings: { thicknessM: n('Толщина', 'м', .001, .2, .01),
      resistanceM2KW: n('Сопротивление слоя', 'м²·К/Вт', .001, 10, .2) }, readings: ['installation', 'temperature'],
    installation: 'Покрывает указанный трубный участок, не образует водяных портов.' },
  ...([['coupling', 'Муфта'], ['elbow', 'Угольник'], ['tee', 'Тройник'], ['adapter', 'Переходник'],
    ['eurocone', 'Евроконус'], ['union', 'Разъёмное соединение'], ['cap', 'Заглушка']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({
      id: variant === 'adapter' ? 'training-adapter-16-20' : undefined, family: 'fittings', variant, titleRu,
      shape: variant === 'tee' ? junction(['a', 'b', 'c']) : variant === 'cap' ? terminal() : variant === 'eurocone'
        ? hydraulics([tube('tube'), { id: 'union', domain: 'hydronic', medium: 'heating', connector: { family: 'thread', profile: 'G', size: '3/4', mate: 'female' } }],
          { portNodes: { tube: 'a', union: 'b' }, channels: [{ id: 'passage', from: 'a', to: 'b', kind: 'passive' }] })
        : passive(),
      model: variant === 'cap' ? 'hydraulic:terminal' : variant === 'tee' ? 'hydraulic:junction' : 'hydraulic:fitting',
      settings: fittingSettings, readings: ['installation', 'pressure'], installation: 'Сверить профиль порта, посадку и размер; совпадение ярлыка не подтверждает совместимость.',
    })),
  ...([['supply-manifold', 'Подающий коллектор'], ['return-manifold', 'Обратный коллектор'], ['pair-flowmeters', 'Пара коллекторов с расходомерами'],
    ['pair-plain', 'Пара коллекторов без расходомеров'], ['dynamic-manifold', 'Коллектор с ограничителем расхода']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({
      id: variant === 'pair-flowmeters' ? 'training-manifold-two-way' : variant === 'pair-plain' ? 'training-manifold-one-way' : undefined,
      family: 'manifolds', variant, titleRu, shape: variant === 'supply-manifold' || variant === 'return-manifold'
        ? junction(['main', 'loop-1', 'loop-2']) : regulatedManifold,
      model: variant === 'dynamic-manifold' ? 'valve:regulator' : 'hydraulic:manifold',
      settings: { outlets: outletCount(variant === 'pair-plain' || variant === 'dynamic-manifold' ? 1 : 2),
        spacingM: n('Шаг выводов', 'м', .025, .15, .05),
        ...(variant === 'dynamic-manifold' && { flowLimitM3s: n('Предел расхода', 'м³/с', .000001, .01, .00005),
          minimumDeltaPa: n('Нижний перепад регулятора', 'Па', 100, 10000, 2000),
          maximumDeltaPa: n('Верхний перепад регулятора', 'Па', 10000, 150000, 40000) }) }, readings: ['flow', 'pressure', 'installation'],
      installation: 'Отдельные гребёнки подачи и обратки; разметить каждую петлю.',
    })),
  ...([['pump', 'Циркуляционный насос', 'training-circulator'], ['direct-pump-group', 'Прямая насосная группа', undefined]] as const)
    .map(([variant, titleRu, id]): EquipmentSpec => ({ id, family: 'circulation', variant, titleRu, shape: passive('pump', [signal('power', 'input', 'relay')]),
      model: 'hydraulic:pump', settings: pumpSettings, readings: ['flow', 'pressure', 'status'],
      installation: 'Вход/выход по корпусу и устойчивый путь циркуляции.' })),
  ...([['pump-mixing-group', 'Насосно-смесительный узел с насосом', true], ['passive-mixing-group', 'Смесительный узел без насоса', false],
    ['two-way-mix', 'Двухходовой подмес', false], ['three-way-mix', 'Трёхходовой смеситель', false]] as const)
    .map(([variant, titleRu, driven]): EquipmentSpec => ({ family: 'mixing', variant, titleRu,
      shape: variant === 'two-way-mix' ? passive('passive', [valveInput]) : mixer(driven ? 'pump' : variant === 'three-way-mix' ? 'three-way' : 'passive'),
      model: variant === 'two-way-mix' ? 'valve:two-way' : 'valve:mixing-branches',
      settings: { ...(driven ? pumpSettings : {}), position: n('Открытие горячей ветви', 'доля', 0, 1, .5),
        targetC: n('Температура смеси', '°C', 10, 90, 35) }, readings: ['flow', 'opening', 'temperature'],
      installation: driven ? 'Проверить подачу, примесь и направление встроенного насоса.' : 'Проверить внешний побудитель расхода и правильность портов.' })),
];
