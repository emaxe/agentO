# Stage E — Фаза 5: TUI, раскладка и консоль Windows

Работаешь в `~/projects/personal/agentO`, ветка `feature/windows-support`. Читай
`docs/windows-support/plan.md` (§3.6, §8).

Сделано: платформенный слой, инсталлеры, сигналы/ФС/восстановление. 870 тестов зелёные на Linux,
Windows-CI зелёный (включая реальный `.cmd`-тест и `taskkill`).

## Цель

Убрать Windows-специфичные дефекты TUI и сделать поведение терминала предсказуемым. Косметика
не должна ломать POSIX.

## 1. Запуск TUI без терминала (`bin/agento.ts`)

Перед `runTuiLoop` в default action:
```ts
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    'agento: the interactive TUI needs a terminal. Use `agento launch -p <profile> -a <agent>`.',
  );
  process.exit(2);
}
```
Тест: `spawnSync(process.execPath, ['dist/bin/agento.js'], { stdio: 'pipe' })` → код 2 и сообщение.
(Тест может быть отдельным и запускаться только если `dist/` собран — как существующий smoke.)

## 2. Заглавная ЙЦУКЕН (`src/tui/use-key-input.ts`)

Сейчас маппятся только строчные. Shift/CapsLock даёт `Н`, `Т`, `Й` — подтверждения `y/n` не работают.
- Построить карту для обоих регистров: строчная → строчная QWERTY, заглавная → заглавная QWERTY
  (`Й→Q`, `Н→Y`, `Т→N`, …). Не превращать `Й` в `q`: существующие проверки различают `y`/`Y`.
- Тесты: `н→y`, `Н→Y`, `т→n`, `Т→N`, `й→q`, `Й→Q`, латиница без изменений, прочие символы без изменений.

## 3. Вставка в `TextField` (`src/tui/components/TextField.tsx`)

Windows Terminal при вставке многострочного текста может прислать `\r`/`\n`, и `ink-text-input`
воспринимает `\r` как submit.
- Санитизировать значение в `onChange`: убрать `\r` и `\n` (вынести чистую функцию
  `sanitizeFieldValue` и покрыть тестом).
- Не менять поведение `onSubmit` по Enter.

## 4. Рамки для conhost (`src/tui/screens/MainMenu.tsx`)

`borderStyle="round"` в старом conhost с растровым шрифтом может давать «квадраты».
- Добавить `src/tui/border-style.ts`: `tuiBorderStyle(env = process.env, platform = process.platform)`
  → `'classic'`, если `platform === 'win32'` и нет `WT_SESSION` и `TERM_PROGRAM`; иначе `'round'`.
- Использовать в `MainMenu` (и в других местах, если найдутся).
- Тесты: win32 без WT → classic; win32 с `WT_SESSION` → round; darwin/linux → round; `TERM_PROGRAM`
  (vscode/iTerm) → round.

## 5. Передача stdin агенту (`bin/agento.ts`)

`beforeSpawn` сейчас `process.stdin.pause()`. На Windows возможна потеря первого символа.
- Перед `pause()` на win32 вызывать `process.stdin.setRawMode?.(false)` (Ink уже размонтирован);
  на POSIX не менять поведение.
- Это защитная мера: пометь в отчёте, что требует ручной проверки на Windows (набрать символ сразу
  после старта агента).

## 6. Тесты и проверки

```
npm test
npm run typecheck
npm run lint
npm run build
node dist/bin/agento.js --version
```
Зелёные на Linux, тестов ≥ 870. Guard-тест `src/tui/english-ui.test.ts` должен остаться зелёным
(кириллица в UI-строках запрещена, карта маппинга исключена).

## 7. Отчёт

```
STAGE_E_DONE
tests: <passed>/<skipped>/<total>
files: <изменённые/созданные>
manual: <что нужно проверить руками в Windows Terminal и conhost>
```
Продублируй в `docs/windows-support/runs/stageE-report.md`. Перечисли, что осталось
непроверяемым на Linux (потеря stdin, вставка, рамки, resize) и как это проверить вручную.

## Границы
- Не коммить и не пушь.
- Не трогать сигналы, ФС, инсталлеры, CI и README — CI/документация в Stage F.
- Не менять тексты UI на русский.
