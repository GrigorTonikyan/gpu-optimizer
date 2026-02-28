import { z } from 'zod';
import { join } from 'node:path';
import type { AppConfig, LogLevel } from '../types';
import { FsService } from '../services/fs';

/**
 * Zod schema for validating the persisted application configuration.
 */
const AppConfigSchema = z.object({
    verbosity: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
    loggingEnabled: z.boolean(),
    paths: z.object({
        config: z.string().optional(),
        data: z.string().optional(),
        logs: z.string().optional(),
    }),
    backupPaths: z.object({
        primary: z.string(),
        sources: z.array(z.string()),
    }),
    dryMode: z.boolean(),
});

/**
 * Returns the resolved path to the config file (with override support).
 */
export async function getConfigPath(): Promise<string> {
    // We check for self-override (meta-config) if we ever implement one, 
    // but for now we follow the standard XDG path.
    return FsService.resolveXdgPath('XDG_CONFIG_HOME', '.config', 'config.json');
}

/**
 * Returns the resolved path to the log file.
 */
export async function getLogPath(config?: AppConfig): Promise<string> {
    const logDir = config?.paths.logs || FsService.resolveXdgPath('XDG_STATE_HOME', '.local/state', 'logs');
    return join(logDir, 'gpu-optimizer.log');
}

/**
 * Returns the primary resolved path to the backup directory.
 */
export function getBackupDirectory(config?: AppConfig): string {
    return config?.backupPaths.primary || FsService.resolveXdgPath('XDG_STATE_HOME', '.local/state', 'backups');
}

/**
 * Constructs the default configuration.
 */
export function getDefaultConfig(): AppConfig {
    return {
        verbosity: 'info',
        loggingEnabled: false,
        paths: {},
        backupPaths: {
            primary: FsService.resolveXdgPath('XDG_STATE_HOME', '.local/state', 'backups'),
            sources: [],
        },
        dryMode: false,
    };
}

/**
 * Loads the application config.
 */
export async function loadConfig(): Promise<AppConfig> {
    const configPath = await getConfigPath();
    const data = await FsService.readJson<any>(configPath);

    if (!data) {
        return getDefaultConfig();
    }

    try {
        // Handle legacy numeric verbosity migration if needed
        if (typeof data.verbosity === 'number') {
            const levels: LogLevel[] = ['error', 'info', 'debug'];
            data.verbosity = levels[data.verbosity] || 'info';
        }

        // Handle path migration from v0.3.0 schema
        if (data.logDirectory && !data.paths) {
            data.paths = { logs: data.logDirectory };
            delete data.logDirectory;
        }
        if (data.backupDirectory && !data.backupPaths) {
            data.backupPaths = { primary: data.backupDirectory, sources: [] };
            delete data.backupDirectory;
        }

        return AppConfigSchema.parse(data);
    } catch (e) {
        console.warn('Config validation failed, using defaults:', e);
        return getDefaultConfig();
    }
}

/**
 * Persists the given configuration.
 */
export async function saveConfig(config: AppConfig): Promise<void> {
    const configPath = await getConfigPath();
    await FsService.writeJson(configPath, config);
}

/**
 * Resets the configuration to defaults.
 */
export async function resetConfig(): Promise<AppConfig> {
    const defaults = getDefaultConfig();
    await saveConfig(defaults);
    return defaults;
}
