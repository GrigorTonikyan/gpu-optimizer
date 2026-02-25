import type { AppConfig } from '../types';
import { loadConfig, saveConfig, resetConfig, getDefaultConfig } from '../config';

/**
 * Loads the current application configuration.
 * Returns defaults if no config file exists or if validation fails.
 */
export function getSettings(): AppConfig {
    return loadConfig();
}

/**
 * Updates the application configuration with the provided partial values.
 * Merges the update with the current config and persists the result.
 *
 * @param update - Partial AppConfig with the fields to update
 * @returns The merged and persisted configuration
 */
export function updateSettings(update: Partial<AppConfig>): AppConfig {
    const current = loadConfig();
    const merged: AppConfig = { ...current, ...update };
    saveConfig(merged);
    return merged;
}

/**
 * Resets all settings to their default values.
 *
 * @returns The default configuration after reset
 */
export function resetSettings(): AppConfig {
    return resetConfig();
}

/**
 * Returns the default configuration without persisting it.
 * Useful for displaying defaults in settings UI.
 */
export function getDefaults(): AppConfig {
    return getDefaultConfig();
}
