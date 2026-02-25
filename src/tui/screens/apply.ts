import { getTerm, clearContent, refreshChrome } from '../app';
import { analyzeOptimizations, checkImmutability, stageOptimizations, applyMutations, rebuildInitramfs } from '../../controllers';
import type { SystemProfile, OptimizationRule } from '../../types';

/**
 * TUI screen for the optimization apply flow.
 * Allows users to:
 * 1. View available optimizations (recommended + optional)
 * 2. Toggle individual optimizations with Space
 * 3. Press 'i' for detailed info on any optimization
 * 4. Review diffs before applying
 * 5. Confirm and apply with backup
 *
 * @param profile - The discovered SystemProfile
 */
export async function showApplyFlow(profile: SystemProfile): Promise<void> {
    const term = getTerm();

    const immutableMsg = checkImmutability(profile);
    if (immutableMsg) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term.yellow('⚠  Immutable System Detected');
        term.moveTo(3, 6);
        term(immutableMsg);
        term.moveTo(3, 8);
        term.dim('Press any key to go back...');
        await waitForKey();
        return;
    }

    const analysis = analyzeOptimizations(profile);

    if (analysis.totalRules === 0) {
        refreshChrome();
        clearContent();
        term.moveTo(3, 4);
        term('No optimizations to apply for this system.');
        term.moveTo(3, 6);
        term.dim('Press any key to go back...');
        await waitForKey();
        return;
    }

    const allRules = [...analysis.recommended, ...analysis.optional];
    const selected = new Set<string>(analysis.recommended.map(r => r.id));
    let cursor = 0;

    function render(): void {
        refreshChrome();
        clearContent();

        let row = 4;
        term.moveTo(3, row++);
        term.bold.cyan(`Apply Optimizations (${analysis.totalRules} available)`);
        term.moveTo(3, row++);
        term.dim('Space: toggle  │  i: info  │  Enter: apply selected  │  q: cancel');
        row++;

        for (let i = 0; i < allRules.length; i++) {
            const rule = allRules[i]!;
            const isSelected = selected.has(rule.id);
            const isCursor = i === cursor;
            const isRecommended = rule.severity === 'recommended';

            term.moveTo(3, row + i);

            if (isCursor) {
                term.bgCyan.black(' ▸ ');
            } else {
                term('   ');
            }

            term(isSelected ? ' [✓] ' : ' [ ] ');

            if (isRecommended) {
                term.green('[REC] ');
            } else {
                term.dim('[OPT] ');
            }

            if (isCursor) {
                term.bold(rule.description);
            } else {
                term(rule.description);
            }
        }

        const infoRow = row + allRules.length + 2;
        if (allRules[cursor]) {
            term.moveTo(3, infoRow);
            term.dim(`Value: ${allRules[cursor]!.value}`);
        }
    }

    render();

    const action = await new Promise<string>((resolve) => {
        const handler = (key: string) => {
            if (key === 'q' || key === 'ESCAPE') {
                term.removeListener('key', handler);
                resolve('cancel');
                return;
            }
            if (key === 'UP' && cursor > 0) {
                cursor--;
                render();
            }
            if (key === 'DOWN' && cursor < allRules.length - 1) {
                cursor++;
                render();
            }
            if (key === ' ') {
                const rule = allRules[cursor]!;
                if (selected.has(rule.id)) {
                    selected.delete(rule.id);
                } else {
                    selected.add(rule.id);
                }
                render();
            }
            if (key === 'i') {
                term.removeListener('key', handler);
                resolve('info');
            }
            if (key === 'ENTER') {
                term.removeListener('key', handler);
                resolve('apply');
            }
        };
        term.on('key', handler);
    });

    if (action === 'cancel') return;

    if (action === 'info') {
        await showRuleInfo(allRules[cursor]!);
        return showApplyFlow(profile);
    }

    if (action === 'apply') {
        const selectedRules = allRules.filter(r => selected.has(r.id));

        if (selectedRules.length === 0) {
            refreshChrome();
            clearContent();
            term.moveTo(3, 4);
            term('No optimizations selected.');
            term.moveTo(3, 6);
            term.dim('Press any key to go back...');
            await waitForKey();
            return;
        }

        const { mutations, warnings } = stageOptimizations(profile, selectedRules);

        refreshChrome();
        clearContent();

        let row = 4;
        term.moveTo(3, row++);
        term.bold.cyan('Proposed Changes');
        row++;

        for (const w of warnings) {
            term.moveTo(3, row++);
            term.yellow(`⚠  ${w}`);
        }

        if (mutations.length === 0) {
            term.moveTo(3, row++);
            term('No file mutations to apply.');
            term.moveTo(3, row + 1);
            term.dim('Press any key to go back...');
            await waitForKey();
            return;
        }

        for (const mut of mutations) {
            term.moveTo(3, row++);
            term.bold(`File: ${mut.targetPath}`);
            term.moveTo(3, row++);
            term.dim('─'.repeat(46));
            for (const line of mut.diff.split('\n').slice(0, 15)) {
                term.moveTo(3, row++);
                term(`  ${line}`);
            }
            term.moveTo(3, row++);
            term.dim('─'.repeat(46));
            row++;
        }

        term.moveTo(3, row++);
        term.bold('Apply these changes? (requires sudo) [y/N] ');

        const confirmed = await new Promise<boolean>((resolve) => {
            const handler = (key: string) => {
                term.removeListener('key', handler);
                resolve(key === 'y' || key === 'Y');
            };
            term.on('key', handler);
        });

        if (!confirmed) {
            term.moveTo(3, row + 1);
            term.yellow('Changes not applied.');
            await waitForKeyWithDelay(1500);
            return;
        }

        const result = applyMutations(mutations);

        clearContent();
        row = 4;

        if (result.success) {
            term.moveTo(3, row++);
            term.green('✓ Changes applied successfully!');
            term.moveTo(3, row++);
            term.dim(`Backup ID: ${result.backupId}`);
            row++;

            if (profile.initramfs !== 'Unknown') {
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
                        term.green('✓ Initramfs rebuilt successfully.');
                    } catch (e: any) {
                        term.moveTo(3, row++);
                        term.red(`✗ Rebuild failed: ${e.message}`);
                    }
                }
            }

            term.moveTo(3, row + 1);
            term.green.bold('All optimizations applied!');
        } else {
            term.moveTo(3, row++);
            term.red(`✗ Apply failed: ${result.error}`);
            term.moveTo(3, row++);
            term('Your backup is safe. Use Rollback to restore if needed.');
        }

        term.moveTo(3, row + 2);
        term.dim('Press any key to continue...');
        await waitForKey();
    }
}

