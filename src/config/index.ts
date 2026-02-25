import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../types';

/**
 * Zod schema for validating the persisted application configuration.
 * Ensures corrupt or hand-edited JSON files are caught on load rather
 * than surfacing as runtime type errors deep in the application.
 */
const AppConfigSchema = z.object({
    verbosity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    loggingEnabled: z.boolean(),
    logDirectory: z.string(),
    backupDirectory: z.string(),
    dryMode: z.boolean(),
});

/**
 * Resolves an XDG base directory path, respecting the environment variable
 * override and falling back to the specification default.
 *
 * @param envVar - The XDG environment variable name (e.g. `XDG_CONFIG_HOME`)
 * @param fallback - The fallback relative to `$HOME` (e.g. `.config`)
 * @param segments - Additional path segments appended after the app subdirectory
 * @returns The fully resolved absolute path
 */
export function resolveXdgPath(envVar: string, fallback: string, ...segments: string[]): string {
    const base = Bun.env[envVar] || join(homedir(), fallback);
    return join(base, 'gpu-optimizer', ...segments);
}

/**
 * Returns the resolved path to the XDG-compliant config file.
 */
export function getConfigPath(): string {
    return resolveXdgPath('XDG_CONFIG_HOME', '.config', 'config.json');
}

/**
 * Returns the resolved path to the XDG-compliant log directory.
 */
export function getLogDirectory(): string {
    return resolveXdgPath('XDG_STATE_HOME', '.local/state', 'logs');
}

/**
 * Returns the resolved path to the XDG-compliant backup directory.
 */
export function getBackupDirectory(): string {
    return resolveXdgPath('XDG_STATE_HOME', '.local/state', 'backups');
}

/**
 * Constructs the default configuration using XDG-resolved paths.
 * This is used as the initial config when no file exists yet,
 * and as a fallback when the persisted config fails validation.
 */
export function getDefaultConfig(): AppConfig {
    return {
        verbosity: 1,
        loggingEnabled: false,
        logDirectory: getLogDirectory(),
        backupDirectory: getBackupDirectory(),
        dryMode: false,
    };
}

/**
 * Loads the application config from `$XDG_CONFIG_HOME/gpu-optimizer/config.json`.
 * If the file does not exist or fails validation, returns the default config.
 */
export function loadConfig(): AppConfig {
    const configPath = getConfigPath();

    if (!existsSync(configPath)) {
        return getDefaultConfig();
    }

    try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return AppConfigSchema.parse(parsed);
    } catch {
        return getDefaultConfig();
    }
}

/**
 * Persists the given configuration to `$XDG_CONFIG_HOME/gpu-optimizer/config.json`.
 * Creates the parent directory tree if it does not already exist.
 *
 * @param config - The validated AppConfig to persist
 */
export function saveConfig(config: AppConfig): void {
    const configPath = getConfigPath();
    const dir = dirname(configPath);

    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Resets the configuration to defaults by overwriting the config file.
 * @returns The freshly written default config
 */
export function resetConfig(): AppConfig {
    const defaults = getDefaultConfig();
    saveConfig(defaults);
    return defaults;
}
