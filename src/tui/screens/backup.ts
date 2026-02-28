import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome } from '../app';
import { getSettings } from '../../controllers';
import { listBackups, deleteBackup, rollbackToSnapshot, exportBackup, importBackup, createManualBackup } from '../../controllers';
import { rebuildInitramfs } from '../../controllers';
import type { SystemProfile } from '../../types';

/**
 * TUI screen for backup management.
 * Provides submenu for: List/View, Delete, Export, Import, Rollback.
 *
 * @param profile - The SystemProfile (needed for initramfs rebuild after rollback)
 */
export async function showBackupManagement(profile: SystemProfile): Promise<void> {
    while (true) {
        const config = await getSettings();
        refreshChrome(config);
        clearContent();

        let row = 4;
        terminal.moveTo(3, row++);
        terminal.write(pc.bold(pc.cyan('Backup Management')));
        row++;

        const menuItems = [
            '🆕  Create New Backup',
            '📋  List Backups',
            '🗑️   Delete Backup',
            '📤  Export Backup',
            '📥  Import Backup',
            '↩️   Rollback to Snapshot',
            '← Back',
        ];

        const response = await terminal.singleColumnMenu(menuItems, {
            y: row,
            cancelable: true,
            exitOnUnexpectedKey: true,
        });

        const action = response.canceled ? 6
            : (response.unexpectedKey === 'q' || response.unexpectedKey === 'ESCAPE') ? 6
                : response.selectedIndex;

        if (action === 6) return;

        if (action === 0) {
            await showCreateBackup();
        } else if (action === 1) {
            await showBackupList();
        } else if (action === 2) {
            await showDeleteBackup();
        } else if (action === 3) {
            await showExportBackup();
        } else if (action === 4) {
            await showImportBackup();
        } else if (action === 5) {
            await showRollback(profile);
        }
    }
}

/**
 * Triggers a manual system backup and shows progress.
 */
async function showCreateBackup(): Promise<void> {
    const config = await getSettings();
    refreshChrome(config);
    clearContent();

    terminal.moveTo(3, 4);
    terminal.write(pc.cyan('Creating system backup...'));

    try {
        const record = await createManualBackup();
        const successCfg = await getSettings();
        refreshChrome(successCfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.green('✓ Backup created successfully!'));
        terminal.moveTo(3, 6);
        terminal.write(pc.dim(`ID:   ${record.id}`));
        terminal.moveTo(3, 7);
        terminal.write(pc.dim(`Files: ${record.files.length}`));
    } catch (e: any) {
        const errCfg = await getSettings();
        refreshChrome(errCfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.red(`✗ Backup failed: ${e.message}`));
    }

    terminal.moveTo(3, 9);
    terminal.write(pc.dim('Press any key to go back...'));
    await waitForKey();
}

/**
 * Lists all backups in a formatted view.
 */
async function showBackupList(): Promise<void> {
    const config = await getSettings();
    refreshChrome(config);
    clearContent();

    const backups = await listBackups();
    let row = 4;

    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.cyan('Available Backups')));
    row++;

    if (backups.length === 0) {
        terminal.moveTo(3, row++);
        terminal.write(pc.dim('No backups found.'));
    } else {
        for (const backup of backups) {
            terminal.moveTo(3, row++);
            terminal.write(pc.bold(backup.id));
            terminal.write(`  │  ${backup.date}  │  ${backup.files.length} file(s)`);
        }
    }

    row += 2;
    terminal.moveTo(3, row);
    terminal.write(pc.dim('Press any key to go back...'));
    await waitForKey();
}

/**
 * Allows the user to select and delete a backup.
 */
async function showDeleteBackup(): Promise<void> {
    const backups = await listBackups();

    if (backups.length === 0) {
        const cfg = await getSettings();
        refreshChrome(cfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.dim('No backups to delete.'));
        terminal.moveTo(3, 6);
        terminal.write(pc.dim('Press any key to go back...'));
        await waitForKey();
        return;
    }

    const cfg = await getSettings();
    refreshChrome(cfg);
    clearContent();

    let row = 4;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.cyan('Delete Backup')));
    row++;

    const items = backups.map(b => `${b.date} (${b.files.length} files) — ${b.id}`);
    items.push('← Cancel');

    const response = await terminal.singleColumnMenu(items, {
        y: row,
        selectedBg: 'red',
        cancelable: true,
    });

    const selected = response.canceled ? items.length - 1 : response.selectedIndex;

    if (selected >= backups.length) return;

    const backup = backups[selected]!;

    const confirmCfg = await getSettings();
    refreshChrome(confirmCfg);
    clearContent();
    terminal.moveTo(3, 4);
    terminal.write(pc.bold(pc.red(`Delete backup ${backup.id}? [y/N] `)));

    const confirmed = await new Promise<boolean>((resolve) => {
        const handler = (key: string) => {
            terminal.removeKeyListener(handler);
            resolve(key === 'y' || key === 'Y');
        };
        terminal.onKey(handler);
    });

    if (confirmed) {
        try {
            await deleteBackup(backup.id);
            terminal.moveTo(3, 6);
            terminal.write(pc.green('✓ Backup deleted.'));
        } catch (e: any) {
            terminal.moveTo(3, 6);
            terminal.write(pc.red(`✗ ${e.message}`));
        }
        terminal.moveTo(3, 8);
        terminal.write(pc.dim('Press any key...'));
        await waitForKey();
    }
}

/**
 * Export a backup to a tar.gz file.
 */
