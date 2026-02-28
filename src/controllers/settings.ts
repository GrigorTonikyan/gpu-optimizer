import type { AppConfig } from '../types';
import { loadConfig, saveConfig, resetConfig, getDefaultConfig } from '../config';

/**
 * Loads the current application settings.
 * Pulls from the configuration file and returns a validated AppConfig object.
 * 
 * @returns A promise resolving to the current AppConfig
 */
export async function getSettings(): Promise<AppConfig> {
    return await loadConfig();
}

/**
 * Updates application settings with partial changes.
 * Merges the provided changes with the current configuration and persists them.
 * 
 * @param changes - Partial AppConfig object containing updates
 * @returns A promise resolving to the fully updated AppConfig
 */
export async function updateSettings(changes: Partial<AppConfig>): Promise<AppConfig> {
    const current = await loadConfig();
    const merged: AppConfig = { ...current, ...changes };
    await saveConfig(merged);
    return merged;
}

/**
 * Resets all settings to their default values.
 *
 * @returns The default configuration after reset
 */
export async function resetSettings(): Promise<AppConfig> {
    return await resetConfig();
}

/**
 * Returns the default application settings.
 * Useful for initializing new installations or comparison.
 * 
 * @returns The default AppConfig object
 */
export function getDefaults(): AppConfig {
    return getDefaultConfig();
}
