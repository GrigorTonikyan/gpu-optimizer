import { getTerm, clearContent, refreshChrome } from '../app';
import { listBackups, deleteBackup, rollbackToSnapshot, exportBackup, importBackup } from '../../controllers';
import { rebuildInitramfs } from '../../controllers';
import type { SystemProfile } from '../../types';

/**
 * TUI screen for backup management.
 * Provides submenu for: Create (manual), List/View, Delete, Export, Import, Rollback.
 *
 * @param profile - The SystemProfile (needed for initramfs rebuild after rollback)
 */
export async function showBackupManagement(profile: SystemProfile): Promise<void> {
    const term = getTerm();

    while (true) {
        refreshChrome();
        clearContent();

        let row = 4;
        term.moveTo(3, row++);
        term.bold.cyan('Backup Management');
        row++;

        const menuItems = [
            '📋  List Backups',
            '🗑️   Delete Backup',
            '📤  Export Backup',
            '📥  Import Backup',
            '↩️   Rollback to Snapshot',
            '← Back',
        ];

        const action = await new Promise<number>((resolve) => {
            term.singleColumnMenu(menuItems, {
                y: row,
                selectedStyle: term.bold.bgCyan.black,
                style: term.white,
                cancelable: true,
                exitOnUnexpectedKey: true,
            }, (error: any, response: any) => {
                if (error || !response || response.canceled) {
                    resolve(5);
                    return;
                }
                if (response.unexpectedKey === 'q' || response.unexpectedKey === 'ESCAPE') {
                    resolve(5);
                    return;
                }
                resolve(response.selectedIndex);
            });
        });

        if (action === 5) return;

        if (action === 0) {
            await showBackupList();
        } else if (action === 1) {
            await showDeleteBackup();
        } else if (action === 2) {
            await showExportBackup();
        } else if (action === 3) {
            await showImportBackup();
        } else if (action === 4) {
            await showRollback(profile);
        }
    }
}

/**
 * Lists all backups in a formatted view.
 */
async function showBackupList(): Promise<void> {
    const term = getTerm();
    refreshChrome();
    clearContent();

    const backups = listBackups();
    let row = 4;

    term.moveTo(3, row++);
    term.bold.cyan('Available Backups');
    row++;

    if (backups.length === 0) {
        term.moveTo(3, row++);
        term.dim('No backups found.');
    } else {
        for (const backup of backups) {
            term.moveTo(3, row++);
            term.bold(backup.id);
            term(`  │  ${backup.date}  │  ${backup.files.length} file(s)`);
        }
    }

    row += 2;
    term.moveTo(3, row);
    term.dim('Press any key to go back...');
    await waitForKey();
}

/**
 * Allows the user to select and delete a backup.
 */
async function showDeleteBackup(): Promise<void> {
    const term = getTerm();
    const backups = listBackups();

    if (backups.length === 0) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.dim('No backups to delete.');
        term.moveTo(3, 6);
        term.dim('Press any key to go back...');
        await waitForKey();
        return;
    }

    refreshChrome();
    clearContent();

    let row = 4;
    term.moveTo(3, row++);
    term.bold.cyan('Delete Backup');
    row++;

    const items = backups.map(b => `${b.date} (${b.files.length} files) — ${b.id}`);
    items.push('← Cancel');

    const selected = await new Promise<number>((resolve) => {
        term.singleColumnMenu(items, {
            y: row,
            selectedStyle: term.bold.bgRed.white,
            style: term.white,
            cancelable: true,
        }, (error: any, response: any) => {
            if (error || !response || response.canceled) {
                resolve(items.length - 1);
                return;
            }
            resolve(response.selectedIndex);
        });
    });

    if (selected >= backups.length) return;

    const backup = backups[selected]!;

    refreshChrome();
    clearContent();
    term.moveTo(3, 4);
    term.red.bold(`Delete backup ${backup.id}? [y/N] `);

    const confirmed = await new Promise<boolean>((resolve) => {
        const handler = (key: string) => {
            term.removeListener('key', handler);
            resolve(key === 'y' || key === 'Y');
        };
        term.on('key', handler);
    });

    if (confirmed) {
        try {
            deleteBackup(backup.id);
            term.moveTo(3, 6);
            term.green('✓ Backup deleted.');
        } catch (e: any) {
            term.moveTo(3, 6);
            term.red(`✗ ${e.message}`);
        }
        term.moveTo(3, 8);
        term.dim('Press any key...');
        await waitForKey();
    }
}

/**
 * Export a backup to a tar.gz file.
 */
