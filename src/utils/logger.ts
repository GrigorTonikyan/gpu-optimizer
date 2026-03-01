import pc from 'picocolors';
import { join } from 'node:path';
import type { AppConfig, LogLevel } from '../types';
import { FsService } from '../services/fs';

/**
 * Priority map for log levels.
 * Higher numbers mean more critical.
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    fatal: 5,
};

/**
 * Centralized logging service.
 * Supports logging levels, colored console output, and file logging.
 */
export class Logger {
    private static currentLevel: LogLevel = 'info';
    private static logFile: string | null = null;
    private static isInitialized = false;

    /**
     * Initializes the logger based on the application configuration.
     */
    static async init(config: AppConfig): Promise<void> {
        this.currentLevel = config.verbosity;

        if (config.loggingEnabled) {
            try {
                const { getLogPath } = await import('../config');
                this.logFile = await getLogPath(config);

                if (this.logFile) {
                    const { mkdir } = await import('node:fs/promises');
                    const logDir = join(this.logFile, '..');
                    await mkdir(logDir, { recursive: true });

                    // Initial write check
                    const { appendFile } = await import('node:fs/promises');
                    await appendFile(this.logFile, `\n--- Session Start: ${new Date().toISOString()} ---\n`, 'utf-8');
                }
            } catch (e) {
                console.warn(pc.yellow(`⚠ Logger initialization failed: ${e}`));
                this.logFile = null;
            }
        }

        this.isInitialized = true;
    }

    private static shouldLog(level: LogLevel): boolean {
        // If we are in trace/debug mode, we should almost always log if initialized
        if (this.currentLevel === 'trace' || this.currentLevel === 'debug') return true;
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.currentLevel];
    }

    private static formatMessage(level: LogLevel, message: string): string {
        const timestamp = new Date().toISOString().split('T')[1]?.split('Z')[0] || new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}]`;

        switch (level) {
            case 'fatal': return pc.bgRed(pc.white(pc.bold(`${prefix} ${message}`)));
            case 'error': return pc.red(pc.bold(`${prefix} ${message}`));
            case 'warn': return pc.yellow(`${prefix} ${message}`);
            case 'info': return pc.blue(`${prefix} ${message}`);
            case 'debug': return pc.magenta(`${prefix} ${message}`);
            case 'trace': return pc.gray(`${prefix} ${message}`);
            default: return `${prefix} ${message}`;
        }
    }

    private static async writeToFile(level: LogLevel, message: string): Promise<void> {
        // We only log to file if it was initialized and enabled
        if (!this.logFile) return;

        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}\n`;

        try {
            const { appendFile, stat, rename, unlink } = await import('node:fs/promises');
            await appendFile(this.logFile, line, 'utf-8');

            // Log rotation: if file > 10MB, rotate it
            const stats = await stat(this.logFile);
            if (stats.size > 10 * 1024 * 1024) {
                const oldFile = `${this.logFile}.old`;
                if (await Bun.file(oldFile).exists()) {
                    await unlink(oldFile);
                }
                await rename(this.logFile, oldFile);
            }
        } catch {
            // Silently fail to avoid crashing the TUI
        }
    }

    static trace(msg: string): void {
        if (!this.shouldLog('trace')) return;
        console.log(this.formatMessage('trace', msg));
        this.writeToFile('trace', msg);
    }

    static debug(msg: string): void {
        if (!this.shouldLog('debug')) return;
        console.log(this.formatMessage('debug', msg));
        this.writeToFile('debug', msg);
    }

    static info(msg: string): void {
        if (!this.shouldLog('info')) return;
        console.log(this.formatMessage('info', msg));
        this.writeToFile('info', msg);
    }

    static warn(msg: string): void {
        if (!this.shouldLog('warn')) return;
        console.warn(this.formatMessage('warn', msg));
        this.writeToFile('warn', msg);
    }

    static error(msg: string, error?: any): void {
        if (!this.shouldLog('error')) return;
        const fullMsg = error ? `${msg}: ${error.message || error}` : msg;
        console.error(this.formatMessage('error', fullMsg));
        this.writeToFile('error', fullMsg);
    }

    static fatal(msg: string, error?: any): void {
        if (!this.shouldLog('fatal')) return;
        const fullMsg = error ? `${msg}: ${error.message || error}` : msg;
        console.error(this.formatMessage('fatal', fullMsg));
        this.writeToFile('fatal', fullMsg);
        process.exit(1);
    }
}
