import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Ref } from 'react';
import { equipmentRegistry, trainingRegistry } from '../project/registry';
import { createConnectionChecker } from '../project/topology';
import type { ComponentInstance, PortEndpoint, ProjectDocument } from '../project/types';

export function equipmentLabel(component: ComponentInstance): string {
  return equipmentRegistry.get(component.typeId)?.titleRu ?? component.typeId;
}

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

export function mayCrossLevels(from: ComponentInstance, to: ComponentInstance, domain: 'hydronic' | 'control'): boolean {
  return domain === 'control' || from.level === to.level ||
    [from, to].some((c) => equipmentRegistry.get(c.typeId)?.variant === 'riser');
}

export function ConnectionGuide({ project, component, pending, message, onPick, onCancel, onMount, titleRef }: {
  project: ProjectDocument; component?: ComponentInstance; pending: PortEndpoint | null; message: string;
  titleRef: Ref<HTMLHeadingElement>; onPick(endpoint: PortEndpoint): void; onCancel(): void; onMount(): void;
}) {
  const check = useMemo(() => createConnectionChecker(project, trainingRegistry), [project]);
  const source = project.components.find(({ id }) => id === pending?.componentId);
  const start = source && trainingRegistry.get(source.typeId)?.ports.find(({ id }) => id === pending?.portId);
  const occupiedWater = useMemo(() => new Set(project.hydronicLinks.flatMap(({ from, to }) =>
    [from.componentId + ':' + from.portId, to.componentId + ':' + to.portId])), [project.hydronicLinks]);

  const targets = useMemo(() => {
    if (!source || !start || !pending) return [];
    const counts = new Map<number, number>();
    return project.components.flatMap((c) => {
      const number = (counts.get(c.level) ?? 0) + 1;
      counts.set(c.level, number);
      if (!mayCrossLevels(source, c, start.domain)) return [];
      return (trainingRegistry.get(c.typeId)?.ports ?? []).flatMap((p) => {
        if (c.id === source.id) {
          const branch = /^(supply|return)-(\d+)$/.exec(start.id);
          if (!branch || p.id !== (branch[1] === 'supply' ? 'return-' : 'supply-') + branch[2]) return [];
        }
        if (p.domain !== start.domain || !check({ domain: start.domain, from: pending, to: { componentId: c.id, portId: p.id } }).ok) return [];
        return [{ component: c, port: p, number }];
      });
    });
  }, [project.components, check, pending, source, start]);

  const region = useRef<HTMLElement>(null);
  const step = useRef<HTMLParagraphElement>(null);
  const requested = useRef<string | null>(null);
  const lastGuidedPort = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!requested.current) return;
    const target = requested.current;
    requested.current = null;
    const buttons = region.current?.querySelectorAll<HTMLButtonElement>('[data-guide-start]');
    const original = [...(buttons ?? [])].find((button) => button.dataset.guideStart === target && !button.disabled);
    (original ?? step.current)?.focus();
  }, [pending]);

  const available = component ? trainingRegistry.get(component.typeId)?.ports ?? [] : [];
  const sourceIndex = source ? project.components.filter((c) => c.level === source.level).findIndex(({ id }) => id === source.id) + 1 : 0;
  return <section ref={region} className="connection-guide" aria-labelledby="connection-guide-title" onKeyDown={(event) => {
    if (event.key !== 'Escape' || !pending) return;
    requested.current = lastGuidedPort.current ?? 'step';
    event.stopPropagation();
    onCancel();
  }}>
    <header><h2 ref={titleRef} tabIndex={-1} id="connection-guide-title">Соединение элементов</h2><span>1 · Начало / 2 · Назначение</span></header>
    <p ref={step} tabIndex={-1} className="connection-step">{source && start ?
      <>2. Выберите назначение для <strong>№{sourceIndex} {equipmentLabel(source)} · {portLabel(start)}</strong>.</> :
      component ? <>1. Выберите разъём у элемента <strong>{equipmentLabel(component)}</strong>.</> :
        project.components.length ? '1. Выберите оборудование на схеме или в списке.' :
          'Установите оборудование, затем выберите первый разъём.'}</p>
    {!component && !pending && <button type="button" onClick={onMount}>К установке оборудования</button>}
    {!pending && component && <div className="connection-options">
      {!available.length && <p>У этого элемента нет подключаемых разъёмов.</p>}
      {available.map((port) => {
        const why = port.domain === 'control' && port.direction === 'input' ? 'Начинайте с выхода' :
          occupiedWater.has(component.id + ':' + port.id) ? 'Занят' : null;
        const id = component.id + ':' + port.id;
        return <button key={port.id} type="button" disabled={Boolean(why)} data-guide-start={id} onClick={() => {
          lastGuidedPort.current = id;
          requested.current = 'step';
          onPick({ componentId: component.id, portId: port.id });
        }}>{portLabel(port)}<small> · {why ?? (port.domain === 'hydronic' ? 'вода' : 'управление')}</small></button>;
      })}
    </div>}
    {pending && <div className="connection-destinations">
      {targets.length ? <div className="connection-options" aria-label="Совместимые разъёмы">
        {targets.map(({ component: c, port, number }) => <button key={c.id + ':' + port.id} type="button" onClick={() => {
          requested.current = 'step';
          onPick({ componentId: c.id, portId: port.id });
        }}>№{number} {equipmentLabel(c)} · {portLabel(port)}{c.level !== source?.level && <small> · этаж {c.level + 1}</small>}</button>)}
      </div> : <p>{start?.domain === 'control' ? 'Нет свободного входа с таким сигналом.' :
        'Нет свободного совместимого разъёма. Проверьте диаметр, занятость и этаж либо добавьте подходящий элемент.'}</p>}
      <button type="button" onClick={() => { requested.current = lastGuidedPort.current ?? 'step'; onCancel(); }}>Отменить выбор</button>
    </div>}
    <p className="connection-status" role="status">{message}</p>
  </section>;
}
