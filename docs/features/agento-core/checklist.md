# Чеклист реализации: AgentO Core

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Работа ведётся в ветке `main` (отдельная feature-ветка не создаётся)

## Задачи

### Блок 1 — Project setup
- [x] #1: Инициализировать npm-пакет (package.json, tsconfig, vitest, ESLint, Prettier)
- [x] #2: Точка входа bin/agento.ts (роутинг CLI/TUI)

### Блок 2 — Config layer
- [x] #3: Zod-схемы (Provider, Profile, Settings, AgentConfig)
- [x] #4: Config store (read/write config.json, backup/restore механизм)

### Блок 3 — Business logic
- [x] #5: Provider manager (CRUD)
- [x] #6: Profile manager (CRUD)

### Блок 4 — Adapter system
- [x] #7: Интерфейс AgentAdapter
- [x] #8: Адаптер Claude Code
- [x] #9: Адаптер OpenCode

### Блок 5 — Launcher
- [x] #10: Child launcher (spawn + cleanup hooks)
- [x] #11: Independent launcher (detached spawn)

### Блок 6 — CLI
- [x] #12: CLI launch
- [x] #13: CLI provider
- [x] #14: CLI profile
- [x] #15: CLI restore + agent status

### Блок 7 — TUI
- [x] #16: TUI App + MainMenu
- [ ] #17: TUI LaunchAgent
- [ ] #18: TUI Providers
- [ ] #19: TUI Profiles
- [ ] #20: TUI Agents + Settings

### Блок 8 — Tests + Final
- [ ] #21: Unit-тесты
- [ ] #22: Final polish (package.json bin/files, README)

## Финализация
- [ ] Все проверки пройдены
- [ ] Код закоммичен
- [ ] Статус в README.md обновлён на `Done`
