import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FsService } from '../services/fs';
import { homedir } from 'node:os';

describe('Config Module', () => {
    const backupEnv = { ...Bun.env };

    beforeEach(async () => {
        const { getConfigPath } = await import('../config');
        const configPath = await getConfigPath();
        if (existsSync(configPath)) {
            rmSync(configPath, { force: true });
        }
    });

    afterEach(() => {
        Object.assign(Bun.env, backupEnv);
        delete Bun.env.XDG_CONFIG_HOME;
        delete Bun.env.XDG_STATE_HOME;
    });

    it('FsService.resolveXdgPath respects XDG environment variable', () => {
        Bun.env.XDG_CONFIG_HOME = '/tmp/config';
        const result = FsService.resolveXdgPath('XDG_CONFIG_HOME', '.config', 'config.json');
        expect(result).toBe('/tmp/config/gpu-optimizer/config.json');
    });

    it('FsService.resolveXdgPath falls back to home directory when env is unset', () => {
        delete Bun.env.XDG_CONFIG_HOME;
        const result = FsService.resolveXdgPath('XDG_CONFIG_HOME', '.config', 'config.json');
        expect(result).toBe(join(homedir(), '.config', 'gpu-optimizer', 'config.json'));
    });

    it('getDefaultConfig returns valid defaults', async () => {
        const { getDefaultConfig } = await import('../config');
        const config = getDefaultConfig();

        expect(config.verbosity).toBe('info');
        expect(config.backupPaths.primary).toContain('backups');
    });

    it('loadConfig returns defaults when no config file exists', async () => {
        const { loadConfig, getDefaultConfig } = await import('../config');
        const config = await loadConfig();
        const defaults = getDefaultConfig();

        expect(config.verbosity).toBe(defaults.verbosity);
    });

    it('saveConfig creates config file and loadConfig reads it back', async () => {
        const { loadConfig, saveConfig, getConfigPath, getDefaultConfig } = await import('../config');
        const defaults = getDefaultConfig();
        const customConfig = {
            ...defaults,
            verbosity: 'debug' as const,
            dryMode: true,
        };

        await saveConfig(customConfig);

        const configPath = await getConfigPath();
        expect(existsSync(configPath)).toBe(true);

        const loaded = await loadConfig();
        expect(loaded.verbosity).toBe('debug');
        expect(loaded.dryMode).toBe(true);
    });

    it('loadConfig returns defaults for invalid JSON', async () => {
        const { loadConfig, getConfigPath } = await import('../config');

        const configPath = await getConfigPath();
        const dir = join(configPath, '..');
        mkdirSync(dir, { recursive: true });
        writeFileSync(configPath, '{ invalid json }', 'utf-8');

        const config = await loadConfig();
        expect(config.verbosity).toBe('info');
    });

    it('loadConfig returns defaults for schema-invalid config', async () => {
        const { loadConfig, getConfigPath } = await import('../config');

        const configPath = await getConfigPath();
        const dir = join(configPath, '..');
        mkdirSync(dir, { recursive: true });
        writeFileSync(configPath, JSON.stringify({ verbosity: 'wrong-level' }), 'utf-8');

        const config = await loadConfig();
        expect(config.verbosity).toBe('info');
    });

    it('resetConfig overwrites with defaults', async () => {
        const { resetConfig, saveConfig, getDefaultConfig } = await import('../config');
        const defaults = getDefaultConfig();

        await saveConfig({
            ...defaults,
            verbosity: 'fatal',
            dryMode: true,
        });

        const reset = await resetConfig();
        expect(reset.verbosity).toBe('info');
        expect(reset.dryMode).toBe(false);
    });
});
