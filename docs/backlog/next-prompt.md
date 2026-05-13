# Prompt For Next Session

Ты работаешь в репозитории AgentO:

```text
/Users/maksimklisin/Desktop/_JS/agento
```

Нужно последовательно реализовать три задачи из backlog:

```text
docs/backlog/010-secret-handling.md
docs/backlog/014-docs-sync.md
docs/backlog/013-integration-test-coverage.md
```

## Порядок выполнения

Реализуй `010` → `014` → `013` полностью (включая тесты и проверки). После каждой задачи — обязательные проверки и коммит.

---

## Задача 010 — File permissions для agent configs

### Цель

Агентские конфиги, которые пишут адаптеры (`~/.claude/settings.json`, `~/.config/opencode/config.json`, `~/.qwen/settings.json`, `~/.codex/config.toml`), содержат API keys в plaintext. Сейчас они пишутся обычным `writeFile` без ограничения прав доступа.

### Текущая проблема

- `claude-code.ts:103`: `writeFile(path, JSON.stringify(...), 'utf-8')` — нет `0o600`
- `opencode.ts:120`: `writeFile(path, JSON.stringify(...), 'utf-8')` — нет `0o600`
- `qwen.ts:105`: `writeFile(path, JSON.stringify(...), 'utf-8')` — нет `0o600`
- `codex.ts:46`: `writeTomlFile` → `writeFile(path, stringifyToml(...), 'utf-8')` — нет `0o600`
- `store.ts` (writeBackup): `mkdir(dir, { recursive: true })` — нет `mode: 0o700` для `backups/<agentId>/`
- `copilot.ts` и `goose.ts` — no-op `writeConfig`, файлов не пишут, менять не нужно.

### Требуемая реализация

**Шаг 1.** Извлечь `writeJsonAtomic` и вынести в `src/config/atomic-write.ts`. Добавить туда же `writeFileAtomic` (для произвольного контента):

```ts
/**
 * Writes content atomically: to a temp file in the same directory,
 * sets the given file mode, then renames into place. Cleans up temp on error.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  mode = 0o600,
): Promise<void>;

/**
 * Serializes data as JSON and writes atomically with writeFileAtomic.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  mode = 0o600,
): Promise<void>;
```

Алгоритм — тот же что в `store.ts:47` (`randomUUID` → `writeFile(tmp)` → `rename` → cleanup on error).

**Шаг 2.** Обновить `store.ts`: удалить локальную `writeJsonAtomic`, импортировать из `./atomic-write.js`.

**Шаг 3.** Обновить `claude-code.ts` (`writeConfig`, строка ~103): заменить `writeFile(path, JSON.stringify(config, null, 2), 'utf-8')` на `writeJsonAtomic(path, config)`. Убрать `writeFile` из импортов.

**Шаг 4.** Обновить `opencode.ts` (`writeConfig`, строка ~120): аналогично. Убрать `writeFile` из импортов.

**Шаг 5.** Обновить `qwen.ts` (`writeConfig`, строка ~105): аналогично.

**Шаг 6.** Обновить `codex.ts` (`writeTomlFile`, строка ~44): заменить `writeFile(path, stringifyToml(config), 'utf-8')` на `writeFileAtomic(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]))`. Убрать `writeFile` из импортов.

**Шаг 7.** В `store.ts` (`writeBackup`, строка ~170): добавить `mode: 0o700` к `mkdir(dir, { recursive: true })` для директорий бэкапов.

### Что открыть перед реализацией

- `src/config/store.ts` — локальная `writeJsonAtomic` (строки 47–61), `writeBackup` (строка ~170)
- `src/adapters/claude-code.ts:103`, `opencode.ts:120`, `qwen.ts:105`, `codex.ts:44–46`

### Тесты

Добавить в каждый `src/adapters/*.test.ts` тест (только POSIX):

```ts
it('writeConfig sets 0o600 file mode on POSIX', async () => {
  if (process.platform === 'win32') return;
  // ... создать tmpdir, вызвать writeConfig, stat().mode & 0o777 === 0o600
});
```

Добавить для `claude-code`, `opencode`, `qwen`, `codex` (для codex — проверить TOML-файл).
Паттерн тестов — как в `store.test.ts` (mock `node:os homedir`, `vi.resetModules`, real tmpdir).

