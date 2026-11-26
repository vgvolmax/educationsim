import { useId } from 'react';
import type { componentCutaway } from './componentCutaway';

export function CutawayDiagram({ model }: { model: NonNullable<ReturnType<typeof componentCutaway>> }) {
  const id = useId();
  const svgId = id.replaceAll(/[^a-z0-9-]/gi, '');
  const visible = model.paths.slice(0, 8);
  const height = Math.max(100, 26 * visible.length + 30);
  return <svg className="cutaway-diagram" viewBox={'0 0 320 ' + height} role="img" aria-label="Принципиальные внутренние пути">
    <defs><marker id={svgId} markerHeight="5" markerWidth="5" refX="2.5" refY="2.5" orient="auto">
      <path d="M0 0 L5 2.5 L0 5 Z" fill="context-stroke" />
    </marker></defs>
    <rect x="90" y="6" width="140" height={height - 12} rx="12" fill="#e8e5da" stroke="#766e60" />
    {model.separated && <path d={'M160 6 V' + (height - 6)} stroke="#756653" strokeDasharray="2 5" strokeWidth="2" />}
    {visible.map((path, index) => {
      const z = 23 + 26 * index, live = path.lMin !== null, reversed = live && path.lMin! < 0;
      const tone = path.liquid === 'propylene-glycol' ? '#a35135' : '#2c6c73';
      const pathD = 'M' + (reversed ? 290 : 30) + ' ' + z + ' H160 H' + (reversed ? 30 : 290);
      return <g key={path.id}>
        <path d={pathD} stroke={tone} strokeWidth="4" fill="none" opacity={live ? 1 : .45}
          strokeDasharray={live ? undefined : '5 4'} markerMid={path.lMin ? 'url(#' + svgId + ')' : undefined} />
        {path.lMin === 0 && <path d={'M157 ' + (z - 6) + ' v12'} stroke="#6f342a" strokeWidth="4" />}
      </g>;
    })}
    {!visible.length && <text x="160" y="54" textAnchor="middle" fill="#3d403a">Нет привязки</text>}
  </svg>;
}
