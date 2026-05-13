# Prompt For Next Session

Ты работаешь в репозитории AgentO:

```text
/Users/maksimklisin/Desktop/_JS/agento
```

Нужно реализовать следующую задачу из backlog:

```text
docs/backlog/002-agent-registry.md
```

## Цель

Ввести единый source of truth для поддерживаемых агентов, чтобы CLI, TUI, launch flow, status view и install wizard больше не держали собственные копии списков `claude-code`, `opencode`, `qwen`, `codex`, `copilot`, `goose`.

## Контекст

Проект: TypeScript + Node.js ESM CLI, тесты Vitest, сборка через `tsc`. После изменений в `src/` или `bin/` обязательно запускать `npm run build`, потому что глобальный `agento` использует `dist/`.

Задача `001` уже завершена: lint включен в `prepublishOnly`, поэтому `npm run prepublishOnly` теперь запускает `npm run lint && npm run build && npm test`.

Сейчас дублирующиеся списки и lookup находятся как минимум здесь:

- `src/cli/commands/launch.ts`:
  - `ALL_AGENT_COMMANDS`
  - `getAgentCommands`
  - help text `Agent to launch (...)`
- `src/cli/commands/agent.ts`:
  - `ALL_ADAPTERS`
  - `getAdapters`
- `src/tui/screens/LaunchAgent.tsx`:
  - imports всех adapters
  - `ALL_AGENTS`
  - `getAgents`
  - install checks через `ALL_AGENTS`
  - `getInstaller(a.id as AgentId)`
- `src/tui/screens/Agents.tsx`:
  - imports всех adapters
  - `ALL_ADAPTERS`
  - `getAdapters`
- `src/tui/screens/AgentInstall.tsx`:
  - `AGENT_LABELS`
  - `getInstaller(agentId)`
- `src/installers/registry.ts`:
  - отдельный map `AgentId -> AgentInstaller`

В `src/config/schema.ts` уже есть `AgentIdSchema` и `AgentId`.

## Требования к реализации

1. Открой и изучи:
   - `docs/backlog/002-agent-registry.md`
   - `docs/backlog/CHECKLIST.md`
   - `src/config/schema.ts`
   - `src/adapters/base.ts`
   - `src/cli/commands/launch.ts`
   - `src/cli/commands/agent.ts`
   - `src/tui/screens/LaunchAgent.tsx`
   - `src/tui/screens/Agents.tsx`
   - `src/tui/screens/AgentInstall.tsx`
   - `src/installers/registry.ts`

2. Обнови `docs/backlog/CHECKLIST.md`:
   - переведи задачу `002` из `Backlog` в `In Progress` в таблице перед началом работы;
   - отмечай процессные чекбоксы по мере выполнения;
   - после успешных проверок переведи задачу в `Done`.

3. Создай единый registry, например `src/agents/registry.ts`.
   Registry должен содержать одну запись на агента с:
   - `id`
   - `label`
   - `adapter`
   - `command`
   - optional `args`
   - optional `installer`
   - dev-флаг через `adapter.dev`

4. Сохрани текущий порядок агентов:
   - `claude-code`
   - `opencode`
   - `qwen`
   - `codex`
   - `copilot`
   - `goose`

5. Экспортируй функции, покрывающие текущие сценарии:
   - `listAgents({ dev?: boolean })`
   - `getAgent(id, { dev?: boolean })`
   - `listAdapters({ dev?: boolean })`
   - `getAgentCommand(id, { dev?: boolean })`

   Можно добавить `getAgentInstaller` или `getAgentLabel`, если это делает TUI проще, но не плодить второй registry.

6. Обнови существующие потребители:
   - `src/cli/commands/launch.ts` должен использовать registry для adapter/command/args и списка supported ids.
   - `src/cli/commands/agent.ts` должен использовать `listAdapters`.
   - `src/tui/screens/LaunchAgent.tsx` должен использовать `listAgents` и installer из registry.
   - `src/tui/screens/Agents.tsx` должен использовать `listAdapters`.
   - `src/tui/screens/AgentInstall.tsx` должен получать label и installer из registry.
   - `src/installers/registry.ts` должен либо стать thin wrapper над новым registry для обратной совместимости, либо быть удален из потребителей. Не оставляй там отдельный полный список агентов.

7. Сохрани текущее runtime-поведение:
   - `codex` остается скрытым без `--dev`, если `codexAdapter.dev === true`.
   - TUI и CLI показывают агентов в том же порядке.
   - default args сохраняются:
     - `codex`: `['-p', 'default']`
     - `goose`: `['session']`
   - CLI API не меняется.

8. Добавь focused tests для registry.
   Минимум:
   - `listAgents()` скрывает dev-агентов.
   - `listAgents({ dev: true })` возвращает полный список в нужном порядке.
   - `getAgentCommand('codex', { dev: true })` возвращает command `codex` и args `['-p', 'default']`.
   - `getAgent('codex')` не возвращает скрытого dev-агента без `dev: true`.

9. Не делай unrelated refactor.
   - Не реализуй задачу `003` про `restore` в этом проходе.
   - Не меняй формат адаптеров.
   - Не меняй пользовательский CLI API.
   - Не форматируй весь проект.
   - Не трогай неотслеживаемую `.claude/`, если она есть.

## Документация

После кода обнови документацию только по делу:

- `docs/backlog/002-agent-registry.md`: статус `Done` после успешных проверок.
- `docs/backlog/CHECKLIST.md`: задача `002` отмечена как выполненная.
- `AGENTS.md`: обнови инструкции про добавление нового агента, чтобы они ссылались на единый registry вместо отдельных списков в CLI/TUI.
- `CHANGELOG.md`: добавь запись в `[Unreleased]` про единый registry агентов.
- `README.md` / `README.ru.md` обновляй только если изменилось пользовательски видимое поведение. Для этой задачи ожидается, что поведение не меняется.

## Обязательные проверки

Запусти:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

После сборки дополнительно проверь CLI smoke:

```bash
node dist/bin/agento.js --help
node dist/bin/agento.js agent status
node dist/bin/agento.js agent status --dev
```

Так как `prepublishOnly` теперь включает lint, в конце также запусти:

```bash
npm run prepublishOnly
```

Если какая-то проверка упала, исправь причину и повтори релевантные проверки.

## Definition Of Done

- Есть единый registry агентов.
- CLI launch/status и TUI launch/status/install wizard используют registry.
- Нет локальных `ALL_AGENTS`, `ALL_ADAPTERS`, `ALL_AGENT_COMMANDS`, которые дублируют полный список.
- `codex` по-прежнему скрыт без `--dev`.
- `npm run lint` проходит.
- `npm run typecheck` проходит.
- `npm test` проходит.
- `npm run build` проходит.
- CLI smoke-команды проходят.
- `npm run prepublishOnly` проходит.
- `docs/backlog/CHECKLIST.md` обновлен: задача `002` отмечена как выполненная.
- `docs/backlog/002-agent-registry.md`, `AGENTS.md`, `CHANGELOG.md` обновлены по смыслу.

## Финальный ответ

В финальном ответе кратко укажи:

- какие файлы изменены;
- какие проверки запущены и результат;
- сохранилось ли поведение `--dev` и порядок агентов;
- есть ли остаточные риски или замечания.
