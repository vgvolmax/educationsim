import { defineConfig } from '@playwright/test';

const webOnly = !process.argv.some((arg) => arg === '--project=desktop');
const url = 'http://127.0.0.1:4173';

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  webServer: webOnly ? { command: 'npm run dev:web -- --host 127.0.0.1 --port 4173 --strictPort', url } : undefined,
  projects: [
    {
      name: 'web',
      testDir: './tests/smoke',
      use: {
        baseURL: url,
        launchOptions: { executablePath: process.env.EDUCATIONSIM_CHROMIUM_PATH },
      },
    },
    { name: 'desktop', testDir: './tests/desktop' },
  ],
});
