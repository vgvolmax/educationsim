import { useEffect, useState } from 'react';
import { compileLiveScenario } from '../project/live-scenario';
import type { TemplateId } from '../project/templates';
import type { ProjectDocument } from '../project/types';
import { captureFrame } from '../simulation/comparison';
import type { SimulationCapture } from '../simulation/comparison';
import type { SimulationCommand, SimulationScenario } from '../simulation/engine-types';
import type { SessionView, SimulationSpeed } from '../simulation/session';
import { Comparison, RunHistory } from '../views/graph/RunHistory';
import { numberRu, RunReadings } from '../views/measurements/RunReadings';
import { createSimulationClient } from '../worker/client';
import { editorId } from './useProject';

type Client = ReturnType<typeof createSimulationClient>;
type Run = { client: Client; scenario: SimulationScenario; id: string };
const modes: Record<Client['state']['mode'], string> = {
  idle: 'Не подготовлен', loading: 'Подготавливается', paused: 'На паузе', running: 'Выполняется', stopped: 'Остановлен', stalled: 'Связь с расчётом потеряна',
};

export function SimulationPanel({ project, preset, onFocus }: {
  project: ProjectDocument; preset?: TemplateId; onFocus(id: string): void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [view, setView] = useState<Client['state'] | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [speed, setSpeed] = useState<number | null>(null);
  const [a, setA] = useState<SimulationCapture | null>(null), [b, setB] = useState<SimulationCapture | null>(null);
  const [frames, setFrames] = useState<readonly SessionView[]>([]);
  const current = run?.scenario.system.projectId === project.projectId && run.scenario.system.projectRevision === project.revision ? run : null;
  useEffect(() => {
    if (!current) return;
    const { client } = current;
    let last: Client['state'] | null = null;
    let mark = { time: performance.now(), tick: 0 };
    const poll = setInterval(() => {
      const state = client.state;
      if (state !== last) {
        setView(state);
        const frame = state.view;
        if (frame?.snapshot.tick === 0) setFrames([]);
        else if (frame && !frame.stale && frame.snapshot.health !== 'stopped') setFrames((previous) =>
          previous.at(-1)?.snapshot.tick === frame.snapshot.tick ? previous : [...previous.slice(-47), frame]);
        last = state;
      }
      const at = performance.now(), tick = state.view?.snapshot.tick ?? 0;
      if (state.mode !== 'running') { if (at - mark.time > 500) setSpeed(null); mark = { time: at, tick }; }
      else if (at - mark.time >= 1000) { setSpeed(Math.max(0, (tick - mark.tick) * 1000 / (at - mark.time))); mark = { time: at, tick }; }
    }, 65);
    return () => { clearInterval(poll); client.dispose(); };
  }, [current]);

  function prepare() {
    const loaded = compileLiveScenario(project, preset);
    setView(null);
    setFrames([]);
    setSpeed(null);
    setBranch('');
    if (!loaded.ok) { setError(loaded.diagnostics.map((d) => d.message).join(' ')); setRun(null); return; }
    setError('');
    setNotes(loaded.diagnostics.filter((d) => d.code !== 'estimated_link_length').map((d) => d.message));
    const client = createSimulationClient();
    const id = editorId('run');
    client.load(id, loaded.value);
    setView(client.state);
    setRun({ client, scenario: loaded.value, id });
  }
  function command(value: SimulationCommand) { current?.client.send({ kind: 'command', command: value }); }

  const frame = current ? view?.view : null;
  const available = Boolean(current && view?.mode !== 'loading' && view?.mode !== 'stalled' && view?.mode !== 'stopped');
  const selected = current?.scenario.system.hydraulicChannels.find((x) => x.id === branch && x.origin.linkId) ??
    current?.scenario.system.hydraulicChannels.find((x) => x.origin.loopRouteId);
  const sensor = current?.scenario.control.bindings.find((x) => x.sampleId === 'supply');
  const limiter = current?.scenario.control.devices.find((x) => x.kind === 'high-limit');
  const branches = current?.scenario.system.hydraulicChannels.filter((x) => x.origin.linkId) ?? [];
  const aperture = selected && current?.scenario.hydraulic.valves?.[selected.id];
  const activeFrame = frame && !frame.stale && frame.mode !== 'stopped' && frame.snapshot.health !== 'stopped' && frame.snapshot.tick > 0;
  function pin(side: 'a' | 'b') {
    if (!activeFrame || !current) return;
    const atSameTime = side === 'b' && a?.revision !== project.revision && a
      ? frames.find((f) => f.snapshot.tick === a.tick) : undefined;
    const captured = captureFrame(current.scenario, atSameTime ?? frame);
    if (captured) (side === 'a' ? setA : setB)(captured);
  }
  return <section aria-label="Расчёт" className="simulation-panel">
    <div className="simulation-title"><div><p className="eyebrow">Учебный режим</p><h2>Расчёт и эксперимент</h2></div>
      <button onClick={prepare}>{current ? 'Начать новый прогон' : 'Подготовить прогон'}</button></div>
    {!current && <p>{run ? 'Схема изменилась. Подготовьте новый прогон; снимки А и Б сохранены.' : 'Расчёт начнётся с текущей схемы и её начальных условий.'}</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {current && <div>
      <p className="run-status"><strong>{modes[view?.mode ?? 'loading']}</strong>
        {frame && <span>Модельный тик: {frame.snapshot.tick}</span>}
        {view?.mode === 'running' && <span>{speed === null ? 'Измеряем темп…' : 'Фактически ×' + numberRu(speed, 1)}</span>}
        {frame?.throttled && <span>Ускорение ограничено</span>}</p>
      <div className="simulation-actions">
        <button disabled={!available || view?.mode === 'running'} onClick={() => current.client.send({ kind: 'resume' })}>Пуск</button>
        <button disabled={!available || view?.mode !== 'running'} onClick={() => current.client.send({ kind: 'pause' })}>Пауза</button>
        <button disabled={!available || view?.mode === 'running'} onClick={() => current.client.send({ kind: 'step' })}>Один шаг</button>
        <button disabled={view?.mode === 'loading' || view?.mode === 'stalled'} onClick={() => current.client.send({ kind: 'reset' })}>Сбросить прогон</button>
        <label>Скорость прогона <select value={frame?.speed ?? 1} disabled={!available}
          onChange={(e) => current.client.send({ kind: 'speed', speed: Number(e.target.value) as SimulationSpeed })}>
          {[1, 10, 60, 600].map((s) => <option value={s} key={s}>×{s}</option>)}
        </select></label>
      </div>
      {!!notes.length && <details className="editor-section"><summary>Ограничения схемы</summary><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
      {!frame && !!view?.diagnostics.length && <p className="editor-error">{view.diagnostics.map((d) => d.message).join(' ')}</p>}
      <div className="simulation-actions">
        {branches.length > 0 && <label>Ветвь эксперимента <select value={selected?.id ?? ''} onChange={(e) => setBranch(e.target.value)}>
          {!selected && <option value="">Выберите водяную ветвь</option>}
          {branches.map((x) => <option key={x.id} value={x.id}>{x.origin.linkId}</option>)}
        </select></label>}
        {aperture && 'opening' in aperture && selected && ['balance', 'shutoff', 'two-way'].includes(aperture.kind) &&
          <><button disabled={!available} onClick={() => command({ kind: 'set-valve', channelId: selected.id, opening: 0 })}>Закрыть клапан</button>
            <button disabled={!available} onClick={() => command({ kind: 'set-valve', channelId: selected.id, opening: 1 })}>Открыть клапан</button></>}
        {selected && <><button disabled={!available} onClick={() => command({ kind: 'fault', command: { kind: 'air', id: selected.id, extent: 1 } })}>Имитировать воздух</button>
          <button disabled={!available} onClick={() => command({ kind: 'fault', command: { kind: 'vent', id: selected.id } })}>Развоздушить</button></>}
        {sensor && <><button disabled={!available} onClick={() => command({ kind: 'fault', command: { kind: 'sensor-failure', id: sensor.sampleId } })}>Имитировать отказ датчика</button>
          <button disabled={!available} onClick={() => command({ kind: 'fault', command: { kind: 'sensor-repair', id: sensor.sampleId } })}>Восстановить датчик</button></>}
        {current.scenario.sources[0] && <><button disabled={!available} onClick={() => command({
          kind: 'manual', actuatorId: current.scenario.sources[0]!.actuatorIds[0]!, demand: true,
        })}>Запросить нагрев</button><button disabled={!available} onClick={() => command({
          kind: 'manual', actuatorId: current.scenario.sources[0]!.actuatorIds[0]!, demand: false,
        })}>Снять ручной запрос</button></>}
        {limiter && <button disabled={!available} onClick={() => command({ kind: 'reset-limit', limiterId: limiter.id })}>Сбросить защиту</button>}
      </div>
      <p className="run-hint">Управляющая команда действует со следующего модельного тика.</p>
      {frame && <><RunReadings frame={frame} scenario={current.scenario} onFocus={onFocus} /><RunHistory frame={frame} key={current.id} /></>}
    </div>}
    <div className="simulation-actions">
      <button disabled={!activeFrame} onClick={() => pin('a')}>Зафиксировать А</button>
      <button disabled={!activeFrame} onClick={() => pin('b')}>Зафиксировать Б</button>
      {a && <small>А: тик {a.tick}, ред. {a.revision}</small>}{b && <small>Б: тик {b.tick}, ред. {b.revision}</small>}
    </div>
    {a && b && <Comparison a={a} b={b} />}
  </section>;
}
