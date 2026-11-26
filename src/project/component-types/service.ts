import { b, c, hydraulics, junction, n, passive, terminal, tube } from './definitions';
import type { EquipmentSpec } from './definitions';

const pressure = n('Рабочее давление', 'Па', 0, 1500000, 150000);
const volume = n('Учебный объём', 'м³', .0001, 10, .02);
const loss = n('Местное сопротивление', 'K', 0, 10000, 5);
const threshold = n('Давление открытия', 'Па', 10000, 1200000, 300000);

export const service: EquipmentSpec[] = [
  { family: 'pressure', variant: 'expansion-vessel', titleRu: 'Мембранный расширительный бак', shape: terminal(),
    model: 'pressure:gas-volume', settings: { volumeM3: volume, preloadPa: n('Предзаряд', 'Па', 10000, 500000, 100000) },
    readings: ['pressure', 'status'], installation: 'Сверить предзаряд при снятом давлении и не отсекать бак при работе.' },
  { family: 'pressure', variant: 'safety-group', titleRu: 'Группа безопасности', shape: terminal(),
    model: 'pressure:safety-group', settings: { thresholdPa: threshold, vent: b('Воздухоотводчик включён', true) },
    readings: ['pressure', 'status'], installation: 'Подключить к защищаемому объёму без запорной арматуры на этом пути.' },
  { family: 'pressure', variant: 'relief-valve', titleRu: 'Предохранительный клапан', shape: terminal(),
    model: 'pressure:relief', settings: { thresholdPa: threshold, dischargeM3s: n('Учебный расход сброса', 'м³/с', .000001, .05, .0001) },
    readings: ['pressure', 'flow', 'status'], installation: 'Сброс не является обраткой; отвод должен безопасно принимать сброс.' },
  { family: 'pressure', variant: 'pressure-gauge', titleRu: 'Манометр', shape: terminal(),
    model: 'measurement:pressure', settings: { maxPa: n('Предел шкалы', 'Па', 10000, 2000000, 600000) },
    readings: ['pressure'], installation: 'Измеряет давление в точке подключения, не образует пути циркуляции.' },
  ...([['air-vent', 'Воздухоотводчик'], ['air-separator', 'Сепаратор воздуха'], ['end-block', 'Концевой блок коллектора'],
    ['drain-cock', 'Сливной кран'], ['fill-cock', 'Кран заполнения'], ['protected-makeup', 'Узел подпитки с защитой от обратного потока']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'service', variant, titleRu, model: 'service:' + variant,
      shape: variant === 'air-separator' ? passive() : variant === 'protected-makeup'
        ? hydraulics([{ ...tube('feed'), medium: 'potable' }, tube('circuit')], { portNodes: { feed: 'external', circuit: 'heating' }, channels: [] })
        : terminal(), settings: { targetPa: pressure, normallyClosed: b('Закрыт в рабочем режиме', variant !== 'air-vent' && variant !== 'air-separator') },
      readings: ['pressure', 'status'], installation: variant === 'protected-makeup'
        ? 'Среды разделены; подпитка относится к сервисной операции, а не постоянной циркуляции.'
        : 'Не использовать как рабочий обход; обеспечить доступ для обслуживания.' })),
  ...([['strainer', 'Сетчатый фильтр'], ['dirt-separator', 'Грязеотделитель'], ['sludge-trap', 'Шламоуловитель'],
    ['magnetic-separator', 'Магнитный сепаратор']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'filtration', variant, titleRu, shape: passive(),
      model: 'fault:restriction', settings: { lossK: loss, contamination: n('Засорение', 'доля', 0, 1, 0),
        magnetic: b('Магнитный элемент', variant === 'magnetic-separator') },
      readings: ['flow', 'pressure', 'status'], installation: 'Соблюдать направление, оставить доступ к очистке и проверить перепад.' })),
  ...([['hydraulic-separator', 'Гидравлический разделитель'], ['buffer', 'Буферная ёмкость']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'storage', variant, titleRu,
      shape: hydraulics(['primary-in', 'primary-out', 'secondary-in', 'secondary-out'].map((id) => tube(id)), {
        portNodes: { 'primary-in': 'upper', 'primary-out': 'lower', 'secondary-in': 'lower', 'secondary-out': 'upper' },
        channels: [{ id: 'internal-mixing', from: 'upper', to: 'lower', kind: 'passive' }],
      }), model: 'thermal:' + variant,
      settings: { volumeM3: variant === 'buffer' ? n('Учебный объём', 'м³', .01, 10, .12) : volume,
        lossK: n('Сопротивление смешения', 'K', 0, 100, .5) },
      readings: ['flow', 'temperature', 'power'], installation: 'Один теплоноситель, четыре подключения; перепутанная ветвь меняет смешение.' })),
  { id: 'training-heat-exchanger', family: 'storage', variant: 'plate-exchanger', titleRu: 'Пластинчатый теплообменник', shape: passive(),
    model: 'thermal:exchanger', settings: { uaWPerK: n('Теплопередача', 'Вт/К', 1, 100000, 500),
      secondaryFluid: c('Учебная среда вторичной стороны', ['water', 'glycol'], 'water'),
      secondaryGlycolMassFraction: n('Массовая доля гликоля', 'доля', 0, .5, 0) },
    readings: ['flow', 'temperature', 'power'], installation: 'Первичная и вторичная стороны не обмениваются жидкостью.' },
  { family: 'measurement-radiators', variant: 'radiator', titleRu: 'Радиатор', shape: passive(), model: 'thermal:radiator',
    settings: { ratedPowerW: n('Условная номинальная мощность', 'Вт', 50, 12000, 1200), lossK: loss },
    readings: ['temperature', 'power', 'flow'], installation: 'Подключить к двум путям и привязать к комнате.' },
  { family: 'measurement-radiators', variant: 'thermometer', titleRu: 'Термометр', shape: terminal(),
    model: 'measurement:temperature', settings: { offsetK: n('Поправка измерения', 'К', -10, 10, 0) },
    readings: ['temperature'], installation: 'Одна точка измерения, без искусственного пути циркуляции.' },
  { family: 'measurement-radiators', variant: 'heat-meter', titleRu: 'Теплосчётчик', shape: junction(['in', 'out']),
    model: 'measurement:heat', settings: { minimumFlowM3s: n('Минимальный расход измерения', 'м³/с', .000001, .01, .00002) },
    readings: ['flow', 'temperature', 'power'], installation: 'Расход и два температурных замера нужны отдельно; не принимать показание за мощность источника.' },
];