/**
 * Shows detailed information about a specific optimization rule.
 */
async function showRuleInfo(rule: OptimizationRule): Promise<void> {
    const term = getTerm();
    refreshChrome();
    clearContent();

    let row = 4;
    term.moveTo(3, row++);
    term.bold.cyan('Optimization Details');
    row++;
    term.moveTo(3, row++);
    term.bold(`ID:          ${rule.id}`);
    term.moveTo(3, row++);
    term(`Vendor:      ${rule.vendor}`);
    term.moveTo(3, row++);
    term(`Description: ${rule.description}`);
    term.moveTo(3, row++);
    term(`Target:      ${rule.target}`);
    term.moveTo(3, row++);
    term(`Value:       ${rule.value}`);
    term.moveTo(3, row++);
    term(`Severity:    `);
    rule.severity === 'recommended' ? term.green('Recommended') : term.dim('Optional');

    term.moveTo(3, row + 2);
    term.dim('Press any key to go back...');
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

/**
 * Waits for a keypress or a timeout, whichever comes first.
 */
function waitForKeyWithDelay(ms: number): Promise<void> {
    const term = getTerm();
    return new Promise<void>((resolve) => {
        let resolved = false;
        const handler = () => {
            if (resolved) return;
            resolved = true;
            term.removeListener('key', handler);
            resolve();
        };
        term.on('key', handler);
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                term.removeListener('key', handler);
                resolve();
            }
        }, ms);
    });
}
