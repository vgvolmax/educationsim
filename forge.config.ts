import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

export default {
  packagerConfig: { asar: true, executableName: 'EducationSim' },
  makers: [new MakerZIP({}, ['win32'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/desktop/main.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/desktop/workspace-preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.config.mts' }],
    }),
  ],
} satisfies ForgeConfig;
