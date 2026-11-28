import { b, c, n, passive, signal, signals } from './definitions';
import type { EquipmentSpec } from './definitions';

const position = n('Открытие', 'доля', 0, 1, 1);
const lossK = n('Местное сопротивление', 'K', 0, 10000, 4);
const limit = n('Предельный расход', 'м³/с', .000001, .01, .00005);
const target = n('Уставка', '°C', 5, 80, 22);
const deadband = n('Гистерезис', 'К', .1, 10, 1);
const travel = n('Время полного хода', 'с', 1, 900, 120);
const fail = c('Положение без питания', ['normally-open', 'normally-closed'], 'normally-closed');
const demandIn = signal('demand', 'input', 'demand');
const demandOut = signal('demand', 'output', 'demand');
const tempIn = signal('temperature', 'input', 'temperature');
const tempOut = signal('temperature', 'output', 'temperature');
const relayOut = signal('relay', 'output', 'relay');
const command = signal('command', 'output', 'actuator');
export const controls: EquipmentSpec[] = [
  ...([['loop-balance', 'Регулировочный клапан петли'], ['branch-balance', 'Балансировочный клапан ветви'], ['flowmeter', 'Расходомер']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'balancing', variant, titleRu, shape: passive(),
      model: 'valve:balance', settings: { position, lossK, ...(variant === 'flowmeter' ? { flowLimitM3s: limit } : {}) },
      readings: ['flow', 'pressure', 'opening'], installation: 'Соблюдать направление и сверять расход в рабочем режиме насоса.' })),
  ...([['radiator-angle-valve', 'Угловой радиаторный клапан'], ['radiator-straight-valve', 'Прямой радиаторный клапан']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'balancing', variant, titleRu, shape: passive(),
      model: 'valve:balance', settings: { position, lossK }, readings: ['flow', 'pressure', 'opening'],
      installation: 'Радиаторная ветвь. Открытие задаётся вручную. Присоединения и ход термоголовки конкретного артикула сверяйте по паспорту.' })),
  ...([['ball-valve', 'Шаровой кран'], ['loop-valve', 'Запорный клапан петли'], ['motor-zone-valve', 'Зональный клапан с приводом']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'isolation', variant, titleRu,
      shape: passive('passive', variant === 'motor-zone-valve' ? [signal('command', 'input', 'actuator')] : []),
      model: variant === 'motor-zone-valve' ? 'valve:driven' : 'valve:isolation',
      settings: { position, lossK, ...(variant === 'motor-zone-valve' ? { travelS: travel, failPosition: fail } : {}) },
      readings: ['flow', 'opening', 'status'], installation: 'Полный ход должен перекрывать именно выбранную зону, а не соседние петли.' })),
  ...([['check', 'Обратный клапан'], ['bypass', 'Перепускной клапан'], ['jumper', 'Перемычка'], ['rtl', 'Ограничитель температуры обратки RTL']] as const)
    .map(([variant, titleRu]): EquipmentSpec => ({ family: 'directional', variant, titleRu, shape: passive(),
      model: variant === 'jumper' ? 'hydraulic:jumper' : 'valve:' + variant,
      settings: { lossK, ...(variant === 'rtl' ? { targetC: n('Порог обратки', '°C', 10, 70, 35), deadbandK: deadband }
        : variant === 'jumper' ? {} : { thresholdPa: n('Перепад открытия', 'Па', 0, 100000, variant === 'check' ? 100 : 15000) }) },
      readings: variant === 'rtl' ? ['temperature', 'flow', 'opening'] : ['flow', 'pressure', 'opening'],
      installation: variant === 'rtl' ? 'Устанавливать на обратке; регулируется температура воды, а не воздуха.' : 'Сверить направление расчётного потока и рабочий перепад.' })),
  { family: 'actuation', variant: 'remote-head', titleRu: 'Термоголовка с выносным датчиком', shape: signals(tempIn, command),
    model: 'control:temperature-actuator', settings: { targetC: target, deadbandK: deadband },
    readings: ['temperature', 'signal', 'opening'], installation: 'Разместить датчик в измеряемой зоне, связать выход с регулируемым клапаном.' },
  { family: 'actuation', variant: 'mix-actuator', titleRu: 'Привод смесительного клапана', shape: signals(tempIn, command),
    model: 'control:mix-actuator', settings: { targetC: n('Уставка смеси', '°C', 10, 90, 35), travelS: travel },
    readings: ['temperature', 'signal', 'opening'], installation: 'Связать датчик смеси и привод клапана, проверить крайние положения.' },
  { id: 'training-zone-actuator', family: 'actuation', variant: 'thermal-actuator', titleRu: 'Электротермический привод', shape: signals(demandIn, command),
    model: 'control:thermal-actuator', settings: { travelS: travel, failPosition: fail },
    readings: ['signal', 'opening', 'status'], installation: 'Выбрать поведение без питания и проверить ход привода при переключении.' },
  { id: 'training-thermostat', family: 'zone-sensing', variant: 'air-thermostat', titleRu: 'Комнатный термостат', shape: signals(demandOut),
    model: 'control:thermostat', settings: { targetC: target, deadbandK: deadband },
    readings: ['temperature', 'signal'], installation: 'Устанавливать в репрезентативной зоне вдали от локального нагрева.' },
  ...([['floor-sensor', 'Датчик температуры пола', undefined], ['supply-sensor', 'Датчик температуры подачи', 'training-temperature-sensor'],
    ['outdoor-sensor', 'Наружный датчик температуры', undefined]] as const)
    .map(([variant, titleRu, id]): EquipmentSpec => ({ id, family: 'zone-sensing', variant, titleRu, shape: signals(tempOut),
      model: 'control:sensor:' + variant, settings: { offsetK: n('Поправка измерения', 'К', -10, 10, 0) },
      readings: ['temperature', 'signal'], installation: 'Привязать датчик к измеряемой зоне или физическому узлу.' })),
  { family: 'zone-sensing', variant: 'zone-controller', titleRu: 'Зональный контроллер', shape: signals(demandIn, tempIn, command, relayOut),
    model: 'control:zone', settings: { targetC: target, floorLimitC: n('Ограничение пола', '°C', 15, 50, 29) },
    readings: ['signal', 'status'], installation: 'Подключить запрос зоны, измерение и управляющие цепи раздельно.' },
  { family: 'zone-sensing', variant: 'weather-controller', titleRu: 'Погодозависимый контроллер', shape: signals(tempIn, command),
    model: 'control:weather', settings: { designOutdoorC: n('Расчётное наружное значение', '°C', -60, 10, -20),
      targetC: n('Подача в расчётной точке', '°C', 15, 80, 40) }, readings: ['signal', 'temperature'],
    installation: 'Обеспечить измерение наружной температуры и ограничить уставку подачи.' },
  { family: 'safety-controls', variant: 'high-limiter', titleRu: 'Ограничитель максимальной температуры', shape: signals(tempIn, relayOut),
    model: 'control:high-limiter', settings: { tripC: n('Порог отключения', '°C', 20, 100, 55), deadbandK: deadband },
    readings: ['temperature', 'signal', 'status'], installation: 'Отдельная защитная цепь; потеря измерения не разрешает работу.' },
  { family: 'safety-controls', variant: 'emergency-relay', titleRu: 'Реле аварийного отключения',
    shape: signals(signal('permit', 'input', 'relay'), relayOut), model: 'control:safety-relay',
    settings: { manualReset: b('Ручной сброс после аварии', true) }, readings: ['signal', 'status'],
    installation: 'Подключить разрешение защиты к реально отключаемому оборудованию.' },
];
