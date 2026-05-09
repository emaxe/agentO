import type { Profile, Provider } from '../config/schema.js';
import type { LaunchScope } from '../config/schema.js';

/** Режим области действия конфига агента */
export type { LaunchScope };

/** Базовый тип конфига агента (произвольный JSON-объект) */
export type AgentConfig = Record<string, unknown>;

/** Пути к конфигам агента для разных scope */
export interface AgentConfigPaths {
  global: string;
  project: string;
}

/** Интерфейс адаптера агента */
export interface AgentAdapter {
  /** Уникальный идентификатор агента (например 'claude-code') */
  readonly id: string;

  /** Отображаемое имя агента */
  readonly displayName: string;

  /** Флаг разработки: скрыт из UI/CLI по умолчанию */
  readonly dev?: boolean;

  /** Возвращает пути к конфигам агента (global и project) */
  configPaths(cwd?: string): AgentConfigPaths;

  /** Читает текущий конфиг агента для указанного scope */
  readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null>;

  /** Генерирует конфиг агента из профиля AgentO и списка провайдеров.
   * Использует первую пару (провайдер, модель) из профиля.
   */
  buildConfig(profile: Profile, providers: Provider[]): AgentConfig;

  /** Записывает конфиг агента для указанного scope */
  writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string): Promise<void>;

  /**
   * Опционально: возвращает env-переменные, которые нужно инжектировать при запуске агента.
   * Используется адаптерами (например Codex), которые хранят ключ API как ссылку на env-переменную.
   */
  buildEnv?(profile: Profile, providers: Provider[]): Record<string, string>;
}

/** Карта зарегистрированных адаптеров */
export type AdapterRegistry = Map<string, AgentAdapter>;
