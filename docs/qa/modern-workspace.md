# Modern workspace: acceptance routes

This pass changes presentation, action grouping and labels, not calculations, model geometry or project storage formats. The catalog remains a training reference.

| Route | Acceptance check |
| --- | --- |
| Start | New project is obvious, templates open as separate projects and the lesson shortcut jumps to the training list. No network fonts or imagery. |
| Build and connect | Tools are grouped by floor, history, view and 2D layers. The drawing, connection walkthrough and inspector are distinct; the walkthrough and inspector use the same Russian port names. Check a completed and rejected connection, cancellation, deletion and undo. |
| View and run | Cover 2D/3D, resize, camera controls, floor cutaway, paused and advanced calculation, and readings. The view leaves hydraulic/control colors and product geometry intact. |
| Browse catalog | Cover search, article details, no result and catalog import feedback. The catalog offers no buying recommendations. |
| Learn | Open an included exercise, advance a tick, check rubric and hint, retry or open a free copy; review author import separately. |
| Work with files | Cover save status, invalid import, valid import and reopen, project copies and exports. The themed picker opens a native dialog; it must also work from the keyboard. |
| Layout | Inspect 1440 px and 390 px. Cover the home screen, empty project, selected equipment, 3D, running simulation, catalog and an active lesson. Confirm no page-wide horizontal scroll; narrow layout is a robustness check, not a mobile release claim. |

Run `npm run check`, `npm run catalog:validate -- content/catalog/public-v1.json`, and `npm run test:e2e`. The packaged Windows run and the actual company workstation/pilot are separate checks; CI does not replace the latter.
