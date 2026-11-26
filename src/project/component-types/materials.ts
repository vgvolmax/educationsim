import { c, material, n } from './definitions';
import type { EquipmentSpec, Settings } from './definitions';

const depth = n('Толщина слоя', 'м', .0001, .3, .03);
const resistance = n('Сопротивление слоя', 'м²·К/Вт', .001, 10, .2);
const pitch = n('Шаг укладки', 'м', .025, .35, .15);
const size = n('Габарит', 'м', .001, 5, .1);
const capacity = n('Удельная теплоёмкость', 'Дж/(кг·К)', 100, 4000, 900);
const conductivity = n('Теплопроводность', 'Вт/(м·К)', .015, 400, 1.4);
const installation = (variant: string, titleRu: string, settings: Settings, instruction: string): EquipmentSpec =>
  ({ family: 'floor-installation', variant, titleRu, settings, shape: material, mode: 'material',
    model: 'installation:' + variant, readings: ['installation'], installation: instruction });
const layer = (variant: string, titleRu: string, settings: Settings, instruction: string): EquipmentSpec =>
  ({ family: 'floor-build-up', variant, titleRu, settings, shape: material, mode: 'material',
    model: 'thermal:floor-layer', readings: ['temperature', 'installation'], installation: instruction });
export const materials: EquipmentSpec[] = [
  { id: 'training-wall-cabinet', family: 'mounting', variant: 'cabinet', titleRu: 'Коллекторный шкаф', shape: material, mode: 'mount',
    model: 'layout:enclosure', settings: { widthM: n('Ширина', 'м', .2, 2, .6), heightM: n('Высота', 'м', .1, 2, .6),
      depthM: n('Глубина', 'м', .04, .6, .12) }, readings: ['installation'],
    installation: 'Проверить габариты гребёнок и доступ для обслуживания без перегиба труб.' },
  { family: 'mounting', variant: 'bracket', titleRu: 'Кронштейн', shape: material, mode: 'mount',
    model: 'layout:support', settings: { distanceM: size, loadKg: n('Учебная допустимая нагрузка', 'кг', 1, 500, 30) },
    readings: ['installation'], installation: 'Проверить точки крепления и расстояние между гребёнками.' },
  installation('floor-insulation', 'Теплоизоляция перекрытия',
    { thicknessM: depth, resistanceM2KW: resistance }, 'Разместить ниже труб, отдельно от сопротивления отделки.'),
  installation('stud-mat', 'Монтажный мат с бобышками',
    { thicknessM: depth, pitchM: pitch }, 'Согласовать сетку фиксации и радиусы поворота трубы.'),
  installation('film', 'Разделительная плёнка', { thicknessM: n('Толщина', 'м', .00005, .005, .0002) },
    'Не считать плёнку заменой основного слоя утепления.'),
  installation('underlay', 'Подложка', { thicknessM: depth, resistanceM2KW: resistance },
    'Указать назначение и положение подложки по отношению к трубе.'),
  installation('mesh', 'Монтажная сетка', { pitchM: pitch }, 'Выбрать сетку и узлы крепления трубы по раскладке.'),
  installation('rail', 'Монтажная шина', { pitchM: pitch }, 'Учитывать ориентацию шины и доступные защёлки.'),
  installation('clips', 'Скобы крепления', { intervalM: size }, 'Уменьшить расстояние между креплениями в зоне изгиба.'),
  installation('edge-tape', 'Демпферная лента', { widthM: size }, 'Разместить по периметру на высоту конструкции пола.'),
  installation('joint', 'Деформационный шов', { widthM: n('Ширина', 'м', .001, .05, .01) },
    'Избегать пересечения петлёй или предусмотреть защиту трубы в месте прохода.'),
  installation('sleeve', 'Защитная гильза', { lengthM: size, insideMm: n('Внутренний диаметр', 'мм', 10, 300, 25) },
    'Защищает участок пересечения; сама не является гидравлической ветвью.'),
  layer('screed', 'Стяжка', { thicknessM: depth, conductivityWmK: conductivity, heatCapacityJkgK: capacity },
    'Толщину считать заданным слоем и отдельно проверять покрытие над трубой.'),
  layer('dry-plate', 'Теплораспределительная пластина', { thicknessM: n('Толщина', 'м', .0001, .02, .0005),
    conductivityWmK: n('Теплопроводность', 'Вт/(м·К)', .01, 400, 160) }, 'Привязать пластину к трубе и обеспечить контакт с настилом.'),
  layer('deck', 'Настильная панель', { thicknessM: depth, conductivityWmK: conductivity, heatCapacityJkgK: capacity },
    'Учесть путь тепла через панель; не смешивать её со стяжкой.'),
  layer('floor-finish', 'Чистовое покрытие', { kind: c('Тип покрытия', ['tile', 'laminate', 'wood', 'other'], 'tile'),
    resistanceM2KW: resistance, maxSurfaceC: n('Учебное ограничение нагрева', '°C', 20, 65, 29) }, 'Проверить ограничения материала по нагреву и тепловому сопротивлению.'),
];
