export const appUrl = 'app://educationsim/';

export function rendererAsset(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'app:' || url.host !== 'educationsim' || url.username || url.password) return null;
    if (url.pathname === '/' || url.pathname === '') return 'index.html';

    const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
    // Windows path separators, ADS, reserved dot paths and suffix aliases must not reach fs.
    const device = /^(?:con|prn|aux|nul|(?:com|lpt)[0-9])(?:\.|$)/i;
    return parts.every((part) => /^[a-z0-9_-][a-z0-9._-]*$/i.test(part) &&
      !part.endsWith('.') && !device.test(part))
      ? parts.join('/')
      : null;
  } catch {
    return null;
  }
}

export function isProductUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.host === 'volmax.ru' &&
      !url.username && !url.password && url.pathname.startsWith('/catalog/');
  } catch {
    return false;
  }
}
