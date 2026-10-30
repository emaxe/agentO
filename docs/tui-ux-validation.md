# TUI UX verification

The implementation is covered by automated Ink interaction tests. A session with new and experienced users has **not** been conducted; automated checks do not establish usability.

## Automated coverage

| Task | Coverage |
| --- | --- |
| First setup, unavailable `/models`, manual model, profile save, review, launch | `src/tui/wizards/setup-flow.test.tsx` (isolated home, mocked catalog and launch) |
| Repeat a confirmed launch; changed key opens review again | `src/tui/wizards/setup-flow.test.tsx` |
| Model, credentials, endpoint, mode, scope, directory, merge and file-path invalidation | `src/tui/launch-confirmation.test.ts` |
| No credentials in UI cache; unknown confirmation version ignored | Setup flow and `src/config/ui-state.test.ts` |
| Escape cancels model edit; Keep editing is the default; write rejection/duplicate save/retry | `src/tui/screens/provider-form.test.tsx` |
| Used provider dependencies and delete rejection stay in dialog | `src/tui/screens/providers.test.tsx` |
| Multi-file Codex project preview, env-only preview | `src/launcher/preview.test.ts` |
| Agent and restore outcomes remain separate after failed cleanup | `src/tui/run-loop.test.ts` |
| Selection on resize, bounded details and visible actions at 80×24 / 120×40 | `src/tui/responsive-layout.test.tsx` |
| Backup reservations and existing CLI behavior | Existing transaction, restore, child, independent and CLI suites |

## Short usability session to conduct

Recruit at least one new user and one regular user. Use a disposable AgentO configuration and test provider. Let the participant work without coaching; record completion, time, requests for help, unexpected actions, and a short comment after each task.

1. New user: connect a provider and launch once from an empty configuration.
2. New user: complete setup when model loading fails, using a supplied model name.
3. Both: rename a model, cancel that edit, then try leaving an edited form and continue editing.
4. Both: encounter a failed save, correct the cause, and save the retained data.
5. Both: attempt to delete a provider that a profile uses; explain the available next action.
6. Regular user: repeat the last launch, then change a model or scope and explain the review.
7. Both: review Codex project files and an env-only launch; identify what will change and how restoration works.
8. Regular user: inspect a blocked backup, find its files/session state, and recover once its owner has stopped.
9. Both: navigate a long list at 80×24 and resize to 120×40 without losing the highlighted item.

| Participant | Task | Completed unassisted | Time | Help/errors | Observation |
| --- | --- | --- | --- | --- | --- |
| Pending | | | | | |

Do not run a real agent or restore a live session solely for the study without the participant's authorization. Existing backup locks remain authoritative.
