import { portLabel } from './portLabel';
import { checkConnection } from '../project/topology';
import { trainingRegistry } from '../project/registry';
import type { ComponentInstance, PortEndpoint, ProjectDocument } from '../project/types';

export function PortInspector({ project, component, pending, onPick }: { project: ProjectDocument; component: ComponentInstance;
  pending: PortEndpoint | null; onPick(id: string): void }) {
  const ports = trainingRegistry.get(component.typeId)?.ports ?? [];
  return <div className="ports">
    <h2>Подключения</h2>
    {!ports.length && <p>У компонента нет подключаемых портов.</p>}
    {ports.map((port) => {
      const active = pending?.componentId === component.id && pending.portId === port.id;
      const compatibility = pending && !active ? checkConnection(project,
        { domain: port.domain, from: pending, to: { componentId: component.id, portId: port.id } }, trainingRegistry) : null;
      return <div key={port.id} className="port-entry">
        <button aria-pressed={active} onClick={() => onPick(port.id)}>{portLabel(port)}</button>
        <small>{port.domain === 'hydronic' ? port.connector.family === 'tube' ? port.connector.diameterMm + ' мм'
          : port.connector.profile + ' ' + port.connector.size : 'Управление'}
        {compatibility && (compatibility.ok ? ' · совместим' : ' · соединение недоступно')}</small>
      </div>;
    })}
  </div>;
}