async function showExportBackup(): Promise<void> {
    const cfg = await getSettings();
    const backups = await listBackups();

    if (backups.length === 0) {
        refreshChrome(cfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.dim('No backups to export.'));
        terminal.moveTo(3, 6);
        terminal.write(pc.dim('Press any key...'));
        await waitForKey();
        return;
    }

    refreshChrome(cfg);
    clearContent();

    let row = 4;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.cyan('Export Backup')));
    row++;

    const items = backups.map(b => `${b.date} — ${b.id}`);
    items.push('← Cancel');

    const response = await terminal.singleColumnMenu(items, {
        y: row,
        cancelable: true,
    });

    const selected = response.canceled ? items.length - 1 : response.selectedIndex;

    if (selected >= backups.length) return;

    const backup = backups[selected]!;
    const outputPath = `/tmp/gpu-optimizer-backup-${backup.id}.tar.gz`;

    try {
        await exportBackup(backup.id, outputPath);
        const successCfg = await getSettings();
        refreshChrome(successCfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.green(`✓ Exported to: ${outputPath}`));
    } catch (e: any) {
        const errCfg = await getSettings();
        refreshChrome(errCfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.red(`✗ Export failed: ${e.message}`));
    }

    terminal.moveTo(3, 6);
    terminal.write(pc.dim('Press any key...'));
    await waitForKey();
}

/**
 * Import a backup from a tar.gz archive.
 */
async function showImportBackup(): Promise<void> {
    const cfg = await getSettings();
    refreshChrome(cfg);
    clearContent();

    const archivePath = await terminal.inputField({
        cancelable: true,
        prompt: 'Enter path to .tar.gz archive',
    });

    if (!archivePath) return;

    try {
        const record = await importBackup(archivePath.trim());
        const successCfg = await getSettings();
        refreshChrome(successCfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.green(`✓ Imported backup: ${record.id} (${record.files.length} files)`));
    } catch (e: any) {
        const errCfg = await getSettings();
        refreshChrome(errCfg);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.red(`✗ Import failed: ${e.message}`));
    }

    terminal.moveTo(3, 6);
    terminal.write(pc.dim('Press any key...'));
    await waitForKey();
}

/**
 * Rollback to a selected backup snapshot.
 */
async function showRollback(profile: SystemProfile): Promise<void> {
    const config = await getSettings();
    const backups = await listBackups();

    if (backups.length === 0) {
        refreshChrome(config);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.dim('No backups available for rollback.'));
        terminal.moveTo(3, 6);
        terminal.write(pc.dim('Press any key...'));
        await waitForKey();
        return;
    }

    refreshChrome(config);
    clearContent();

    let row = 4;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.cyan('Rollback to Snapshot')));
    row++;

    const items = backups.map(b => `${b.date} (${b.files.length} files) — ${b.id}`);
    items.push('← Cancel');

    const response = await terminal.singleColumnMenu(items, {
        y: row,
        selectedBg: 'yellow',
        cancelable: true,
    });

    const selected = response.canceled ? items.length - 1 : response.selectedIndex;

    if (selected >= backups.length) return;

    const backup = backups[selected]!;

    const confirmCfg = await getSettings();
    refreshChrome(confirmCfg);
    clearContent();
    terminal.moveTo(3, 4);
    terminal.write(pc.bold(pc.yellow(`Restore backup ${backup.id}? This overwrites current configs. [y/N] `)));

    const confirmed = await new Promise<boolean>((resolve) => {
        const handler = (key: string) => {
            terminal.removeKeyListener(handler);
            resolve(key === 'y' || key === 'Y');
        };
        terminal.onKey(handler);
    });

    if (!confirmed) return;

    try {
        const restored = await rollbackToSnapshot(backup.id);
        const currentConfig = await getSettings();
        refreshChrome(currentConfig);
        clearContent();

        let row = 4;
        terminal.moveTo(3, row++);
        terminal.write(pc.green(`✓ Restored ${restored.length} file(s):`));
        for (const file of restored) {
            terminal.moveTo(3, row++);
            terminal.write(pc.green(`  ✓ ${file}`));
        }

        if (profile.initramfs !== 'Unknown') {
            row++;
            terminal.moveTo(3, row++);
            terminal.write(`Rebuild initramfs using ${profile.initramfs}? [y/N] `);

            const shouldRebuild = await new Promise<boolean>((resolve) => {
                const handler = (key: string) => {
                    terminal.removeKeyListener(handler);
                    resolve(key === 'y' || key === 'Y');
                };
                terminal.onKey(handler);
            });

            if (shouldRebuild) {
                try {
                    await rebuildInitramfs(profile);
                    terminal.moveTo(3, row++);
                    terminal.write(pc.green('✓ Initramfs rebuilt.'));
                } catch (e: any) {
                    terminal.moveTo(3, row++);
                    terminal.write(pc.red(`✗ Rebuild failed: ${e.message}`));
                }
            }
        }

        terminal.moveTo(3, row + 1);
        terminal.write(pc.bold(pc.green('Rollback complete!')));
    } catch (e: any) {
        const errConfig = await getSettings();
        refreshChrome(errConfig);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.red(`✗ Rollback failed: ${e.message}`));
    }

    terminal.moveTo(3, terminal.height - 2);
    terminal.write(pc.dim('Press any key...'));
    await waitForKey();
}

/**
 * Waits for any single keypress.
 */
function waitForKey(): Promise<void> {
    return new Promise<void>((resolve) => {
        const handler = () => {
            terminal.removeKeyListener(handler);
            resolve();
        };
        terminal.onKey(handler);
    });
}
