# Волмакс · Пошаговый план реализации EducationSim 1.0

> Для исполнителей: выполняйте задачи по порядку зависимостей. Каждый шаг отмечайте `[x]` после проверки и сохраняйте результат отдельным коммитом в рабочей ветке. Для автономного выполнения подходят `superpowers:executing-plans` или `superpowers:subagent-driven-development`.

**Цель.** Выпустить локальный конструктор водяного тёплого пола для Windows 11 x64 с типизированным монтажом, 3D и 2D, расчётом, отказами, уроками и каталогом ВОЛМАКС. Первый проверяемый результат — расчётный стенд A01–B08 с двумя параллельными петлями. Первый полный сценарий пользователя собирается после него в C02–D04.

**Архитектура.** UI отправляет команды редактирования проекту и команды запуска в Worker. Детерминированная модель выдаёт снимки и события, которые используют и 3D-сцена, и 2D, и журнал, и проверка уроков. Версионированный каталог и проект независимо проходят проверку данных.

**Стек.** Electron, Electron Forge, React, TypeScript strict, Vite, npm, Three.js, IndexedDB, Web Worker, Vitest, Playwright, GitHub Actions.

**ТЗ.** [Конструктор водяного тёплого пола](../specs/2026-11-26-volmax-educationsim-design.md). Стартовая точка — актуальный `main` после слияния ТЗ и аудита. Проект приложения создаётся в A01. [Матрица каталога и проверенные примеры](../specs/2026-11-26-volmax-catalog-coverage.md) входит в условия E01–E02 и G02.

## Условия выполнения

- Сценарии, критерии R01–R19, числовые проверки V01–V12 и уроки L01–L15 заданы в ТЗ. При изменении контракта в одном PR обновляются ТЗ, план, импортер и проверка совместимости.
- Единицы ядра: м, с, кг, Па, Вт, Дж, °C, м³/с. Шаг модели — 1 с и не зависит от кадров. Большой эталон — 12 помещений, 48 петель, 6 групп, 220 элементов, 400 связей, до 3 уровней.
- Расчёт выполняется без DOM, Three.js, сетевого доступа и недетерминированного времени. Исполняемые зависимости фиксируются lockfile. Русские подписи и клавиатурные действия проверяются в связанных интерфейсах.
- Тесты каждого этапа сначала фиксируют ожидаемый результат и воспроизводят отсутствие нужного поведения, после реализации проходят. При первом запуске на пустом проекте создание runner входит в A01. Имена тестов в плане — уникальные маркеры сценариев.
- Команды после A01: `npm run test -- <path>` для Vitest, `npm run test:e2e -- <path>` для Playwright. Для интеграционного среза `npm run check` объединяет линтер, типы, unit и build. `npm run package:win` формирует ZIP Windows x64 на Windows-исполнителе, `npm run test:desktop` проверяет распакованную сборку. Если часть UI-тестов использует отдельный Chromium Playwright, он ставится только в среде разработки и CI.
- Каждый пункт теста считается выполненным при зелёном результате указанной команды. Затем запускается `git diff --check`, фиксируются название коммита, команда, результат и смена статуса этапа. GitHub PR для ПО открывается по этапу, проверяемые шаги внутри задачи можно включать в её коммит.

## Контракты между этапами

| Файл | Ответственность и интерфейс |
|---|---|
| `src/project/types.ts` | `ProjectDocument`, `ProjectCommand`, `ComponentType`, `ComponentInstance`, `PortDefinition`, `HydronicLink`, `ControlLink`, `Diagnostic`, `CatalogParameterSnapshot`. Команды типизированы дискриминатором `kind`. |
| `src/project/document.ts` | `parseProject(input: unknown): Result<ProjectDocument>`, `migrateProject(input: unknown): Result<ProjectDocument>`. `Result<T>` хранит значение или непустой список `Diagnostic`. Предупреждения возможны при успехе. |
| `src/project/reducer.ts` | `applyProjectCommand(project: ProjectDocument, command: ProjectCommand, registry: ComponentRegistry): Result<ProjectDocument>`. Команда изменяет ровно одну ревизию, вся операция применима целиком. |
| `src/project/topology.ts` | `checkConnection(project: ProjectDocument, candidate: LinkCandidate, registry: ComponentRegistry): ConnectionDecision`, `validateTopology(project: ProjectDocument, registry: ComponentRegistry): Diagnostic[]`. |
| `src/project/routing.ts` | `planLoop(input: LoopRouteInput): Result<LoopRoute>`, `measureRoute(points: readonly Point3[]): number`. Результат включает длину, тип и предупреждения. |
| `src/catalog/catalog.ts` | `parseCatalog(input: unknown): Result<CatalogRelease>` и `resolveComponent(product: CatalogProduct, registry: ComponentRegistry): Result<CatalogParameterSnapshot>`. `CatalogRelease` содержит `products`, `offers`, `bundles`. `expandBundle(bundleId: string, release: CatalogRelease): Result<BundleContents>` сохраняет количества и ссылки на инженерные позиции. |
| `src/simulation/compile.ts` | `compileProject(project: ProjectDocument, registry: ComponentRegistry): Result<CompiledSystem>`. Компиляция хранит ссылку из каждого расчётного канала на исходный элемент. |
| `src/simulation/types.ts` | `CompiledSystem`, `SimulationState`, `SimulationCommand`, `SimulationSnapshot`, `SimulationEvent`. Снимок: `projectRevision`, `tick`, `state`, измерения по ID, предупреждения и происхождение. |
| `src/simulation/engine.ts` | `startSimulation(system: CompiledSystem): Result<SimulationState>`, `advanceTick(state: SimulationState, commands: readonly SimulationCommand[]): Result<SimulationState>`, `getSnapshot(state: SimulationState): SimulationSnapshot`. |
| `src/simulation/comparison.ts` | `compareRuns(a: RunEvidence, b: RunEvidence): ComparisonResult`. `RunEvidence` включает `runId`, ревизию, версии, исходный проект, `tick` и снимок. Сравнение метрик и состава не меняет исходные прогоны. |
| `src/worker/protocol.ts` | `WorkerRequest` с `requestId`, `sessionId`, `projectRevision`. Методы `load`, `start`, `pause`, `step`, `command`, `setSpeed`, `reset`, `dispose`. Для ответа — `ack`, `snapshot`, `diagnostics`, `error`. |
| `src/storage/projects.ts` | `saveProject(doc: ProjectDocument, expectedRevision: number \| null): Promise<SaveOutcome>`, `loadProject(id: string): Promise<Result<ProjectDocument>>`, `listProjects(): Promise<ProjectSummary[]>`. `null` означает создание нового ID. |
| `src/lessons/lesson.ts` | `parseLesson(input: unknown): Result<LessonDefinition>`, `evaluateLesson(lesson: LessonDefinition, evidence: LessonEvidence): LessonProgress`. Критерии декларативны и работают по снимкам, командам и структурированному ответу. Для свободного ответа есть рубрика разбора наставником. |

