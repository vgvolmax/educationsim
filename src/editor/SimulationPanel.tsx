import { useEffect, useRef, useState } from 'react';
import { compileLiveScenario } from '../project/live-scenario';
import { parseRussianDecimal } from '../project/units';
import type { TemplateId } from '../project/templates';
import type { ProjectDocument } from '../project/types';
import { captureFrame } from '../simulation/comparison';
import type { ProjectArtifacts } from '../storage/project-transfer';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { SimulationRecord } from '../simulation/replay';
import type { SimulationCommand, SimulationScenario } from '../simulation/engine-types';
import type { SessionView, SimulationSpeed } from '../simulation/session';
import { Comparison, RunHistory } from '../views/graph/RunHistory';
import { numberRu, RunReadings } from '../views/measurements/RunReadings';
import { createSimulationClient } from '../worker/client';
import type { SceneLive } from '../views/scene/Scene';
import { editorId } from './useProject';

type Client = ReturnType<typeof createSimulationClient>;
type Run = { client: Client; scenario: SimulationScenario; id: string };
const modes: Record<Client['state']['mode'], string> = {
  idle: 'Не подготовлен', loading: 'Подготавливается', paused: 'На паузе', running: 'Выполняется', stopped: 'Остановлен', stalled: 'Связь с расчётом потеряна',
};

function ValvePosition({ accepted, enabled, onChange }: {
  accepted: number | null; enabled: boolean; onChange(value: number): void;
}) {
  const [invalid, setInvalid] = useState(false);
  return <form className="simulation-actions" onSubmit={(event) => {
    event.preventDefault();
    const requested = parseRussianDecimal(String(new FormData(event.currentTarget).get('opening')));
    if (!enabled || requested === null || requested < 0 || requested > 100) { setInvalid(true); return; }
    setInvalid(false);
    onChange(requested / 100);
  }}>
    <label>Задать открытие, % <input name="opening" inputMode="decimal" disabled={!enabled}
      defaultValue={accepted === null ? '' : String(accepted * 100).replace('.', ',')}
      aria-invalid={invalid || undefined} /></label>
    <button disabled={!enabled}>Применить открытие</button>
    <output>{accepted === null ? 'Фактическое открытие: нет данных' : 'Фактическое открытие: ' + numberRu(accepted * 100, 1) + ' %'}</output>
    {invalid && <p className="editor-error" role="alert">Введите открытие от 0 до 100 %.</p>}
  </form>;
}

