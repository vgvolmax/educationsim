import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        simulation: fileURLToPath(new URL('./src/worker/client.ts', import.meta.url)),
      },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: ({ name }) => name === 'simulation' ? 'assets/simulation.js' : 'assets/[name]-[hash].js' },
    },
  },
});
