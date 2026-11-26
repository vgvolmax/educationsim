import { useState } from 'react';
import type { SessionView } from '../../simulation/session';
import { compareCaptures } from '../../simulation/comparison';
import type { SimulationCapture } from '../../simulation/comparison';
import { numberRu } from '../measurements/RunReadings';

export function RunHistory({ frame }: { frame: SessionView }) {
  const [requested, setRequested] = useState<number | null>(null);
  const history = frame.samples.filter((s) => s.tick > 0 && s.highestWaterC !== null).slice(-180);
  const selected = requested !== null ? history.find((s) => s.tick === requested) : history.at(-1);
  if (!history.length) return <p>График появляется после первого расчётного тика.</p>;
  const high = Math.max(...history.map((s) => s.highestWaterC!)) + 1;
  const low = Math.min(...history.map((s) => s.highestWaterC!)) - 1;
  const line = history.map((p, i) => (10 + 280 * i / Math.max(1, history.length - 1)) + ',' +
    (85 - 75 * (p.highestWaterC! - low) / (high - low))).join(' ');
  return <details className="editor-section"><summary>История температуры воды</summary>
    <svg className="run-chart" role="img" aria-label="Максимальная температура воды по модельным тикам" viewBox="0 0 300 100">
      <path d="M10 10 V88 H290" className="run-chart-axis" />
      <polyline points={line} className="run-chart-line" />
    </svg>
    <label>Прошлый снимок <select value={selected?.tick ?? ''} onChange={(e) => setRequested(Number(e.target.value))}>
      {history.map((s) => <option key={s.tick} value={s.tick}>Тик {s.tick}</option>)}
    </select></label>
    <p>{selected?.highestWaterC == null ? 'Снимок вышел из окна истории.' : 'Максимум воды: ' + numberRu(selected.highestWaterC) + ' °C'}</p>
  </details>;
}

export function Comparison({ a, b }: { a: SimulationCapture; b: SimulationCapture }) {
  const result = compareCaptures(a, b);
  const display = (n: number | null) => n === null ? '—' : numberRu(n);
  return <section aria-label="Сравнение А и Б" className="run-comparison">
    <h3>Сравнение А и Б</h3>
    <p>А: редакция {a.revision}, тик {a.tick}. Б: редакция {b.revision}, тик {b.tick}.</p>
    {!result.sameTick && <p>Разное модельное время: разницы не рассчитаны.</p>}
    {!result.sameStart && <p>Начальные данные или опорные условия отличаются.</p>}
    {!result.sameProject && <p>Снимки относятся к разным проектам.</p>}
    {result.removed.length > 0 && <p>Сняты: {result.removed.map(({ id, typeId }) => id + ' (' + typeId + ')').join(', ')}.</p>}
    {result.added.length > 0 && <p>Добавлены: {result.added.map(({ id, typeId }) => id + ' (' + typeId + ')').join(', ')}.</p>}
    <p>Срабатывания защиты: А {a.events.filter((event) => event.kind === 'limiter-tripped').length},
      Б {b.events.filter((event) => event.kind === 'limiter-tripped').length}.</p>
    <div className="comparison-table"><table><thead><tr><th>Измерение</th><th>А</th><th>Б</th><th>Б − А</th></tr></thead>
      <tbody>{result.readings.map((r) => <tr key={r.id}><th scope="row">{r.id}, {r.unit}</th>
        <td>{display(r.before)}</td><td>{display(r.after)}</td><td>{display(r.delta)}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
