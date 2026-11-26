import { branchEvidence, explainRun } from '../../simulation/evidence';
import type { Explanation, Reading } from '../../simulation/diagnostics';
import type { SimulationScenario } from '../../simulation/engine-types';
import type { SessionView } from '../../simulation/session';

export const numberRu = (x: number, places = 2): string => x.toFixed(places).replace('.', ',');
function text(reading: Reading) {
  if (reading.status === 'measured') return numberRu(reading.value) + ' ' + reading.unit;
  return reading.lastConfirmedTick ? 'Недоступно (последний тик ' + reading.lastConfirmedTick + ')' : 'Нет данных';
}

export function RunReadings({ frame, scenario, onFocus }: { frame: SessionView; scenario: SimulationScenario; onFocus(id: string): void }) {
  const pressure = Object.values(frame.snapshot.hydraulics?.pressurePa ?? {}).find((value) => typeof value === 'number');
  const active = !frame.stale && frame.mode !== 'stopped' && frame.snapshot.health !== 'stopped' && frame.snapshot.tick > 0;
  const heating = Object.values(frame.snapshot.sources);
  const firstSource = scenario.sources[0];
  const sourceEdge = firstSource && scenario.system.hydraulicChannels.find((channel) => channel.id === firstSource.channelId);
  const returnEdge = sourceEdge && scenario.system.hydraulicChannels.find((channel) => channel.id !== sourceEdge.id &&
    (channel.to === sourceEdge.from && (frame.snapshot.hydraulics?.channels[channel.id]?.flowM3s ?? 0) > 0 ||
      channel.from === sourceEdge.from && (frame.snapshot.hydraulics?.channels[channel.id]?.flowM3s ?? 0) < 0));
  const supplyC = firstSource && frame.snapshot.fluid.cells[firstSource.waterCellId]?.temperatureC;
  const returnC = returnEdge && frame.snapshot.fluid.cells[returnEdge.id]?.temperatureC;
  const temperature = (value: number | undefined) => active && value !== undefined ? numberRu(value) + ' °C' : 'Нет данных';
  const firstRoom = Object.values(frame.snapshot.building?.roomsC ?? {})[0];
  const firstFloor = Object.values(frame.snapshot.building?.floors ?? {})[0];
  const issues = explainRun(frame);
  function issueLabel(issue: Explanation) {
    switch (issue.state) {
      case 'stopped': return 'Модель остановлена';
      case 'protected': return 'Защитная цепь';
      case 'insufficient': return 'Недостаточно данных';
      case 'restricted': return 'Режим ограничен';
      case 'training': return 'Учебный параметр';
      default: return 'Состояние контура';
    }
  }
  return <>
    <dl className="summary-readings">
      <div><dt>Давление в расчётной точке</dt><dd>{active && pressure !== undefined ? numberRu(pressure / 1000, 1) + ' кПа' : 'Нет данных'}</dd></div>
      <div><dt>Мощность источников</dt><dd>{active && heating.length ? numberRu(heating.reduce((s, c) => s + c.powerW, 0), 0) + ' Вт' : 'Нет данных'}</dd></div>
      <div><dt>Подача первого источника</dt><dd>{temperature(supplyC)}</dd></div>
      <div><dt>Обратка первого источника</dt><dd>{temperature(returnC)}</dd></div>
      <div><dt>Воздух в первой комнате</dt><dd>{active && firstRoom !== undefined ? numberRu(firstRoom) + ' °C' : 'Нет данных'}</dd></div>
      <div><dt>Поверхность первой петли</dt><dd>{active && firstFloor ? numberRu(firstFloor.surfaceC) + ' °C' : 'Нет данных'}</dd></div>
    </dl>
    <details open className="editor-section">
      <summary>Расход по ветвям</summary>
      <div className="reading-list">{scenario.system.hydraulicChannels.filter((c) => c.origin.linkId).map((channel) => {
        const item = branchEvidence(frame, channel.id);
        return <div className="meter-row" key={channel.id}>
          <span>{item.target.id}</span><output data-meter={channel.id}>{text(item.reading)}</output>
          {item.reasons.filter((reason) => reason.state === 'restricted' || reason.state === 'off').map((reason) =>
            <p key={reason.code}>{reason.cause} {reason.action}</p>)}
        </div>;
      })}</div>
    </details>
    <details open className="editor-section">
      <summary>Диагностика</summary>
      <ul className="messages">{issues.map((issue, i) => <li key={issue.code + ':' + i}>
        <strong>{issueLabel(issue)}</strong> {issue.cause} <span>{issue.action}</span>
      </li>)}</ul>
      {frame.events.length > 0 && <ul className="event-list">
        {frame.events.slice(-16).map((event) => {
          const component = scenario.system.components.find((c) => c.id === event.componentId);
          const builtIn = /^supply-limit(?:-(\d+))?$/.exec(event.componentId);
          const owner = component?.id ?? (builtIn ? scenario.sources[Number(builtIn[1] ?? 0)]?.componentId : undefined);
          return <li key={event.id}><span>Тик {event.tick} · </span>
            <strong>{event.kind === 'limiter-tripped' ? 'Защита сработала' : 'Разрешение восстановлено'}</strong>
            <span> · {event.componentId}</span>
            {owner && <button onClick={() => onFocus(owner)}>Перейти к узлу защиты</button>}
          </li>;
        })}
      </ul>}
    </details>
  </>;
}