export function SimulationPanel({ project, preset, artifacts, onArtifacts, onFocus, onLive, children }: {
  project: ProjectDocument; preset?: TemplateId; artifacts: ProjectArtifacts; onArtifacts: Dispatch<SetStateAction<ProjectArtifacts>>; onFocus(id: string): void; children: ReactNode; onLive?(live: SceneLive | null): void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [view, setView] = useState<Client['state'] | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [speed, setSpeed] = useState<number | null>(null);
  const { a, b } = artifacts.captures;
  const recorded = useRef<SimulationRecord | null>(null);
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

  useEffect(() => {
    const exported = current ? view?.record : null;
    if (!exported || exported === recorded.current) return;
    recorded.current = exported;
    onArtifacts((all) => ({ ...all, records: [...all.records.slice(-3), exported] }));
  }, [current, view?.record, onArtifacts]);

  const frame = current ? view?.view : null;
  useEffect(() => {
    if (!onLive) return;
    if (!current || !frame) { onLive(null); return; }
    const valves = Object.fromEntries(Object.entries(current.scenario.hydraulic.valves ?? {}).flatMap(([id, valve]) =>
      'opening' in valve && ['balance', 'shutoff', 'two-way'].includes(valve.kind) ? [[id, valve.opening] as const] : []));
    onLive({ frame, system: current.scenario.system, valves,
      setValve: (id, opening) => { current.client.send({ kind: 'command', command: { kind: 'set-valve', channelId: id, opening } }); } });
  }, [current, frame, onLive]);

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
    if (captured) onArtifacts((all) => ({ ...all, captures: { ...all.captures, [side]: captured } }));
  }
  const firstLoop = current?.scenario.system.hydraulicChannels.find((channel) => channel.origin.loopRouteId);
  const firstFlow = activeFrame && firstLoop && frame.snapshot.hydraulics?.channels[firstLoop.id]?.flowM3s;
  return <>
    <section aria-label="Расчёт" className="simulation-panel simulation-controls">
    <div className="simulation-title"><h2>Расчёт и эксперимент</h2>
      <button onClick={prepare}>{current ? 'Начать новый прогон' : 'Подготовить прогон'}</button></div>
    {!current && <p>{run ? 'Схема изменилась. Подготовьте новый прогон. Снимки А и Б сохранены.' : 'Расчёт начнётся с текущей схемы и её начальных условий.'}</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {current && <div>
      <p className="run-status"><strong>{modes[view?.mode ?? 'loading']}</strong>
        {frame && <span>Модельный тик: {frame.snapshot.tick}</span>}
        {typeof firstFlow === 'number' && <span>Расход первой петли: {numberRu(firstFlow * 60_000)} л/мин</span>}
        {view?.mode === 'running' && <span>{speed === null ? 'Измеряем темп…' : 'Фактически ×' + numberRu(speed, 1)}</span>}
        {frame?.throttled && <span>Ускорение ограничено</span>}</p>
      <div className="simulation-actions">
        <button disabled={!available || view?.mode === 'running'} onClick={() => current.client.send({ kind: 'resume' })}>Пуск</button>
        <button disabled={!available || view?.mode !== 'running'} onClick={() => current.client.send({ kind: 'pause' })}>Пауза</button>
        <button disabled={!available || view?.mode === 'running'} onClick={() => current.client.send({ kind: 'step' })}>Один шаг расчёта</button>
        <button disabled={view?.mode === 'loading' || view?.mode === 'stalled'} onClick={() => current.client.send({ kind: 'reset' })}>Сбросить прогон</button>
        <label>Скорость прогона <select value={frame?.speed ?? 1} disabled={!available}
          onChange={(e) => current.client.send({ kind: 'speed', speed: Number(e.target.value) as SimulationSpeed })}>
          {[1, 10, 60, 600].map((s) => <option value={s} key={s}>×{s}</option>)}
        </select></label>
      </div>
    </div>}
    </section>
    {children}
    {(current || a || b || artifacts.records.length > 0) && <section className="simulation-panel" aria-label="Показания и эксперименты">
    {current && <div>
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
        {frame && <button disabled={!available} onClick={() => command({ kind: 'power', powered: !frame.snapshot.powered })}>
          {frame.snapshot.powered ? 'Отключить питание модели' : 'Восстановить питание модели'}
        </button>}
        {limiter && <button disabled={!available} onClick={() => command({ kind: 'reset-limit', limiterId: limiter.id })}>Сбросить защиту</button>}
      </div>
      {aperture && 'opening' in aperture && selected && ['balance', 'two-way'].includes(aperture.kind) &&
        <ValvePosition key={current.id + ':' + selected.id} enabled={available}
          accepted={!frame || frame.stale || frame.mode === 'stopped' ? null : frame.snapshot.valveOpenings[selected.id] ?? aperture.opening}
          onChange={(opening) => command({ kind: 'set-valve', channelId: selected.id, opening })} />}
      <p className="run-hint">Управляющая команда действует со следующего модельного тика.</p>
      {frame && <><RunReadings frame={frame} scenario={current.scenario} onFocus={onFocus} /><RunHistory frame={frame} key={current.id} /></>}
    </div>}
    <div className="simulation-actions">
      <button disabled={!activeFrame} onClick={() => pin('a')}>Зафиксировать А</button>
      <button disabled={!activeFrame} onClick={() => pin('b')}>Зафиксировать Б</button>
      <button disabled={!current || !frame || frame.stale || frame.snapshot.tick <= 0} onClick={() => current?.client.send({ kind: 'record' })}>
        Сохранить запись прогона</button>
      {artifacts.records.length > 0 && <small>Сохранённых записей: {artifacts.records.length}</small>}
      {a && <small>А: тик {a.tick}, ред. {a.revision}</small>}{b && <small>Б: тик {b.tick}, ред. {b.revision}</small>}
    </div>
    {a && b && <Comparison a={a} b={b} />}
    </section>}
  </>;
}
