import messages from '../../content/explanations/ru.json';
import type { Diagnostic } from '../project/types';

export type EvidenceState = 'active' | 'insufficient' | 'protected' | 'off' | 'stopped' | 'restricted' | 'training';
export type EvidenceTarget = { kind: 'link' | 'component' | 'channel' | 'domain'; id: string };
export type Reading = { status: 'measured'; value: number; unit: 'л/мин' | 'Па' | 'Вт'; tick: number }
  | { status: 'unavailable'; lastConfirmedTick: number | null };
export type Explanation = { code: string; state: EvidenceState; cause: string; action: string; reading?: Reading; target?: EvidenceTarget };
type MessageKey = keyof typeof messages;

export function explanation(code: string, state: EvidenceState, metadata: Pick<Explanation, 'target' | 'reading'> = {},
  original?: string): Explanation {
  const known = Object.hasOwn(messages, code) ? messages[code as MessageKey] : null;
  return { code, state, cause: known?.[0] ?? (original || messages.fallback[0]!), action: (known ?? messages.fallback)[1]!, ...metadata };
}

export function fromDiagnostic(d: Diagnostic, stopped: boolean): Explanation {
  const target: EvidenceTarget | undefined = d.componentId ? { kind: 'component', id: d.componentId } :
    d.path.startsWith('domain:') ? { kind: 'domain', id: d.path.replace(/\.pressure$/, '') } : undefined;
  const state = stopped ? 'stopped' : d.code === 'limiter_sensor_unavailable' ? 'protected' :
    d.code.startsWith('relief_') ? 'restricted' : 'insufficient';
  return explanation(d.code, state, { target }, d.message);
}
