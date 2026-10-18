# Stage A — Фазы 0–1: подготовка и платформо-независимые тесты

Работаешь в `~/projects/personal/agentO`, ветка `feature/windows-support` (уже создана и выключена).
Читай `docs/windows-support/plan.md` — это утверждённый план. Твоя задача — **Фаза 0 и Фаза 1**.
Код приложения (src/bin) по смыслу не меняем, кроме тестовых хелперов; основной слой `src/platform/*`
появится на Stage B.

## Что сделать

### 1. `.gitattributes`
Создать в корне:
```
* text=auto eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
```
CRLF-файлов в репозитории нет — проверь `git grep -Il $'\r'`.

### 2. Зависимости (пока не использовать)
Добавить в `dependencies`: `cross-spawn@^7.0.6`. В `devDependencies`: `@types/cross-spawn@^6.0.6`.
Через `npm install cross-spawn@^7.0.6` и `npm install -D @types/cross-spawn@^6.0.6`, чтобы обновился lockfile.

### 3. Тестовый хелпер путей
Создать `src/test-utils/paths.ts`:
- `p(...segments)` → `path.join(...)` для ожиданий, которые должны совпадать с рантаймом;
- `posix(...segments)` / `win32(...segments)` — явные ожидания через `path.posix`/`path.win32`;
- `posixPath`/`winPath` (или аналоги) для строк, где важно именно представление.
Правило: **не заменяй все POSIX-ожидания на path.join** — это скроет баг «`\` на Linux».
Ожидания формата конфига на POSIX оставляй явными (`/my/project/...`), а win32-ветку тестируй
отдельным кейсом с инъекцией платформы.

### 4. Починить 10 падений на Windows
Точный список (из CI run 34360105236, шаг Test):
1. `src/adapters/claude-code.test.ts` — `configPaths returns correct paths`
2. `src/adapters/codex.test.ts` — `configPaths > returns correct project path`
3. `src/adapters/copilot.test.ts` — `configPaths > returns project settings.json path`
4. `src/adapters/goose.test.ts` — `configPaths > returns project config.yaml path`
5. `src/adapters/qwen.test.ts` — `configPaths > returns correct project path`
6–10. `src/launcher/shell-path-resolver.test.ts` — `resolves PATH from shell output using delimiters`,
   `returns cached result on second call`, `invalidate clears cache, next resolve re-fetches`,
   `falls back to system PATH on failure`, `strips OSC escape sequences from shell output`

Требования:
- Адаптерные тесты: на POSIX-хосте проверять `path.join('/my/project', '.claude', 'settings.json')`,
  плюс отдельные кейсы для win32-представления через `path.win32` (без запуска на Windows).
- `shell-path-resolver.test.ts`: все POSIX-сценарии должны создавать резолвер с явным
  `{ platform: 'darwin' }` (поле уже есть), win32-кейсы — с `{ platform: 'win32' }`.
  Не подменяй `process.platform` глобально.
- Не удалять и не скипать тесты, чтобы «позеленить». `skipIf` допустим только для реальных
  платформенных интеграций (реальные `.cmd`, `/bin/sh`, `chmod`), и каждый skip должен быть обоснован
  в отчёте.

### 5. Проверки (обязательно выполнить и привести результат)
```
npm test
npm run typecheck
npm run lint
npm run build
node dist/bin/agento.js --version
```
Все должны быть зелёными на Linux. Число тестов не должно уменьшиться: было **684 passed / 4 skipped
(688)** — после правок допускается только рост (или те же значения, если ты не добавлял кейсов).

### 6. Отчёт
В конце выведи в stdout:
```
STAGE_A_DONE
tests: <passed>/<skipped>/<total>
files: <список изменённых/созданных файлов>
notes: <что осталось / что не удалось проверить>
```
и запиши тот же отчёт в `docs/windows-support/runs/stageA-report.md` (каталог `runs/` в .gitignore,
это нормально). В отчёте перечисли, какие тесты были изменены и почему, и какие кейсы добавлены
для win32.

## Границы
- Не коммить и не пушь — коммит делает оркестратор после проверки.
- Не трогай `src/platform/*` (его ещё нет), `src/launcher/child.ts`, инсталлеры, адаптеры —
  это Stage B/C. Допустимы только правки в `*.test.ts`, `src/test-utils/*`, `package.json`,
  `package-lock.json`, `.gitattributes`.
- Не меняй поведение приложения. Если для теста нужен маленький рефакторинг — остановись и опиши
  в отчёте, не делай.
- Windows-специфичное поведение на этой машине не проверить: помечай в отчёте как «проверить в CI».