async function showExportBackup(): Promise<void> {
    const term = getTerm();
    const backups = listBackups();

    if (backups.length === 0) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.dim('No backups to export.');
        term.moveTo(3, 6);
        term.dim('Press any key...');
        await waitForKey();
        return;
    }

    refreshChrome();
    clearContent();

    let row = 4;
    term.moveTo(3, row++);
    term.bold.cyan('Export Backup');
    row++;

    const items = backups.map(b => `${b.date} — ${b.id}`);
    items.push('← Cancel');

    const selected = await new Promise<number>((resolve) => {
        term.singleColumnMenu(items, {
            y: row,
            selectedStyle: term.bold.bgCyan.black,
            style: term.white,
            cancelable: true,
        }, (error: any, response: any) => {
            if (error || !response || response.canceled) {
                resolve(items.length - 1);
                return;
            }
            resolve(response.selectedIndex);
        });
    });

    if (selected >= backups.length) return;

    const backup = backups[selected]!;
    const outputPath = `/tmp/gpu-optimizer-backup-${backup.id}.tar.gz`;

    try {
        exportBackup(backup.id, outputPath);
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.green(`✓ Exported to: ${outputPath}`);
    } catch (e: any) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.red(`✗ Export failed: ${e.message}`);
    }

    term.moveTo(3, 6);
    term.dim('Press any key...');
    await waitForKey();
}

/**
 * Import a backup from a tar.gz archive.
 */
async function showImportBackup(): Promise<void> {
    const term = getTerm();
    refreshChrome();
    clearContent();

    term.moveTo(3, 4);
    term.bold.cyan('Import Backup');
    term.moveTo(3, 6);
    term('Enter path to .tar.gz archive: ');

    const archivePath = await new Promise<string>((resolve) => {
        term.inputField({ cancelable: true }, (error: any, input: any) => {
            resolve(input ?? '');
        });
    });

    if (!archivePath) return;

    try {
        const record = importBackup(archivePath.trim());
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.green(`✓ Imported backup: ${record.id} (${record.files.length} files)`);
    } catch (e: any) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.red(`✗ Import failed: ${e.message}`);
    }

    term.moveTo(3, 6);
    term.dim('Press any key...');
    await waitForKey();
}

/**
 * Rollback to a selected backup snapshot.
 */
async function showRollback(profile: SystemProfile): Promise<void> {
    const term = getTerm();
    const backups = listBackups();

    if (backups.length === 0) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.dim('No backups available for rollback.');
        term.moveTo(3, 6);
        term.dim('Press any key...');
        await waitForKey();
        return;
    }

    refreshChrome();
    clearContent();

    let row = 4;
    term.moveTo(3, row++);
    term.bold.cyan('Rollback to Snapshot');
    row++;

    const items = backups.map(b => `${b.date} (${b.files.length} files) — ${b.id}`);
    items.push('← Cancel');

    const selected = await new Promise<number>((resolve) => {
        term.singleColumnMenu(items, {
            y: row,
            selectedStyle: term.bold.bgYellow.black,
            style: term.white,
            cancelable: true,
        }, (error: any, response: any) => {
            if (error || !response || response.canceled) {
                resolve(items.length - 1);
                return;
            }
            resolve(response.selectedIndex);
        });
    });

    if (selected >= backups.length) return;

    const backup = backups[selected]!;

    refreshChrome();
    clearContent();
    term.moveTo(3, 4);
    term.yellow.bold(`Restore backup ${backup.id}? This overwrites current configs. [y/N] `);

    const confirmed = await new Promise<boolean>((resolve) => {
        const handler = (key: string) => {
            term.removeListener('key', handler);
            resolve(key === 'y' || key === 'Y');
        };
        term.on('key', handler);
    });

    if (!confirmed) return;

    try {
        const restored = rollbackToSnapshot(backup.id);
        refreshChrome();
        clearContent();

        let row = 4;
        term.moveTo(3, row++);
        term.green(`✓ Restored ${restored.length} file(s):`);
        for (const file of restored) {
            term.moveTo(3, row++);
            term.green(`  ✓ ${file}`);
        }

        if (profile.initramfs !== 'Unknown') {
            row++;
            term.moveTo(3, row++);
            term(`Rebuild initramfs using ${profile.initramfs}? [y/N] `);

            const shouldRebuild = await new Promise<boolean>((resolve) => {
                const handler = (key: string) => {
                    term.removeListener('key', handler);
                    resolve(key === 'y' || key === 'Y');
                };
                term.on('key', handler);
            });

            if (shouldRebuild) {
                try {
                    rebuildInitramfs(profile);
                    term.moveTo(3, row++);
                    term.green('✓ Initramfs rebuilt.');
                } catch (e: any) {
                    term.moveTo(3, row++);
                    term.red(`✗ Rebuild failed: ${e.message}`);
                }
            }
        }

        term.moveTo(3, row + 1);
        term.green.bold('Rollback complete!');
    } catch (e: any) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.red(`✗ Rollback failed: ${e.message}`);
    }

    term.moveTo(3, term.height - 2);
    term.dim('Press any key...');
    await waitForKey();
}

/**
 * Waits for any single keypress.
 */
function waitForKey(): Promise<void> {
    const term = getTerm();
    return new Promise<void>((resolve) => {
        const handler = () => {
            term.removeListener('key', handler);
            resolve();
        };
        term.on('key', handler);
    });
}
