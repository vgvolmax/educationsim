# EducationSim

Локальный учебный конструктор водяного тёплого пола для менеджеров Волмакс.

Формат выпуска — ZIP для Windows 11 x64. Менеджер распаковывает архив и открывает `EducationSim.exe`. Каталог, уроки и 3D входят в сборку и доступны офлайн с первого запуска. Проекты сохраняются в профиле Windows и переносятся через JSON.

- [Техническое задание](docs/superpowers/specs/2026-11-26-volmax-educationsim-design.md)
- [План реализации и критерии приёмки](docs/superpowers/plans/2026-11-26-volmax-educationsim-plan.md)
- [Покрытие и применимость ассортимента](docs/superpowers/specs/2026-11-26-volmax-catalog-coverage.md)
- [Реестр технической документации по артикулам](docs/superpowers/specs/2026-11-26-volmax-equipment-documentation.md)

## Разработка

Нужны Node.js из `.node-version` и npm. Установите зависимости через `npm ci`.

- `npm run dev` запускает окно Electron с отдельным профилем `EducationSim-dev`.
- `npm run check` проверяет ESLint, TypeScript, модульные тесты и сборку интерфейса.
- `npx playwright install chromium`, затем `npm run test:e2e` проверяют оболочку в браузере.
- На Windows: `npm run package:win` создаёт ZIP в `out/make`. Распакуйте ZIP целиком; задайте в PowerShell `$env:EDUCATIONSIM_DESKTOP_EXE` абсолютным путём до распакованного `EducationSim.exe` и запустите `npm run test:desktop`. Проверка использует отдельный временный профиль, блокирует HTTP(S) до открытия окна и повторно запускает приложение. Офлайн-приёмка на рабочем ПК остаётся отдельной проверкой выпуска.

A01 содержит только техническую оболочку: редактор и расчёт здесь ещё недоступны. В Windows рабочий профиль сборки находится в `%APPDATA%\EducationSim`, журнал запуска — в `startup.log` этого профиля.
