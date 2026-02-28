import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome } from '../app';
import { getSettings, updateSettings, resetSettings } from '../../controllers';
import type { AppConfig, LogLevel } from '../../types';

/**
 * TUI screen for the settings editor.
 * Navigate with arrow keys, toggle/edit values with Enter,
 * and persist changes immediately.
 */
export async function showSettings(): Promise<void> {
    let config = await getSettings();
    let cursor = 0;

    const VERBOSITY_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

    const fields = [
        { id: 'dryMode', label: 'Dry Mode (Simulation)', type: 'toggle' as const },
        { id: 'verbosity', label: 'Verbosity Level', type: 'select' as const, options: VERBOSITY_LEVELS },
        { id: 'loggingEnabled', label: 'File Logging', type: 'toggle' as const },
        { id: 'logDirectory', label: 'Log Directory', type: 'text' as const },
        { id: 'backupDirectory', label: 'Backup Directory', type: 'text' as const },
    ];

    function getFieldValue(id: string): any {
        if (id === 'logDirectory') return config.paths.logs;
        if (id === 'backupDirectory') return config.backupPaths.primary;
        return (config as any)[id];
    }

    async function setFieldValue(id: string, value: any): Promise<void> {
        let changes: Partial<AppConfig> = {};
        if (id === 'logDirectory') {
            changes = { paths: { ...config.paths, logs: String(value) } };
        } else if (id === 'backupDirectory') {
            changes = { backupPaths: { ...config.backupPaths, primary: String(value) } };
        } else {
            changes = { [id]: value };
        }
        config = await updateSettings(changes);
    }

    function render(): void {
        refreshChrome();
        clearContent();

        let row = 4;
        terminal.moveTo(3, row++);
        terminal.write(pc.bold(pc.cyan('Settings')));
        terminal.moveTo(3, row++);
        terminal.write(pc.dim('↑↓ Navigate  │  Enter: Edit  │  r: Reset to defaults  │  q: Back'));
        row++;

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i]!;
            const isCursor = i === cursor;
            const value = getFieldValue(field.id);

            terminal.moveTo(3, row + i);

            if (isCursor) {
                terminal.bgCyanBlack(' ▸ ');
            } else {
                terminal.write('   ');
            }

            terminal.write(` ${field.label}: `);

            if (field.id === 'verbosity') {
                terminal.write(pc.bold(pc.yellow(String(value).toUpperCase())));
            } else if (field.type === 'toggle') {
                terminal.write(value ? pc.bold(pc.green('ON')) : pc.dim('OFF'));
            } else {
                terminal.write(pc.bold(String(value ?? pc.dim('undefined'))));
            }
        }
    }

    render();

    return new Promise<void>((resolve) => {
        const handler = async (key: string) => {
            if (key === 'q' || key === 'ESCAPE') {
                terminal.removeKeyListener(handler);
                resolve();
                return;
            }

            if (key === 'r') {
                config = await resetSettings();
                render();
                return;
            }

            if (key === 'UP' && cursor > 0) {
                cursor--;
                render();
                return;
            }

            if (key === 'DOWN' && cursor < fields.length - 1) {
                cursor++;
                render();
                return;
            }

            if (key === 'ENTER') {
                const field = fields[cursor]!;

                if (field.type === 'toggle') {
                    const current = getFieldValue(field.id) as boolean;
                    await setFieldValue(field.id, !current);
                    render();
                } else if (field.type === 'select') {
                    const current = getFieldValue(field.id) as LogLevel;
                    const idx = VERBOSITY_LEVELS.indexOf(current);
                    const next = VERBOSITY_LEVELS[(idx + 1) % VERBOSITY_LEVELS.length];
                    await setFieldValue(field.id, next);
                    render();
                } else if (field.type === 'text') {
                    terminal.removeKeyListener(handler);

                    const editRow = 4 + 3 + cursor; // (Start Row 4) + (Title + Help Row + Blank Row) + cursor
                    terminal.moveTo(3, editRow + fields.length + 2);
                    terminal.write(`New value for ${field.label}: `);

                    const currentValue = getFieldValue(field.id);
                    const newValue = await terminal.inputField({
                        default: currentValue ? String(currentValue) : '',
                        cancelable: true,
                    });

                    if (newValue !== undefined) {
                        await setFieldValue(field.id, newValue.trim());
                    }
                    render();
                    terminal.onKey(handler);
                }
            }
        };
        terminal.onKey(handler);
    });
}