## Особые проверки перед выпуском

| Условие | Где проверяется |
|---|---|
| Переименование, замена на модель с меньшим числом портов, удаление и отмена во время редактирования. | A03, D02 и G01. |
| Замкнутый остров без рабочего насоса, заблокированный обратный клапан, нулевой поток и несходимость. | B01–B03, C03 и G01. |
| Пустой/будущий/испорченный JSON, неизвестный товар, конфликт ревизий и исчерпание квоты. | A02, E03 и G01. |
| Источник с горячей подачей, защита отключает насос, прерванный прогон и воспроизведение событий. | B06–B08, F02 и G01. |
| Устаревший пакет данных, расхождение комплектации «Эко», карточка бренда или канала с одноимённым артикулом. | E01, E02 и G02. |
| Повтор сценария без защиты после смены конфигурации, сравнение в один и тот же момент и восстановление двух результатов после импорта. | D03, E03 и G01. |
| Правдоподобная, но неверная продажная рекомендация и успешное выполнение только числового условия кейса. | F01, F02 и G02. |
| Потеря WebGL, неподдерживаемый GPU, свёрнутое окно, запаздавший ответ Worker. | B08, D04 и G01. |
| Холодный запуск офлайн, перенос проекта, обновление и откат с локальным профилем. | A01, E03, G01 и G03. |

## Этап A. Основа проекта и формат схемы

### A01. Настроить рабочую сборку и обязательные проверки

**Файлы:** `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.mts`, `forge.config.ts`, `eslint.config.mjs`, `index.html`, `src/app/main.tsx`, `src/desktop/main.ts`, `tests/smoke/basic.spec.ts`, `tests/desktop/startup.spec.ts`, `.github/workflows/ci.yml`, `README.md`.

- [x] Зафиксировать версии библиотек, поддерживаемую LTS Node и команды `dev`, `lint`, `typecheck`, `test`, `test:e2e`, `build`, `check`, `package:win` и `test:desktop`.
- [x] Создать e2e `opens_education_sim_shell`, который ожидает заголовок «Волмакс · Тёплый пол» и русскую кнопку «Новый проект». На временной пустой странице тест должен падать по заголовку.
- [x] Подключить React и русскую локаль, стабильное имя приложения и origin `app://educationsim/`, изоляцию окна и локальное логирование версии. Настроить один экземпляр на рабочий профиль и отдельные профили для разработки и тестов. Настроить Vite для упаковки ресурсов и Worker. Electron Forge упаковывает ZIP под Windows x64. В CI использовать минимальные разрешения и фиксированные ревизии Actions.
- [x] Запустить `npm ci`, `npm run check` и `npm run test:e2e -- tests/smoke/basic.spec.ts`. На Windows запустить `npm run package:win` и `npm run test:desktop`. Проверить запуск распакованного `EducationSim.exe` при отключённой сети из папки с пробелом и кириллицей. Проверить загрузку локального ресурса через Fetch, старт упакованного Worker и повторное чтение IndexedDB после перезапуска. Проверить отклонение путей за пределы ресурсов и открытие ссылки на товар вне окна приложения по явному действию. Запустить второй экземпляр из другой папки и проверить, что он не открывает профиль параллельно. Зафиксировать `chore: bootstrap EducationSim desktop`.

