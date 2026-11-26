import { parseRussianDecimal } from '../project/units';
import type { Settings } from '../project/component-types/definitions';

type Parameter = Settings[string];
export const presentNumber = (n: number) => String(n).replace('.', ',');
export const temperatureLabel = (name: string) => name + ', °C';

export function PropertyInput({ name, setting, value }: { name: string; setting: Parameter; value: unknown }) {
  if (setting.type === 'boolean') return <label className="toggle-field">
    <input type="checkbox" name={name} defaultChecked={typeof value === 'boolean' ? value : setting.initial} />{setting.titleRu}
  </label>;
  if (setting.type === 'choice') return <label>{setting.titleRu}<select name={name} defaultValue={typeof value === 'string' ? value : setting.initial}>
    {setting.choices.map((choice) => <option key={choice}>{choice}</option>)}</select></label>;
  return <label>{setting.titleRu}, {setting.unit}<input inputMode="decimal" name={name}
    defaultValue={presentNumber(typeof value === 'number' ? value : setting.initial)} />
    <small>От {presentNumber(setting.min)} до {presentNumber(setting.max)}</small>
  </label>;
}

export function readProperty(data: FormData, name: string, setting: Parameter): string | number | boolean | null {
  if (setting.type === 'boolean') return data.has(name);
  const value = data.get(name);
  if (typeof value !== 'string') return null;
  return setting.type === 'number' ? parseRussianDecimal(value) : value;
}
