import type { Lesson } from './authoring';

export const firstLesson: Lesson = {
  version: 1, id: 'L01', title: 'Подача, петля и обратка', minutes: 5,
  goal: 'Запустите прямую схему и проследите, куда идёт теплоноситель. Найдите подачу, одну петлю пола и обратку.',
  explanation: 'Насос создаёт перепад. Подача несёт воду к петле, обратка возвращает её. Без замкнутого пути положительного расхода нет.',
  hints: ['Дайте модели один тик. Нулевое показание после расчёта отличается от отсутствия показания до запуска.'],
  cases: [{ id: 'main', title: 'Две петли прямой системы', template: 'direct' }],
  actions: [
    { id: 'step', type: 'step', label: 'Рассчитать один тик' },
    { id: 'supply', type: 'inspect', target: 'supply', label: 'Найти подачу' },
    { id: 'loop', type: 'inspect', target: 'pipe-a', label: 'Найти петлю пола' },
    { id: 'return', type: 'inspect', target: 'return', label: 'Найти обратку' },
  ],
  criteria: [
    { id: 'moving', type: 'range', metric: 'flow', target: 'link:pipe-a', min: .000001, max: .001, label: 'Положительный расход в первой петле' },
    { id: 'found-supply', type: 'did', actionId: 'supply', label: 'Отмечена подача' },
    { id: 'found-loop', type: 'did', actionId: 'loop', label: 'Отмечена петля' },
    { id: 'found-return', type: 'did', actionId: 'return', label: 'Отмечена обратка' },
  ],
};
