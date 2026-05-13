# 002 - Ввести единый реестр агентов

## Статус

Done

## Приоритет

P0

## Контекст

Списки агентов сейчас дублируются в нескольких местах: CLI launch, CLI agent status, TUI LaunchAgent, TUI Agents, installers registry и label map. При добавлении нового агента легко забыть обновить одну из точек.

## Проблема

Дублирование реестра создает риск рассинхронизации поведения CLI и TUI. Уже сейчас `restore` отстал от фактического списка адаптеров.

## Цель

Создать единый source of truth для агентов, который содержит adapter, id, label, command, default args, dev-флаг и installer.

## Scope

- Добавить модуль наподобие `src/agents/registry.ts`.
- Перенести туда список всех агентов: `claude-code`, `opencode`, `qwen`, `codex`, `copilot`, `goose`.
- Экспортировать функции:
  - `listAgents({ dev?: boolean })`
  - `getAgent(id, { dev?: boolean })`
  - `listAdapters({ dev?: boolean })`
  - `getAgentCommand(id, { dev?: boolean })`
- Обновить CLI `launch`, CLI `agent status`, TUI `LaunchAgent`, TUI `Agents`, `AgentInstall` labels и installer lookup на новый registry.

## Вне scope

- Изменение формата адаптеров.
- Изменение пользовательского CLI API.

## Критерии приемки

- Новый агент добавляется через одну запись в едином registry.
- CLI и TUI используют один и тот же порядок и фильтр `dev`.
- `agento launch`, `agento agent status`, TUI launch и install wizard работают через registry.
- Нет локальных `ALL_AGENTS`, `ALL_ADAPTERS`, `ALL_AGENT_COMMANDS`, которые дублируют полный список.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Дополнительно вручную:

```bash
node dist/bin/agento.js --help
node dist/bin/agento.js agent status
node dist/bin/agento.js agent status --dev
```

## Риски

- Можно случайно изменить порядок отображения агентов в TUI.
- Нужно сохранить поведение `dev` агентов, особенно `codex`, если он остается скрытым по умолчанию.