В `store.test.ts` добавить: после `writeBackup` — `stat(backupPath).mode & 0o777 === 0o600` и директория `backups/<agentId>/` имеет `mode & 0o777 === 0o700` (POSIX only).

### Обновления CHECKLIST.md

- Перед началом: `010` → `In Progress`.
- После успешных проверок: `010` → `Done`, все чекбоксы.

---

## Задача 014 — Docs sync

### Цель

Привести `AGENTS.md` и `README.md` в соответствие с кодом. Обновить CHANGELOG.

### AGENTS.md — конкретные исправления

**Стек (строка ~15):** удалить строку:
```
- **node-pty** (optional) для PTY-режима запуска
```

**Система конфигурации / Settings schema (~строка 89):** удалить строку с `independentMode`:
```
    independentMode: 'spawn-detached' | 'pty';
```

**Структура проекта (~строка 41):** добавить после строки про `schema.ts`:
```
│   │   ├── validation.ts      # Доменная валидация providers/profiles (008)
│   │   └── atomic-write.ts    # Атомарная запись файлов с mode 0o600 (009/010)
```

**Таблица адаптеров (~строка 152):** добавить строки для Copilot и Goose (они отсутствуют, хотя реализованы). Для Copilot:

```
| Copilot CLI | `copilot` | `gh copilot` | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | — (env-only) | Игнорирует | Конфиг через env vars, `writeConfig` — no-op |
```

Для Goose:
```
| Goose | `goose` | `goose` | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | — (env-only) | Игнорирует | `GOOSE_PROVIDER`/`GOOSE_MODEL`/`OPENAI_HOST`; `writeConfig` — no-op |
```

**Чеклист перед публикацией (~строка 383):** добавить пункт про `npm run build && node dist/bin/agento.js --version` как smoke check.

**Сборка и запуск (~строка 298):** убрать упоминание `main`/`exports` если есть; добавить что `npm run prepublishOnly` включает `--version` smoke.

### README.md — проверить

Прочитай `README.md` перед правкой. Проверь:
- Нет упоминания `node-pty`, `independentMode` или `--version` без smoke
- Таблица агентов (уже есть Copilot и Goose — по результатам поиска) — убедись что актуальна
- Если есть `--independent` или `independentMode` — убрать

### CHANGELOG.md

Проверь секцию `[Unreleased]`. Должны быть записи для задач `009`, `011`, `012` (добавлены в предыдущей сессии). Добавить запись для `010` и `014` после выполнения.

### Обновления CHECKLIST.md

- Перед началом: `014` → `In Progress`.
- После: `014` → `Done`.

---

## Задача 013 — Integration test coverage

### Цель

Добавить integration tests для launch/restore flow с реальными файловыми операциями (без мокирования адаптеров), и CLI smoke tests через child process.

### Что создать

#### `src/launcher/integration.test.ts`

Использовать тот же паттерн что в `store.test.ts`: mock `node:os homedir`, `vi.resetModules()` в `beforeEach`, реальный tmpdir.

Покрыть:

1. **Full child-mode cycle**: `prepareLaunchTransaction` с `ClaudeCodeAdapter`, provider `anthropic` → файл создан → cleanup → файл удалён (т.к. `hadFile: false`).

2. **File restored after cleanup**: если до launch существовал оригинальный конфиг → после cleanup он восстановлен.

3. **Backup blocked second launch**: после `prepareLaunchTransaction` без cleanup → второй `prepareLaunchTransaction` с тем же agent/scope бросает ошибку `agento restore`.

4. **Independent mode leaves backup**: `prepareLaunchTransaction` → cleanup не вызывается → `backupExists(agentId, scope) === true` → ручной `deleteBackup` → `backupExists === false`.

5. **Codex project scope restores both files**: `prepareLaunchTransaction` с `CodexAdapter`, scope `project`, реальный tmpdir → cleanup → оба файла (global + project TOML) удалены (т.к. `hadFile: false`).

**Важно:** для этих тестов нужен реальный `provider` и `profile`. Можно захардкодить минимальные объекты:

