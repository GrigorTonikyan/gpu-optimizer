import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome } from '../app';
import { getSettings, updateSettings, resetSettings } from '../../controllers';
import type { AppConfig } from '../../types';

/**
 * TUI screen for the settings editor.
 * Navigate with arrow keys, toggle/edit values with Enter,
 * and persist changes immediately.
 */
export async function showSettings(): Promise<void> {
    let config = getSettings();
    let cursor = 0;

    const fields: Array<{
        key: keyof AppConfig;
        label: string;
        type: 'toggle' | 'select' | 'text';
        options?: string[];
    }> = [
            { key: 'dryMode', label: 'Dry Mode (Simulation)', type: 'toggle' },
            { key: 'verbosity', label: 'Verbosity Level', type: 'select', options: ['0 — Quiet', '1 — Normal', '2 — Verbose'] },
            { key: 'loggingEnabled', label: 'File Logging', type: 'toggle' },
            { key: 'logDirectory', label: 'Log Directory', type: 'text' },
            { key: 'backupDirectory', label: 'Backup Directory', type: 'text' },
        ];

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
            const value = config[field.key];

            terminal.moveTo(3, row + i);

            if (isCursor) {
                terminal.bgCyanBlack(' ▸ ');
            } else {
                terminal.write('   ');
            }

            terminal.write(` ${field.label}: `);

            if (field.type === 'toggle') {
                terminal.write(value ? pc.bold(pc.green('ON')) : pc.dim('OFF'));
            } else if (field.type === 'select') {
                const idx = value as number;
                terminal.write(pc.bold(field.options?.[idx] ?? String(value)));
            } else {
                terminal.write(pc.bold(String(value)));
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
                config = resetSettings();
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
                    const current = config[field.key] as boolean;
                    config = updateSettings({ [field.key]: !current });
                    render();
                } else if (field.type === 'select') {
                    const current = config[field.key] as number;
                    const next = ((current + 1) % 3) as 0 | 1 | 2;
                    config = updateSettings({ [field.key]: next });
                    render();
                } else if (field.type === 'text') {
                    terminal.removeKeyListener(handler);

                    const editRow = 4 + 3 + cursor;
                    terminal.moveTo(3, editRow + fields.length + 2);
                    terminal.write(`New value for ${field.label}: `);

                    const newValue = await terminal.inputField({
                        default: String(config[field.key]),
                        cancelable: true,
                    });

                    if (newValue) {
                        config = updateSettings({ [field.key]: newValue.trim() });
                    }
                    render();
                    terminal.onKey(handler);
                }
            }
        };
        terminal.onKey(handler);
    });
}
