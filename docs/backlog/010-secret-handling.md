# 010 - Снизить риск хранения API keys в конфигах и backups

## Статус

Done

## Приоритет

P1

## Контекст

Provider API keys хранятся в `~/.agento/config.json`, могут попадать в generated agent configs и backups. Некоторые адаптеры уже используют env injection, но не все.

## Проблема

Backups и agent configs могут содержать secrets в plaintext. Это особенно рискованно для CLI-инструмента, который пишет файлы в home/project директории.

## Цель

Снизить поверхность хранения secrets и определить долгосрочную стратегию secret storage.

## Scope

- Провести audit всех мест записи API keys.
- Определить целевую политику:
  - хранить keys в AgentO config plaintext с `0600`, но не писать в backups;
  - или хранить через OS keychain;
  - или хранить env var references.
- Добавить redaction для logs/status/errors.
- По возможности изменить adapters на env references там, где агент поддерживает это без ухудшения UX.
- Добавить tests, что backups не содержат provider API keys, если выбрана redaction policy.

## Вне scope

- Немедленная полноценная интеграция с macOS Keychain/1Password, если это требует отдельного продукта.
- Breaking migration без плана обратной совместимости.

## Критерии приемки

- Документирована политика хранения secrets.
- Backups не содержат secrets без необходимости.
- `provider list` продолжает маскировать ключи.
- Generated configs используют env references там, где это поддерживается адаптером.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Дополнительно:

```bash
rg "sk-|apiKey|AUTH_TOKEN|API_KEY" ~/.agento/backups
```

## Риски

- Некоторые агенты могут требовать secret в своем конфиге. Нужно фиксировать исключения по adapter.
- Keychain integration может усложнить headless/server сценарии.

