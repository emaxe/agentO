# План: Исправление формы создания провайдера в TUI

## Контекст

Экран "Add Provider" в TUI (`src/tui/screens/Providers.tsx`) имеет критические проблемы:
- Вставка из буфера (Cmd+V) не работает — `input.length === 1` отбрасывает многосимвольный ввод
- Backspace ломает поле `type` (обрезает строку вместо toggle)
- Поле `type` выглядит как текстовое, но является toggle — путает пользователя
- Shift+Tab двигает фокус вперёд вместо назад
- apiKey замаскирован даже во время редактирования — невозможно проверить ввод
- Артефакты при вводе — всё из-за ручной реализации ввода через `useInput`

## Подход

Установить `ink-text-input` (v5.x, совместим с Ink 4.x) — готовый компонент текстового ввода для Ink с нативной поддержкой paste, курсора, focus. Рефакторить форму на отдельные `<TextInput>` компоненты для каждого поля.

## Файлы

- `package.json` — добавить зависимость `ink-text-input`
- `src/tui/screens/Providers.tsx` — рефакторинг формы добавления провайдера

## Шаги

### 1. Установить ink-text-input

```bash
npm install ink-text-input
```

### 2. Рефакторинг Providers.tsx — режим `add`

**Заменить**: ручной ввод символов через `useInput` + `input.length === 1`

**На**: отдельные `<TextInput>` компоненты для полей `name`, `apiKey`, `baseUrl`, `models`

**Ключевые изменения:**

a) **Управление фокусом**: Вместо `focusedField` + ручного `useInput` — использовать состояние `activeField` и рендерить `<TextInput>` с `focus={activeField === fieldName}`. Навигация Tab/Shift+Tab/↑↓ переключает `activeField`.

b) **Поле `type`**: Рендерить как toggle с визуальным индикатором `◀ anthropic ▶` или `[ anthropic | openai-compatible ]`. При Enter/Space — переключать. Backspace не должен влиять.

c) **Поле `apiKey`**: В `<TextInput>` передать `mask="*"` чтобы скрывать ввод, НО оставить видимыми последние 4 символа. Либо просто показывать полностью во время редактирования — маскировать только в списке (режим `list`).

d) **Вставка**: `<TextInput>` из `ink-text-input` нативно поддерживает paste (обрабатывает многосимвольный `input`).

e) **Навигация между полями**: `useInput` остаётся только для: Tab (вниз), Shift+Tab (вверх), ↑/↓ (вверх/вниз), Esc (отмена), Enter на последнем поле (сабмит).

f) **Submit**: Enter на последнем поле (models) или отдельная "кнопка" Submit.

### 3. Структура формы

```
Add Provider

  Name:     [___________________]     ← TextInput, focus
  Type:     ◀ anthropic ▶            ← toggle, Enter/Space
  API Key:  [___________________]     ← TextInput
  Base URL: [___________________]     ← TextInput (optional)
  Models:   [___________________]     ← TextInput, comma-separated

  Tab/↑↓: navigate | Enter on Models: save | Esc: cancel
```

### 4. Обработка useInput в режиме add (после рефакторинга)

```typescript
useInput((input, key) => {
  if (mode !== 'add') return; // список и delete обрабатываются отдельно
  
  if (key.escape) { setMode('list'); return; }
  
  // Навигация между полями
  if (key.downArrow || (key.tab && !key.shift)) {
    setActiveField(next);
    return;
  }
  if (key.upArrow || (key.tab && key.shift)) {
    setActiveField(prev);
    return;
  }
  
  // Toggle для type
  if (activeField === 'type' && (key.return || input === ' ')) {
    toggleType();
    return;
  }
  
  // Submit на последнем поле
  if (activeField === 'models' && key.return) {
    submitForm();
    return;
  }
});
```

Текстовый ввод (включая paste) полностью делегируется `<TextInput>` — в `useInput` он не обрабатывается.

### 5. Аналогичный баг в Profiles.tsx

Файл `src/tui/screens/Profiles.tsx` содержит ту же проблему с `input.length === 1`. Нужно аналогично рефакторить форму добавления профиля, но это менее критично (два поля vs пять).

**Scope**: Если останется время — исправить. Минимальный фикс: заменить `input.length === 1` на `input.length >= 1`.

## Проверка

1. `npm run build` — без ошибок
2. `npm test` — 20/20 тестов проходят
3. `agento` → Providers → `a` (add):
   - Поле Name: ввести текст, вставить из буфера (Cmd+V) — текст появляется
   - Tab → Type: Enter/Space переключает anthropic ↔ openai-compatible
   - Tab → API Key: вставить длинный API key через Cmd+V — всё отображается
   - Tab → Base URL: ввести URL или оставить пустым
   - Tab → Models: ввести через запятую, Enter → провайдер сохраняется
   - Esc на любом шаге — возврат к списку
   - Проверить `~/.agento/config.json` — провайдер добавлен с правильными полями