```ts
const provider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test',
  type: 'anthropic',
  apiKey: 'sk-test',
  models: [{ name: 'claude-3-5-sonnet', capabilities: { image: true, video: false, audio: false } }],
};
const profile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'default',
  models: [{ providerId: provider.id, model: 'claude-3-5-sonnet' }],
};
```

Нужно мокировать только `shellPathResolver.resolve()` чтобы он не вызывал login shell:
```ts
vi.mock('../launcher/shell-path-resolver.js', () => ({
  shellPathResolver: { resolve: vi.fn().mockResolvedValue('/usr/bin:/bin') },
}));
```

#### `src/cli/smoke.test.ts`

CLI smoke через child_process (требует `npm run build`):

```ts
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const CLI = join(process.cwd(), 'dist/bin/agento.js');

describe('CLI smoke (dist)', () => {
  it('--version outputs package version', () => {
    const result = spawnSync('node', [CLI, '--version'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help exits 0 and mentions agento', () => {
    const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('agento');
  });

  it('launch --help exits 0', () => {
    const result = spawnSync('node', [CLI, 'launch', '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('restore --help exits 0', () => {
    const result = spawnSync('node', [CLI, 'restore', '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });
});
```

**Важно:** smoke test зависит от `dist/`. Добавь в начале файла комментарий: `// Requires: npm run build`. Если `dist/bin/agento.js` не существует — тесты пропускаются (используй `vi.skipIf` или проверку `existsSync`).

### Обновления CHECKLIST.md

- Перед началом: `013` → `In Progress`.
- После: `013` → `Done`.

---

## Общий контекст

Проект: TypeScript + Node.js ESM CLI, тесты Vitest, сборка через `tsc`. После изменений в `src/` или `bin/` обязательно:

```bash
npm run build
```

Завершённые задачи: `001`–`009`, `011`, `012`.

Текущая ветка: `main`. Не трогай `.claude/`.

---

## Обязательные проверки (после каждой задачи)

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

После задачи 012 и финально:
```bash
node dist/bin/agento.js --version
```

В конце всех трёх задач:
```bash
npm run prepublishOnly
```

---

## Документация (после каждой задачи)

- `docs/backlog/<NNN>-*.md`: статус `Done`.
- `docs/backlog/CHECKLIST.md`: задачи отмечены выполненными.
- `CHANGELOG.md`: добавить записи в `[Unreleased]`.
- `AGENTS.md`: обновить (014 — это вся задача про docs).

---

## Definition Of Done

### 010

- `src/config/atomic-write.ts` экспортирует `writeFileAtomic` и `writeJsonAtomic`.
- `store.ts` импортирует `writeJsonAtomic` из `./atomic-write.js`.
- `claude-code`, `opencode`, `qwen` адаптеры используют `writeJsonAtomic` в `writeConfig`.
- `codex` использует `writeFileAtomic` в `writeTomlFile`.
- `writeBackup` создаёт `backups/<agentId>/` с `mode: 0o700`.
- Тесты POSIX mode `0o600` для каждого адаптера с реальными файлами.
- Все проверки (`lint`, `typecheck`, `test`, `build`) проходят.

### 014

- `AGENTS.md` не содержит `node-pty`, `independentMode`.
- `AGENTS.md` содержит Copilot и Goose в таблице адаптеров.
- `AGENTS.md` содержит `validation.ts` и `atomic-write.ts` в структуре проекта.
- `README.md` не содержит устаревших ссылок на `independentMode`/`node-pty`.
- `CHANGELOG.md` `[Unreleased]` отражает все завершённые задачи.

### 013

- `src/launcher/integration.test.ts` покрывает 5 сценариев.
- `src/cli/smoke.test.ts` покрывает `--version`, `--help`, `launch --help`, `restore --help`.
- Smoke tests пропускаются если `dist/` не собран.
- Все проверки проходят.
- `npm run prepublishOnly` проходит.

## Финальный ответ

Укажи кратко:

- какие файлы изменены (по задачам);
- подход к `atomic-write.ts` (010);
- какие именно строки/таблицы обновлены в AGENTS.md (014);
- сколько integration тестов добавлено и что покрывают (013);
- результат всех проверок.
