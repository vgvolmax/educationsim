import { expect, test } from 'vitest';
import { isProductUrl, rendererAsset } from '../../src/desktop/policy';

test('selects only local renderer resources', () => {
  expect(rendererAsset('app://educationsim/')).toBe('index.html');
  expect(rendererAsset('app://educationsim/assets/worker-abc.js?v=1')).toBe('assets/worker-abc.js');
  expect(rendererAsset('app://bad.example/index.html')).toBeNull();
  expect(rendererAsset('app://user@educationsim/index.html')).toBeNull();
  expect(rendererAsset('app://educationsim/..%2fpackage.json')).toBeNull();
  expect(rendererAsset('app://educationsim/%2e%2e%5cpackage.json')).toBeNull();
  expect(rendererAsset('app://educationsim/assets/secret:stream')).toBeNull();
  expect(rendererAsset('app://educationsim/con.js')).toBeNull();
  expect(rendererAsset('app://educationsim/%00')).toBeNull();
  expect(rendererAsset('app://educationsim/%xx')).toBeNull();
});

test('only allows an HTTPS product link on the official catalog host', () => {
  expect(isProductUrl('https://volmax.ru/catalog/pipes/example/')).toBe(true);
  for (const invalid of [
    'https://volmax.ru.evil.example/catalog/a/',
    'https://volmax.ru@evil.example/catalog/a/',
    'https://user@volmax.ru/catalog/a/',
    'https://volmax.ru:444/catalog/a/',
    'http://volmax.ru/catalog/a/',
    'https://volmax.ru/',
    'mailto:sales@volmax.ru',
  ]) expect(isProductUrl(invalid)).toBe(false);
});
