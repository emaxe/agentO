# Промт для реализации критических исправлений

Ты работаешь в проекте `agento` — CLI-утилита для управления конфигурациями AI-агентов (Claude Code, OpenCode). Стек: TypeScript, ESM, commander, ink (React TUI), zod, vitest.

## Контекст проекта

- `bin/agento.ts` — точка входа CLI
- `src/cli/commands/` — реализации команд (launch.ts, provider.ts, profile.ts, restore.ts, agent.ts)
- `src/launcher/child.ts` — запуск агента как child process с backup/restore конфига
- `src/launcher/independent.ts` — запуск агента как detached process
- `src/adapters/` — адаптеры генерации конфигов (claude-code.ts, opencode.ts)
- `src/config/store.ts` — чтение/запись конфига и бэкапов
- `src/tui/` — React TUI на ink

## Задачи (выполнять по порядку)

### 1. Убрать неиспользуемые импорты в `src/launcher/child.ts`

Удалить:
```ts
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
```

Оставить только используемые импорты из этих модулей (в данном случае ничего из них не нужно).

### 2. Подключить реальные CLI-команды в `bin/agento.ts`

Заменить стаб-команды на реальные реализации. Текущий код:
```ts
program.command('launch').description('...').allowUnknownOption().action(() => { console.log('CLI command: launch'); });
// аналогично provider, profile, restore, agent
```

Заменить на:
```ts
import { createLaunchCommand } from '../src/cli/commands/launch.js';
import { createProviderCommand } from '../src/cli/commands/provider.js';
import { createProfileCommand } from '../src/cli/commands/profile.js';
import { createRestoreCommand } from '../src/cli/commands/restore.js';
import { createAgentCommand } from '../src/cli/commands/agent.js';

program.addCommand(createLaunchCommand());
program.addCommand(createProviderCommand());
program.addCommand(createProfileCommand());
program.addCommand(createRestoreCommand());
program.addCommand(createAgentCommand());
```

Default action (TUI при вызове без аргументов) оставить как есть.

### 3. Исправить cleanup в `src/launcher/child.ts` — удалять конфиг если его не было

Проблема: если `adapter.readConfig()` вернул `null`, бэкапится `{}`. При restore `Object.keys({}).length > 0` = false, конфиг не восстанавливается и сгенерированный файл остаётся.

Решение:
- Использовать `unlink` для удаления файла если конфига изначально не было
- Запомнить в замыкании `const hadConfig = currentConfig !== null`
- В cleanup: если `!hadConfig` — удалить файл по пути `adapter.configPaths(cwd)[scope]`, если `hadConfig` — записать бэкап как раньше

```ts
import { unlink } from 'node:fs/promises';

const hadConfig = currentConfig !== null;

const cleanup = async (): Promise<void> => {
  if (!hadConfig) {
    const configPath = adapter.configPaths(cwd)[scope];
    try { await unlink(configPath); } catch { /* file might not exist */ }
  } else {
    const backup = await readBackup(adapter.id, scope);
    if (backup !== null) {
      await adapter.writeConfig(backup as Record<string, unknown>, scope, cwd);
    }
  }
};
```

### 4. Пробрасывать сигнал дочернему процессу в `src/launcher/child.ts`

Проблема: при SIGTERM/SIGINT child process остаётся как orphan.

Решение: вынести `child` в общий scope и убить его в handleSignal:

```ts
return new Promise<number>((resolve) => {
  const child = spawn(command, args, { stdio: 'inherit', cwd: cwd ?? process.cwd(), shell: false });

  const handleSignal = (signal: NodeJS.Signals): void => {
    child.kill(signal);
    cleanup().catch(console.error).finally(() => process.exit(1));
  };
  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);

  // ... остальная логика exit/error
});
```

Обрати внимание: тип `handleSignal` теперь принимает signal, чтобы пробросить тот же сигнал.

### 5. OpenCode адаптер: выбирать `base` tier

В `src/adapters/opencode.ts` метод `buildConfig`:

```ts
// Было:
const first = profile.models[0];

// Стало:
const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
```

И далее использовать `base` вместо `first`. Добавить тест в `opencode.test.ts` с мульти-тировым профилем.

### 6. Claude Code адаптер: ошибка при разных провайдерах для тиров

В `src/adapters/claude-code.ts` метод `buildConfig`, после определения `small`, `base`, `smart`:

```ts
const providerIds = new Set([small.providerId, base.providerId, smart.providerId]);
if (providerIds.size > 1) {
  throw new Error(
    `Claude Code supports only one provider per profile. Found providers for different tiers: ${[...providerIds].join(', ')}`
  );
}
```

Добавить тест в `claude-code.test.ts`.

## Валидация

После всех изменений:
1. `npx tsc --noEmit` — без ошибок
2. `npx vitest run` — все тесты проходят (включая новые)
3. `node dist/bin/agento.js --help` — выводит команды launch, provider, profile, restore, agent
