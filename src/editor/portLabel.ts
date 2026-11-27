import type { trainingRegistry } from '../project/registry';

export function portLabel(port: NonNullable<ReturnType<typeof trainingRegistry.get>>['ports'][number]): string {
  if (port.domain === 'control') {
    const signals: Record<string, string> = { demand: 'запрос тепла', temperature: 'температура', command: 'команда' };
    return (port.direction === 'output' ? 'Выход сигнала' : 'Вход сигнала') + (signals[port.signal] ? ': ' + signals[port.signal] : ' · ' + port.id);
  }
  const branch = /^(supply|return)-(\d+)$/.exec(port.id);
  if (branch) return (branch[1] === 'supply' ? 'Подача петли ' : 'Обратка петли ') + branch[2];
  const names: Record<string, string> = { supply: 'Подача', return: 'Обратка', feed: 'Вход подачи',
    in: 'Вход', out: 'Выход', 'primary-in': 'Первичный вход', 'primary-out': 'Первичный выход',
    'secondary-in': 'Вторичный вход', 'secondary-out': 'Вторичный выход', 'side-16': 'Сторона 16 мм', 'side-20': 'Сторона 20 мм' };
  return names[port.id] ?? 'Порт ' + port.id;
}
