import { projectLimits } from './limits';

const maxDepth = 24;
const maxNodes = 300_000;
const reservedKeys = new Set(['__proto__', 'constructor', 'prototype']);
const encoder = new TextEncoder();

export type JsonInputStatus = 'ok' | 'input_too_large' | 'invalid_json_value';

export function fitsJsonBudget(text: string): boolean {
  return text.length <= projectLimits.jsonBytes && encoder.encode(text).byteLength <= projectLimits.jsonBytes;
}

/** JSON imported from disk has no prototypes, executable getters, references or special numbers. */
export function checkJsonValue(input: unknown): JsonInputStatus {
  let nodes = 0;
  let characterLowerBound = 0;
  const ancestors = new WeakSet<object>();

  function inspect(value: unknown, depth: number): JsonInputStatus {
    if (++nodes > maxNodes || depth > maxDepth) return 'input_too_large';
    if (typeof value === 'string') {
      characterLowerBound += value.length;
      return characterLowerBound > projectLimits.jsonBytes ? 'input_too_large' : 'ok';
    }
    if (value === null || typeof value === 'boolean') return 'ok';
    if (typeof value === 'number' && Number.isFinite(value)) return 'ok';
    if (typeof value !== 'object' || ancestors.has(value)) return 'invalid_json_value';
    const array = Array.isArray(value);
    const proto: unknown = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return 'invalid_json_value';
    const keys = Reflect.ownKeys(value);
    if (keys.length > maxNodes - nodes + (array ? 1 : 0)) return 'input_too_large';
    if (array && keys.length !== value.length + 1) return 'invalid_json_value';

    ancestors.add(value);
    try {
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string' || reservedKeys.has(key)) return 'invalid_json_value';
        if (array && (!/^(?:0|[1-9]\d*)$/.test(key) || +key >= value.length)) return 'invalid_json_value';
        characterLowerBound += key.length;
        if (characterLowerBound > projectLimits.jsonBytes) return 'input_too_large';
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return 'invalid_json_value';
        const status = inspect(descriptor.value, depth + 1);
        if (status !== 'ok') return status;
      }
      return 'ok';
    } finally {
      ancestors.delete(value);
    }
  }

  try {
    const status = inspect(input, 0);
    if (status !== 'ok') return status;
    return fitsJsonBudget(JSON.stringify(input)) ? 'ok' : 'input_too_large';
  } catch {
    return 'invalid_json_value';
  }
}
