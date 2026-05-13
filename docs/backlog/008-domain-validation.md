# 008 - Добавить доменную валидацию providers/profiles

## Статус

Done

## Приоритет

P1

## Контекст

Zod schemas проверяют форму данных: UUID, строки, enum, массивы. Но доменные правила проверяются частично и разрозненно в CLI/TUI/adapters.

## Проблема

Можно создать profile с несуществующим providerId, моделью, которой нет у provider, некорректным multi-tier набором или дубликатами tier. Ошибка проявится поздно, уже при launch.

## Цель

Добавить единый слой доменной валидации AgentO config и использовать его в CLI/TUI managers.

## Scope

- Добавить модуль наподобие `src/config/validation.ts`.
- Проверять:
  - profile providerId существует;
  - model exists у provider или явно разрешена как custom model;
  - multi-model profile: все модели имеют tier;
  - multi-model profile: есть ровно или минимум один `base` согласно принятой политике;
  - duplicate tier policy явно определена;
  - provider name uniqueness policy;
  - baseUrl required для `openai-compatible`.
- Использовать validation в `addProvider`, `updateProvider`, `addProfile`, `updateProfile`.
- Обновить CLI/TUI ошибки на понятные сообщения.

## Вне scope

- UI redesign forms.
- Автоматическое получение списка моделей от провайдера.

## Критерии приемки

- Невалидный profile нельзя сохранить через CLI/TUI manager.
- Ошибки валидации содержат путь к проблеме и понятное сообщение.
- Adapters все еще делают defensive checks, но основная ошибка ловится раньше.
- Tests покрывают основные доменные нарушения.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- Нужно не сломать custom model flow в TUI Profiles.
- Нужно решить, разрешать ли несколько моделей с одним tier. Сейчас UI текст намекает на replacement visually, но фактического replacement нет.

