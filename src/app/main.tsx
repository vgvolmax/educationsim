import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './shell.css';

function Shell() {
  const [runtime, setRuntime] = useState('Проверяем локальные ресурсы…');
  useEffect(() => {
    const signal = new AbortController();
    let worker: Worker;
    try {
      worker = new Worker(new URL('./readiness.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setRuntime('Не удалось загрузить локальные ресурсы');
      return;
    }
    const timer = setTimeout(() => {
      signal.abort();
      worker.terminate();
      setRuntime('Не удалось загрузить локальные ресурсы');
    }, 8_000);
    const workerReady = new Promise<void>((resolve, reject) => {
      worker.addEventListener('message', (event) => {
        if (event.data === 'ready') resolve();
        else reject(new Error('Unexpected runtime handshake'));
      }, { once: true });
      worker.addEventListener('error', reject, { once: true });
    });
    const resources = fetch('./runtime.json', { signal: signal.signal }).then(async (response) => {
      if (!response.ok || (await response.json()).format !== 1) throw new Error('Invalid runtime asset');
    });
    void Promise.all([workerReady, resources]).then(() => {
      setRuntime('Автономная среда готова');
    }).catch(() => {
      if (!signal.signal.aborted) setRuntime('Не удалось загрузить локальные ресурсы');
    }).finally(() => {
      clearTimeout(timer);
      worker.terminate();
    });
    return () => { clearTimeout(timer); signal.abort(); worker.terminate(); };
  }, []);

  return (
    <main className="shell">
      <p className="eyebrow">Учебная лаборатория · 01</p>
      <h1>Волмакс · Тёплый пол</h1>
      <p className="intro">Конструктор водяного напольного отопления.</p>
      <div className="actions">
        <button disabled>Новый проект</button>
        <p>В этой технической сборке создание проектов ещё недоступно.</p>
      </div>
      <footer>
        <p role="status">{runtime}</p>
        <a href="https://volmax.ru/catalog/" target="_blank" rel="noreferrer">Каталог ВОЛМАКС ↗</a>
      </footer>
    </main>
  );
}

const mount = document.getElementById('root');
if (!mount) throw new Error('EducationSim renderer mount is missing');
createRoot(mount).render(<Shell />);
