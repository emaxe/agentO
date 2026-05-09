# План исправления критичных и важных проблем

## Проблема и подход

В проекте обнаружены проблемы, которые делают CLI нерабочим, а также логические ошибки в launcher и адаптерах. План описывает последовательность исправлений с зависимостями.

---

## Задачи

### 1. Подключить реальные CLI-команды в `bin/agento.ts`

**Файл:** `bin/agento.ts`

Сейчас все команды (`launch`, `provider`, `profile`, `restore`, `agent`) — стабы с `console.log`. Реальные реализации (`createLaunchCommand`, `createProfileCommand`, etc.) существуют в `src/cli/commands/`, но не подключены.

**Действия:**
- Удалить стаб-команды
- Импортировать и подключить `createLaunchCommand()`, `createProviderCommand()`, `createProfileCommand()`, `createRestoreCommand()`, `createAgentCommand()` из `src/cli/commands/`
- Убедиться что default action (TUI) по-прежнему работает при вызове без аргументов

---

### 2. Исправить cleanup в `launcher/child.ts` — случай "конфиг не существовал"

**Файл:** `src/launcher/child.ts`

Если до запуска конфига агента не было (`readConfig` вернул `null`), бэкапится `{}`. После завершения cleanup проверяет `Object.keys(backup).length > 0` → false → конфиг не удаляется. Сгенерированный файл остаётся.

**Действия:**
- Различать два состояния: "конфиг был пустым объектом" vs "конфига не было совсем"
- Вариант A: сохранять в бэкап маркер `null` / sentinel значение и при restore удалять файл (`unlink`)
- Вариант B: хранить метаданные `{ existed: boolean, content: ... }` в бэкапе
- Обновить `cleanup()` чтобы удалял файл если конфига до запуска не существовало

---

### 3. Пробрасывать сигнал дочернему процессу в `launcher/child.ts`

**Файл:** `src/launcher/child.ts`

При получении SIGTERM/SIGINT родительский процесс вызывает cleanup + exit, но не убивает child process. Дочерний процесс остаётся orphan.

**Действия:**
- Сохранить ссылку на `child` (ChildProcess) в замыкании `handleSignal`
- В `handleSignal`: вызвать `child.kill(signal)` перед cleanup
- Дождаться завершения child (или таймаут) перед `process.exit`

---

### 4. Убрать неиспользуемые импорты в `launcher/child.ts`

**Файл:** `src/launcher/child.ts`

Удалить `writeFile` из `node:fs/promises` и `existsSync` из `node:fs` — они не используются.

---

### 5. OpenCode адаптер: использовать `base` tier вместо `models[0]`

**Файл:** `src/adapters/opencode.ts`

Сейчас берётся `profile.models[0]` — произвольная первая модель. Нужно согласовать поведение с Claude Code адаптером: явно выбирать модель с `tier === 'base'`, fallback на первую.

**Действия:**
- Добавить логику `const base = profile.models.find(m => m.tier === 'base') ?? profile.models[0]`
- Использовать `base` вместо `first` для определения провайдера и модели
- Добавить тест на мульти-модельный профиль

---

### 6. Claude Code адаптер: валидировать что все тиры используют один провайдер или предупреждать

**Файл:** `src/adapters/claude-code.ts`

`buildConfig` берёт `apiKey`/`baseUrl` только из провайдера base-модели. Если small/smart привязаны к другим провайдерам — их credentials молча игнорируются.

**Действия:**
- Вариант A (минимальный): бросать ошибку если тиры ссылаются на разных провайдеров
- Вариант B (расширенный): поддержать разные provider credentials per tier (зависит от возможностей Claude Code)
- Добавить тест на случай разных провайдеров

---

## Зависимости

```
4 (unused imports) → нет зависимостей
1 (CLI commands)   → нет зависимостей
2 (cleanup)        → нет зависимостей
3 (signal)         → нет зависимостей (но логически вместе с 2)
5 (opencode tier)  → нет зависимостей
6 (claude-code validation) → нет зависимостей
```

## Порядок выполнения

1. Задача 4 — тривиальная, убрать импорты
2. Задача 1 — подключить CLI команды (самое важное для работоспособности)
3. Задачи 2 + 3 — исправить launcher/child (связаны логически)
4. Задача 5 — opencode тиры
5. Задача 6 — claude-code валидация