Подтверждение A01: [PR #5](https://github.com/vgvolmax/educationsim/pull/5), [проверка на Windows и браузерная проверка](https://github.com/vgvolmax/educationsim/actions/runs/45846021520). Целевая Windows 11 и штатный режим без сети остаются проверками этапа G.

### A02. Описать и валидировать версионированный проект

**После:** A01. **Файлы:** `src/project/types.ts`, `src/project/document.ts`, `src/project/units.ts`, `tests/project/document.test.ts`, `tests/fixtures/projects/direct-small.json`.

- [x] Создать `accepts_valid_v1_and_rejects_invalid_graph_document`: новый документ читается, чужие версии, дубликаты ID, нечисловые параметры, недопустимый размер и висящие ссылки дают конкретные диагностики.
- [x] Реализовать DTO, схемы и преобразования для русских десятичных чисел и отображаемых единиц. Добавить валидную фикстуру из одной комнаты и двух петель. Внутренние идентификаторы не содержат ярлыков интерфейса.
- [x] Запустить `npm run test -- tests/project/document.test.ts`. Проверить, что парсер не мутирует передаваемый объект. Зафиксировать `feat: define project document and units`.

Подтверждение A02: [PR #6](https://github.com/vgvolmax/educationsim/pull/6), [проверки браузера и Windows](https://github.com/vgvolmax/educationsim/actions/runs/45846906931).

### A03. Реализовать редакторские команды, порты и правила связей

**После:** A02. **Файлы:** `src/project/reducer.ts`, `src/project/topology.ts`, `src/project/registry.ts`, `src/project/history.ts`, `tests/project/topology.test.ts`, `tests/project/reducer.test.ts`.

- [x] Написать `rejects_incompatible_ports_and_exposes_adapter_need`, `delete_disconnects_owned_links`, `replacement_preserves_only_compatible_links`, `undo_restores_graph_snapshot`. Проверить выведенный план изменений до принятия команды замены.
- [x] Создать первичный реестр типов, проверки доменов и присоединения, редьюсер команд, историю. Удаление убирает связи. Замена сохраняет только доказуемо совместимые связи. Серия правок применяется атомарно. Диагностика сохраняет ID порта.
- [x] Запустить `npm run test -- tests/project/topology.test.ts tests/project/reducer.test.ts`. Зафиксировать `feat: add typed connection editor`.

Подтверждение A03: [PR #7](https://github.com/vgvolmax/educationsim/pull/7), [проверка main](https://github.com/vgvolmax/educationsim/actions/runs/45848203497).

### A04. Проверять геометрию комнат и строить трассы

**После:** A02–A03. **Файлы:** `src/project/geometry.ts`, `src/project/routing.ts`, `tests/project/routing.test.ts`, `tests/fixtures/projects/orthogonal-room.json`.

- [x] Написать `both_route_styles_work_in_reference_rectangle`, `l_room_serpentine_respects_zones`, `routes_avoid_keepouts`, `manual_route_requires_explicit_replacement`, `short_radius_and_crossing_are_reported`, `levels_support_riser`, `max_density_request_is_cancellable_and_preserves_route`. Использовать предельную комнату и шаг 50 мм, проверить диагностику бюджета и отсутствие перезаписи принятой трассы.
- [x] Реализовать расчёт простой ортогональной комнаты, вырезов, запретных зон, маршрутов, фактической длины с подводками и переходами уровней. Вынести автопрокладку в Worker и проверять лимиты до расчёта. Игнорировать устаревший результат после отмены или смены ревизии. Для перекрытий и слишком малого радиуса возвращать диагностику с локализацией. Места пересечения шва отмечать защитной гильзой или предупреждением.
- [x] Запустить `npm run test -- tests/project/routing.test.ts`. Зафиксировать `feat: generate and validate floor loop routes`.

[Контракт расчёта трассы](../specs/2026-11-26-routing-contract.md).

Подтверждение A04: [PR #8](https://github.com/vgvolmax/educationsim/pull/8), [браузерная проверка Worker и офлайн-проверка оболочки Windows](https://github.com/vgvolmax/educationsim/actions/runs/45858190457).

## Этап B. Расчётное ядро без UI

### B01. Компилировать проект в сети и тепловые домены

**После:** A03–A04. **Файлы:** `src/simulation/types.ts`, `src/simulation/compile.ts`, `src/simulation/fluids.ts`, `tests/simulation/compile.test.ts`.

- [x] Создать `compiles_two_parallel_loops`, `blocks_open_operating_port`, `isolated_disabled_branch_has_zero_flow`, `heat_exchanger_keeps_fluid_domains_separate`.
- [x] Раскрывать вложенные узлы, каналы, порты и карту происхождения. Назначить опорные узлы, тепловые связи и опорный профиль жидкости. Компилятор отличает блокирующую ошибку от допустимого учебного предупреждения.
- [x] Запустить `npm run test -- tests/simulation/compile.test.ts`. Зафиксировать `feat: compile projects to calculation networks`.

[Контракт расчётной сети](../specs/2026-11-26-simulation-network-contract.md).

Подтверждение B01: [PR #9](https://github.com/vgvolmax/educationsim/pull/9), [проверки браузера и Windows](https://github.com/vgvolmax/educationsim/actions/runs/45859149024).

### B02. Рассчитать гидравлическую сеть и рабочую точку насоса

**После:** B01. **Файлы:** `src/simulation/hydraulics.ts`, `src/simulation/pump.ts`, `src/simulation/resistance.ts`, `tests/simulation/hydraulics.test.ts`.

- [ ] Добавить `parallel_equal_and_unequal_match_v01_v02`, `pump_intersection_matches_closed_form`, `node_balance_matches_v09`, `disconnected_loop_has_no_forced_flow`, `v10_pump_saturates_at_2_lpm_and_20_kpa`, `v10_closed_network_keeps_shutoff_head`, `v10_off_pump_allows_only_compatible_passive_flow`.
- [ ] Реализовать `solveHydraulics(system: CompiledSystem, inputs: HydraulicInputs): Result<HydraulicSnapshot>`. Использовать баланс потоков и уравнения потерь, сохранять профиль сопротивления, рабочую точку и направление потока. Использовать p + ρgz для учёта высоты в контуре. Учитывать насыщение при постоянном перепаде, пассивное сопротивление остановленного насоса и закрытие внутреннего обратного клапана. Ограничить итерации и области использования кривых.
- [ ] Запустить `npm run test -- tests/simulation/hydraulics.test.ts`. Зафиксировать `feat: solve hydronic network and pump operating point`.

[Контракт решателя давления и расхода](../specs/2026-11-26-hydraulic-solver-contract.md).

### B03. Добавить направленные клапаны, балансировку и байпас

**После:** B02. **Файлы:** `src/simulation/valves.ts`, `src/simulation/hydraulics.ts`, `tests/simulation/valves.test.ts`.

- [ ] Создать `check_valve_blocks_reverse_flow`, `bypass_only_opens_above_threshold`, `zero_flow_when_closed`, `dynamic_regulator_respects_working_range`, `nonconverging_network_returns_diagnostic`.
- [ ] Подключить модели клапанов: запорный, балансировочный, зональный, обратный, перепускной, двух-/трёхходовой и ограничитель расхода. У сетки фильтра задавать рост сопротивления. Перепуск учитывать как новый активный путь в той же сети.
- [ ] Запустить `npm run test -- tests/simulation/hydraulics.test.ts tests/simulation/valves.test.ts`. Зафиксировать `feat: model regulation and flow protection`.

### B04. Рассчитать перенос тепла и смешение

**После:** B02–B03. **Файлы:** `src/simulation/heat-transfer.ts`, `src/simulation/mixing.ts`, `src/simulation/storage-tank.ts`, `tests/simulation/heat-transfer.test.ts`.

- [ ] Зафиксировать `mixture_is_35c_in_v03`, `loop_emits_348w_in_v04`, `zero_flow_stops_advective_heat_but_allows_residual_heat`, `exchanger_conserves_heat_with_isolated_fluids`, `buffer_accumulates_and_loses_heat`, `global_energy_ledger_matches_v09`. Проверить, что внутренний перенос взаимно компенсируется, источнику, наружным потерям, подпитке и сбросу соответствуют отдельные члены баланса.
- [ ] Реализовать `advanceFluidTemperatures(input: FluidThermalInput): Result<FluidThermalState>`, смешение по энтальпии, потерю наружу, модель радиатора, буфер, гидрострелку, тепловую связь двух сторон теплообменника.
- [ ] Запустить `npm run test -- tests/simulation/heat-transfer.test.ts`. Зафиксировать `feat: simulate heat and mixing`.

### B05. Рассчитать пол, комнату и климат

**После:** A04, B04. **Файлы:** `src/simulation/floor.ts`, `src/simulation/room.ts`, `src/simulation/climate.ts`, `tests/simulation/room.test.ts`.

- [ ] Добавить `unheated_room_matches_exponential_v05`, `dry_and_wet_floor_have_different_inertia`, `higher_outdoor_loss_changes_room_temperature`, `surface_limit_is_distinct_from_water_temperature`.
- [ ] Моделировать секции пола с массой и теплопотерями вверх/вниз. Для комнаты учитывать UA ограждений, вентиляцию и теплопередачу от пола и радиатора. На выходе выдавать температуры воды, массы, поверхности и воздуха по отдельности.
- [ ] Запустить `npm run test -- tests/simulation/room.test.ts`. Зафиксировать `feat: add room and floor thermal response`.

### B06. Реализовать датчики, автоматику, термостаты и источники

**После:** B03–B05. **Файлы:** `src/simulation/controls.ts`, `src/simulation/sources.ts`, `tests/simulation/controls.test.ts`.

- [ ] Написать `one_thermostat_drives_two_loops`, `floor_limit_keeps_air_setpoint`, `rtl_uses_return_sensor`, `power_loss_respects_nc_no_and_travel`, `heat_pump_reports_minimum_flow`, `weather_curve_respects_source_limit`, `wiring_exposes_multiple_writers_and_zero_delay_loop`, `v12_connected_limiter_overrides_manual_and_demand`, `v12_disconnected_limiter_does_not_claim_protection`, `sensor_failure_and_reset_follow_profile`.
- [ ] Добавить граф управления, уставки, гистерезис и задержки. Датчик считывает прошлый снимок, привод применяет команду по своему графику. Различать запрос, наличие источника, разрешение и фактическое исполнение. При нескольких источниках сигнала требовать явный логический блок. Эталонную команду перегрева подать одновременно с ручным запросом и проверить приоритет только на подключённом приводе.
- [ ] Запустить `npm run test -- tests/simulation/controls.test.ts`. Зафиксировать `feat: add heat sources and zone controls`.

### B07. Моделировать защиту, давление, сервис и отказ

**После:** B02–B06. **Файлы:** `src/simulation/pressure.ts`, `src/simulation/service.ts`, `src/simulation/faults.ts`, `tests/simulation/pressure.test.ts`, `tests/simulation/faults.test.ts`.

- [ ] Добавить `tank_matches_v06`, `relief_event_tracks_lost_water`, `missing_tank_reaches_model_boundary`, `high_limit_disables_target_next_tick`, `trapped_air_and_dirty_filter_recover_after_service`, `service_energy_and_mass_ledger_closes`, `no_numeric_pressure_after_model_boundary`, `latched_limit_requires_reset_after_condition_clears`.
- [ ] Реализовать расчёт давления с баком и границы применимости. Добавить переполнение, сброс, заполнение, воздух, засор и отказ датчика/привода. Критические события переводят состояние в ограниченный режим или останавливают прогон с диагностикой.
- [ ] Запустить `npm run test -- tests/simulation/pressure.test.ts tests/simulation/faults.test.ts`. Зафиксировать `feat: simulate hydronic safety and service faults`.

### B08. Собрать Engine, повтор записей и Worker

**После:** B01–B07. **Файлы:** `src/simulation/engine.ts`, `src/simulation/replay.ts`, `src/worker/protocol.ts`, `src/worker/simulation.worker.ts`, `src/worker/client.ts`, `tests/simulation/engine.test.ts`, `tests/worker/protocol.test.ts`.

- [ ] Написать `replay_matches_v08`, `tick_equals_one_second_at_any_speed`, `paused_state_does_not_advance`, `drops_stale_revision_snapshot`, `worker_reports_stall_without_faking_sim_time`.
- [ ] Объединить предыдущие модели в один фиксированный порядок тика. Запись содержит исходное состояние и команды. При сворачивании окна и падении Worker фиксировать паузу/последнее состояние. Максимум буфера снимков определяется лимитами графиков и записи в ТЗ.
- [ ] Запустить `npm run test -- tests/simulation tests/worker`. Зафиксировать `feat: integrate deterministic engine and simulation worker`.

**Проверяемый результат этапов A+B:** расчёт нескольких параллельных ветвей, температуры, действий автоматики и отказов запускается в тестовом стенде без браузера. V01–V10 и V12 проходят. V11 проверяется на контрольной схеме взаимодействия насосов в C02 и на сравнении скоростей и направлений анимации в D04. Числовые допуски подтверждаются техническим экспертом до приёмки учебного контента.

## Этап C. Эталонные схемы и покрытие оборудования

### C01. Оформить реестр проектных типов и модели подключения

**После:** A03, B01–B07. **Файлы:** `src/project/registry.ts`, `src/project/component-types/`, `content/equipment/families.json`, `tests/project/equipment-coverage.test.ts`.

- [ ] Создать `every_required_family_has_ports_parameters_and_outputs` по всем строкам таблицы оборудования в ТЗ. Для декоративных/монтажных компонентов ожидаются габариты или правила укладки, для приборов — измерение, для управляемых устройств — команды и индикатор.
- [ ] Добавить реестр конкретных типов, политику диапазонов, порты, внутренние схемы для составных изделий и данные о режиме монтажа. Составной объект должен использовать существующие расчётные модели.
- [ ] Запустить `npm run test -- tests/project/equipment-coverage.test.ts`. Зафиксировать `feat: complete the equipment and materials registry`.

### C02. Подготовить и рано сверить все стартовые шаблоны

**После:** B08, C01. **Файлы:** `content/templates/`, `src/project/templates.ts`, `tests/fixtures/projects/benchmark-large.json`, `tests/project/templates.test.ts`.

- [ ] Добавить `all_six_templates_run`, `template_clone_keeps_graph_references`, `benchmark_fixture_reaches_supported_scale`.
- [ ] Создать 6 схем R03 и нагруженную фикстуру. Прогнать каждую с сохранёнными входными условиями и эталонным снимком, по детерминированным исходным данным. Для V11/L10 зафиксировать знак расхода и изменение взаимодействия насосов на схеме с разделителем. Проверять их тестом `separator_reduces_pump_interference_and_preserves_flow_direction`.
- [ ] До закрепления редактора и уроков сверить с техническим специалистом входы и результаты шести схем, модель в пределах V01–V12 и предупреждения по неподдерживаемым режимам. Сохранить вопросы и результат ранней проверки в `docs/qa/engineering-baseline.md`. Если эксперт ещё не назначен, работы по оболочке идут параллельно, а герметичность, режимы защит и смысл L06/L10/L11 остаются на проверке до фиксации учебного контента.
- [ ] Запустить `npm run test -- tests/project/templates.test.ts`. Зафиксировать `feat: supply runnable example installations`.

### C03. Подготовить формализованные причины и границы эксперимента

**После:** B08, C02. **Файлы:** `src/simulation/diagnostics.ts`, `src/simulation/evidence.ts`, `content/explanations/ru.json`, `tests/simulation/diagnostics.test.ts`.

- [ ] Создать `stopped_branch_has_explanation_not_stale_values`, `fault_message_contains_cause_reading_action`, `missing_data_is_distinct_from_valid_zero`.
- [ ] Привязать сообщения к кодам диагностики и показаниям. Добавить состояния «данных недостаточно», «защита сработала», «контур отключён», «модель остановлена», «учебный параметр» и ссылки на элементы схемы.
- [ ] Запустить `npm run test -- tests/simulation/diagnostics.test.ts`. Зафиксировать `feat: explain operating states and faults`.

## Этап D. Рабочий конструктор и визуализация

### D01. Подключить навигацию, проект и 2D-редактор

**После:** A04, C02. **Файлы:** `src/app/App.tsx`, `src/editor/Editor.tsx`, `src/editor/useProject.ts`, `src/views/schematic/Schematic.tsx`, `tests/e2e/editor.spec.ts`.

- [ ] Добавить `opens_template_and_edits_connected_graph`, `builds_room_from_empty_project`, `keyboard_can_select_connect_and_undo`.
- [ ] Связать стартовый экран, 2D-слои, комнаты, порты, монтаж, сообщения валидации и историю. Поля размера изменяют рабочую геометрию после принятия команды. Ошибка ввода остаётся локальной.
- [ ] Запустить `npm run test:e2e -- tests/e2e/editor.spec.ts`. Зафиксировать `feat: build the accessible schematic editor`.

### D02. Сделать интерактивные инструменты и инспектор

**После:** C01, D01. **Файлы:** `src/editor/Inspector.tsx`, `src/editor/RouteTools.tsx`, `src/editor/PortInspector.tsx`, `src/editor/PropertyInput.tsx`, `tests/e2e/inspector.spec.ts`.

- [ ] Добавить `accepts_decimal_comma_and_validates_limits`, `replace_preview_shows_removed_ports`, `remove_is_different_from_bypass_with_pipe`, `dead_end_protection_can_be_removed_with_explicit_cap`, `start_values_differ_from_live_temperature`.
- [ ] Сделать фильтрацию параметров по типу и режиму, органы управления клавиатурой/указателем, редактирование укладки, переключение уровня и подбор совместимого порта. Отобразить параметры изделия и отдельный произвольный учебный экземпляр.
- [ ] Запустить `npm run test:e2e -- tests/e2e/inspector.spec.ts`. Зафиксировать `feat: expose equipment and room controls`.

### D03. Подключить прогон, диагностику, графики и А/Б

**После:** B08, C03, D02. **Файлы:** `src/editor/SimulationPanel.tsx`, `src/views/measurements/`, `src/views/graph/`, `src/simulation/comparison.ts`, `tests/simulation/comparison.test.ts`, `tests/e2e/simulation.spec.ts`.

- [ ] Проверить `play_pause_step_speed_and_reset`, `compare_before_after_balance`, `compare_two_revisions_at_same_elapsed_time_and_show_removed_device`, `protective_event_points_to_device`, `live_command_at_next_tick_changes_real_meter`.
- [ ] Реализовать таймлайн, окно измерений, шкалы, сравнение, журнал и переход к детали по событию. Связать с Worker и задавать состояние показа неизменяемыми снимками. Показывать несовпадение начальных условий или времени, при смене ревизии сохранять исходный прогон и привязку к ID. Проверить, что после замены защиты результат обоих прогонов доступен без обращения к текущему каталогу.
- [ ] Запустить `npm run test -- tests/simulation/comparison.test.ts` и `npm run test:e2e -- tests/e2e/simulation.spec.ts`. Зафиксировать `feat: show calculated live measurements and comparisons`.

### D04. Визуализировать проект и теплоноситель в Three.js

**После:** D01–D03. **Файлы:** `src/views/scene/Scene.tsx`, `src/views/scene/buildScene.ts`, `src/views/scene/createEquipment.ts`, `src/views/scene/flow.ts`, `src/views/scene/heatMap.ts`, `src/views/scene/componentCutaway.ts`, `tests/views/scene-data.test.ts`, `tests/e2e/scene.spec.ts`.

- [ ] Написать `scene_and_2d_share_selection`, `particle_direction_tracks_flow_sign`, `same_flow_two_diameters_obey_v11`, `cutaway_tracks_actual_port_flow_and_valve_position`, `exchanger_cutaway_has_separated_liquids`, `heat_map_distinguishes_surface_from_coolant`, `context_loss_switches_to_2d_without_losing_project`.
- [ ] Реализовать схематичные 3D-компоненты всей матрицы C01, трубопроводы, разрез пола, камеру, выбор, режим снижения движения, потоки на базе подписанной скорости Q/A и направление по её знаку. Приборы читают расход в л/мин независимо от ускорения анимации. Для восьми ключевых устройств из R04 добавить режим «Как работает» с условным разрезом и внутренними каналами на том же снимке. При наличии концевой обвязки в комплекте выделять её из карточки состава. Привязать манипуляции рукояток к тем же командам, что и инспектор. Для падения WebGL сохранить 2D и доступ к данным.
- [ ] Запустить `npm run test -- tests/views/scene-data.test.ts` и `npm run test:e2e -- tests/e2e/scene.spec.ts`. Зафиксировать `feat: render interactive hydronic systems in Three.js`.

**Проверяемый результат этапов C+D:** менеджер собирает редактируемый проект с нуля и запускает его. При закрытии или настройке клапана измерения, цвет труб, направление движения, температура пола и журнал согласованы. 2D остаётся полноценным входом в симулятор.

## Этап E. Каталог и сохранение

### E01. Валидировать, сопоставлять и версионировать позиции

**После:** A02, C01. **Файлы:** `src/catalog/catalog.ts`, `src/catalog/import.ts`, `scripts/validate-catalog.ts`, `content/catalog/public-v1.json`, `tests/catalog/import.test.ts`.

- [ ] Написать `duplicates_rejected_by_namespace`, `unverified_curve_cannot_be_datasheet`, `archive_resolves_saved_snapshot`, `csv_row_errors_visible_without_partial_activation`, `bundle_quantities_match_all_21_published_bills`, `conflicting_category_text_stays_flagged_while_card_composition_is_displayed`, `same_pump_length_without_other_compatibility_is_not_enough`, `raw_offer_without_article_stays_visible_but_cannot_be_recommended`, `applies_all_224_review_rows_by_offer_id`, `g1494_and_g1495_do_not_share_rtl_profile`, `unverified_g1495_cannot_fill_rtl_slot`, `held_and_excluded_offers_are_never_auto_selected`, `datasheet_evidence_alone_does_not_enable_recommendation`, `unmatched_offer_can_open_separate_teaching_analogue`, `confirmed_offer_with_compatible_profile_is_recommendable`.
- [ ] Реализовать нормализацию импорта CSV/JSON, сопоставление типа и артикула, происхождение параметров, шкалы, профиль портов, указание версии. Проверять публичный пакет в CI. Импортировать проверяемый публичный снимок и отдельно список состава 21 комплекта. Сырой импорт допускает пустые `article` и `brand` при сохранённом `offer_id`. Публикация инженерной карточки и рекомендация проверяются отдельно. Обработать `offer_id` как ключ карточки, а `article` как опубликованный артикул. Наложить [решения по 224 карточкам](../specs/volmax-site-applicability-2026-11-26.csv) на `check_application` по `offer_id`, подтвердить соответствие артикулу и URL. Проверить 208 ролей, 9 исключений, 7 отложенных карточек и независимые условия `sales_gate`. Для рабочего пакета сохранять `componentTypeId` и закрытый набор `allowedContexts` по R17, а исходные текстовые пояснения отображать отдельно. Подтверждённый профиль использовать в проверке подключения. Неподтверждённую позицию оставить справочной с переходом к учебному аналогу. Добавить положительную фикстуру подтверждённого предложения и отрицательные случаи ликвидации или неполного профиля даже при наличии документа об области применения. Позиции без полного паспортного профиля допускаются в учебный просмотр по уровню доказательства. Для пакета данных проверять ключи `channel + offerId`, периферийные ссылки, единицы комплектации, комплектацию по конкретным SKU, циклы и дубли в составе. Помечать, какие данные пришли с карточки, из паспорта и из учебной модели. До выпуска сверить сопоставление с актуальным снимком volmax.ru и паспортами. Если подключаются другие каналы, проверить их выгрузки отдельно.
- [ ] Запустить `npm run test -- tests/catalog/import.test.ts` и `npm run catalog:validate -- content/catalog/public-v1.json`. Зафиксировать `feat: validate versioned Volmax catalog packages`.

### E02. Встроить каталог в рабочий монтаж и замену

**После:** D02, E01. **Файлы:** `src/catalog/CatalogPanel.tsx`, `src/catalog/CompatibilityPreview.tsx`, `src/catalog/useCatalog.ts`, `tests/e2e/catalog.spec.ts`.

- [ ] Сценарии `searches_by_product_or_shop_sku`, `catalog_component_places_and_runs`, `generic_value_has_visible_provenance`, `new_profile_does_not_change_existing_project`, `bundle_distinguishes_included_separate_and_already_fitted`, `ambiguous_bundle_shows_source_and_requires_sales_confirmation`, `radiator_valve_is_blocked_in_floor_loop`, `radiator_valve_connects_in_radiator_branch`, `mounting_label_does_not_create_hydraulic_channel`, `archived_or_unverified_sku_is_not_recommended`, `catalog_uses_bundled_release_on_first_start`, `local_catalog_update_is_atomic_and_survives_restart`.
- [ ] Подключить встроенный каталог, фильтры, карточки, локальные ассеты и паспортные данные. Реализовать выбор файла обновления, проверку, предпросмотр версии и атомарную активацию в профиле Windows. Сохранённые снимки оборудования меняются только по явному подтверждению в проекте. Разворачивать набор в позиции и количество, отмечать уже входящую обвязку, показывать отдельно недостающие части текущей схемы. Не пробрасывать коммерческие и персональные поля в публичный артефакт.
- [ ] Запустить `npm run test:e2e -- tests/e2e/catalog.spec.ts`. Зафиксировать `feat: connect Volmax products to the constructor`.

### E03. Сохранять проекты, сравнения и переносить записи

**После:** A02–A03, D03, E01. **Файлы:** `src/storage/projects.ts`, `src/storage/project-transfer.ts`, `src/storage/useAutosave.ts`, `tests/storage/projects.test.ts`, `tests/e2e/persistence.spec.ts`.

- [ ] Написать `restart_reopens_last_committed_revision`, `concurrent_revisions_do_not_overwrite`, `corrupt_future_and_oversized_imports_leave_open_project`, `quota_failure_offers_export`, `project_n_minus_one_migrates_with_backup`, `snapshot_and_replay_round_trip`, `export_import_preserves_two_revisions_and_run_results`, `close_flushes_pending_autosave`, `failed_close_save_offers_retry_or_export`.
- [ ] Реализовать IndexedDB с постоянным хранилищем профиля Windows, атомарную запись с проверкой ревизии, автосохранение через 500 мс, запись при закрытии и восстановление после сбоя. Проверять версию профиля до открытия хранилища и сохранять резервную копию перед миграцией. Подключить локальный выбор файла импорта и сохранение экспорта через ограниченный интерфейс оболочки. Экспортировать определения и записи как JSON с версиями и снимками. Восстанавливать после конфликтов через управляемое создание копии. Блокировать повторный импорт того же файла поверх текущей версии до явного выбора.
- [ ] Запустить `npm run test -- tests/storage/projects.test.ts` и `npm run test:e2e -- tests/e2e/persistence.spec.ts`. Зафиксировать `feat: save projects and export reproducible experiments`.

## Этап F. Учебный комплект

### F01. Сделать движок уроков и интерфейс наставника

**После:** B08, D03, E03. **Файлы:** `src/lessons/lesson.ts`, `src/lessons/LessonPanel.tsx`, `src/lessons/authoring.ts`, `tests/lessons/lesson.test.ts`, `tests/e2e/lessons.spec.ts`.

- [ ] Добавить `criterion_uses_calculated_value`, `locked_action_stays_in_lesson_scope`, `free_copy_unlocks_controls`, `retry_restores_seeded_project`, `invalid_rule_has_author_diagnostic`, `right_component_for_wrong_reason_is_partial`, `working_but_redundant_purchase_is_rejected_in_challenge`.
- [ ] Реализовать декларативные критерии с ID элементов, числовыми диапазонами и событиями, подсказки, результаты и самостоятельный повтор. Отдельно оценивать уточнение, выбор, объяснение и ограничение, показывать конкретный промах. Экспорт наставнику включает ответ и наблюдения. Автор готовит JSON по опубликованной схеме и запускает локальный предпросмотр. Для 1.0 редактор уроков в отдельном веб-кабинете не нужен.
- [ ] Запустить `npm run test -- tests/lessons` и `npm run test:e2e -- tests/e2e/lessons.spec.ts`. Зафиксировать `feat: deliver interactive training workflows`.

### F02. Написать, проверить и локализовать 15 уроков

**После:** C02–C03, D04, E02, F01. **Файлы:** `content/lessons/L01.json`…`content/lessons/L15.json`, `content/lessons/evidence/`, `tests/lessons/pack.test.ts`, `tests/e2e/core-lessons.spec.ts`.

- [ ] Создать `all_lesson_definitions_validate_and_reference_known_components` и эталонные записи успешных и как минимум одного типового неправильного решения для каждого L01–L15.
- [ ] Внести тексты, стартовые условия, подсказки и критерии из ТЗ. Критерий завершения опирается на состояние модели. Встроить четыре e2e: балансировка L02, подмес L04, аварийная защита L09 и выбор комплекта L15. Остальные 11 проверить программным повтором записей и приёмкой контента. Для L05 и L14 подготовить отдельный учебный RTL с проверенным принципом регулирования по обратке, чтобы уроки проходились без карточки G1495. Для L13–L15 нужны самостоятельные кейсы с положительными и отрицательными ответами, включая безопасный отказ от покупки лишнего.
- [ ] Запустить `npm run test -- tests/lessons` и `npm run test:e2e -- tests/e2e/core-lessons.spec.ts`. Зафиксировать `feat: publish fifteen verified training lessons`.

## Этап G. Приёмка, передача сборки и эксплуатация

### G01. Прогнать интеграцию и целевые устройства

**После:** D04, E03, F02. **Файлы:** `tests/e2e/release.spec.ts`, `tests/e2e/performance.spec.ts`, `tests/desktop/release.spec.ts`, `scripts/report-performance.ts`, `docs/qa/release-evidence.md`.

- [ ] Зафиксировать тест `assembles_edits_runs_saves_imports_and_replays_large_project`, сценарий А/Б с двумя ревизиями и возвратом обоих результатов после импорта и сценарии из таблицы особых проверок. Добавить проверку, что подключение контура из каталога приводит к расчёту с его профилем и отображается после повторного запуска.
- [ ] Снять показатели по процедуре раздела 8 ТЗ на малом и большом эталонах с указанными устройством, режимом и версией Electron. Исправить остановки, стёртые проекты и расхождения вида и симуляции. В упакованном приложении проверить холодный старт без сети, клавиатуру, русский ввод, контраст, WebGL и переход в 2D с сохранением проекта.
- [ ] Запустить `npm run test:e2e -- tests/e2e/release.spec.ts tests/e2e/performance.spec.ts` и `npm run test:desktop`, приложить логи. Зафиксировать `test: verify editor, simulation and desktop recovery`.

### G02. Провести предметную проверку и пилот

**После:** E02, F02, G01. **Файлы:** `docs/qa/catalog-acceptance.md`, `docs/qa/engineering-acceptance.md`, `docs/qa/pilot.md`.

- [ ] Подготовить список покрытия R01–R19, V01–V12, L01–L15. Сверить снимок сайта, все используемые предложения и составы комплектов. Дополнительную выгрузку проверять для подключённых товарных каналов. Для старта использовать публичный перечень, для продажного режима сверить применяемые товарные данные с владельцем. Приложить матрицу с 100% решений по строкам периметра и нулём `unresolved` среди допущенных к подбору. Для каждого отложенного товара, который остаётся вне подбора, зафиксировать владельца, дату и причину. Пройти обязательные выборы реального SKU во всех соответствующих уроках с подтверждёнными изделиями. Если рабочий профиль отсутствует, сохранить справочную карточку и отдельно учебный аналог. Проверить, что выбытие артикула не лишает обязательный урок единственного решения. Для учебных профилей указать основание параметров явно.
- [ ] Показать инженеру исходы 6 схем, рабочие точки, упрощения и объяснения отказов. Записать замечания, владельца закрытия и измеримое исправление. Закрыть критические расхождения перед выпуском.
- [ ] Провести пилот R13. Задокументировать результат по трём базовым урокам и трём клиентским кейсам с новыми исходными условиями. Зафиксировать требования R13 и причины ошибочного выбора. Имена и личные результаты менеджеров хранить вне публичного репозитория. Зафиксировать `docs: record catalog, engineering and pilot acceptance`.

### G03. Выпустить проверенную локальную ZIP-сборку

**После:** A01, G01–G02. **Файлы:** `.github/workflows/release.yml`, `scripts/assert-public-package.ts`, `docs/operations/release.md`, `docs/operations/rollback.md`, `CHANGELOG.md`.

- [ ] Настроить запуск workflow по версии, Windows-упаковку и выпуск ZIP с SHA-256, commit SHA, `modelVersion` и `catalogReleaseId`. Пакет, доступный в публичном CI, проверять командой `npm run verify:public-bundle`. Владелец выпуска передаёт дополнительные закрытые профили отдельным JSON-пакетом, если они входят в согласованный каталог 1.0.
- [ ] В чистой копии пройти `npm ci`, `npm run check`, `npm run test:e2e`, `npm run catalog:validate -- content/catalog/public-v1.json`, `npm run package:win` и `npm run test:desktop`. На чистой Windows 11 x64 под обычной учётной записью, с отключённой сетью и без средств разработки распаковать проверяемый ZIP и выполнить офлайн-приёмку R19. Получить тот же файл через выбранный канал передачи и повторить старт при штатных политиках Windows на рабочем ПК. Если политика требует подпись или разрешение ИТ, согласовать этот способ и провести проверку с включённой защитой. В том же сеансе проверить 2D и 3D, встроенный каталог, урок, расчёт, сохранение после перезапуска, перенос JSON во второй профиль и импорт каталога с отклонением испорченного файла.
- [ ] На профиле пилотной версии создать проекты и установить пакет каталога, закрыть программу и скопировать профиль. Распаковать новую сборку в отдельную папку, проверить миграцию, сохранённые проекты и активную версию каталога. Повторить запуск с несовместимым пакетом и проверить сохранность этого пакета, видимое переключение на встроенный каталог и доступность штатного урока. Убедиться, что предыдущая сборка, открытая с несовместимым профилем, выдаёт диагностику без изменения данных. Проверить откат на прежней сборке и резервной копии профиля. Проверить, что сохранённый новый профиль можно вернуть при повторном переходе на новую версию. Передать тот же проверенный ZIP и SHA-256 через внутренний канал компании, записать версию и результат приёмки. Зафиксировать `chore: release EducationSim for Windows`.

### G04. Закрыть релиз 1.0 и передать эксплуатацию

**После:** G02–G03. **Файлы:** `README.md`, `docs/operations/operator-guide.md`, `docs/qa/release-evidence.md`.

- [ ] Сверить SHA-256 переданного ZIP с записью G03 и приложить результаты автоматической и офлайн-приёмки.
- [ ] Задокументировать распаковку, запуск, расположение профиля, экспорт, резервное копирование, обновление и откат приложения, импорт каталога, добавление урока, 5-минутный инструктаж, известные ограничения и владельцев. Настроить исправление критичных ошибок с сохранением совместимости проектов.
- [ ] Закрыть пункты ТЗ и подтвердить приёмку фактическими результатами, сохранив ссылку на релиз и доказательства. Зафиксировать `docs: hand over the desktop simulator`.

## Покрытие требований

| Требование ТЗ | Задачи |
|---|---|
| R01–R02. Цель, режимы, обучение | D01, D03, F01–F02, G02 |
| R03. Старт и готовые схемы | C02, D01 |
| R04–R06. 2D/3D, геометрия, органы управления | A03–A04, D01–D04 |
| R07–R10. Ход симуляции, климат, измерение и отказы | B03–B08, C03, D02–D04, G01 |
| R11. Хранение и перенос | A02, E03, G01 |
| R12, R17. Каталог | C01, E01–E02, G02 |
| R13. Учебные материалы и пилот | F01–F02, G02 |
| R14. Монтаж и связи | A03, B01, D01–D02 |
| R15. Оборудование | B01–B07, C01, D02, D04 |
| R16. Численная проверка | B01–B08, C02–C03, G02 |
| R18. Архитектура и качество | A01–A02, B08, D04, E03, G01 |
| R19. Выпуск | G01–G04 |

## Контрольные поставки и зависимости

| Поставка | Что должно уже работать | Ориентир от начала |
|---|---|---|
| P1. Расчётная проверка | A+B, минимальные тестовые схемы и эталоны, без обязательного UI | 3–4 недели |
| P2. Конструктор | C+D, свободный монтаж, рабочая 2D/3D, простые эксперименты | 7–10 недель |
| P3. Учебная beta | E+F, сохранение, каталог, 15 уроков, запуск пилота | 10–14 недель |
| P4. Выпуск 1.0 | G, подтверждённая модель, проверенный набор SKU, проверка нагрузки и отката | 12–18 недель |

Диапазон полной версии уточнён до 12–18 недель после детализации свободной геометрии, каталога, 15 уроков, проверки на Windows и отката. 8–12 недель из предварительной оценки — ускоренный сценарий при параллельной подготовке контента и раннем предоставлении паспортов. Оценка рассчитана на одного основного разработчика при доступности исходных паспортов, выгрузки и технического эксперта по мере готовности этапов. Этапы E01 и разработка данных уроков могут идти параллельно с визуализацией при наличии исполнителей. Критический путь — A → B → C → D → F → G. Разбор паспортов и разметку ассортимента можно вести параллельно с ядром. Реализация импортера E01 использует формат A02 и готовый реестр C01. Утверждённый каталог, инженерное подтверждение, результаты пилота и целевой ПК Windows для автономной приёмки являются входными зависимостями выпуска. Зафиксировать фактические даты, когда владелец даст эти входные данные. До того можно выполнить разработку и проверить её на публичных технических данных и синтетических эталонах.
