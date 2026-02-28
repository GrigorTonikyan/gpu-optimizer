import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome } from '../app';
import { getSettings, analyzeOptimizations, checkImmutability, stageOptimizations, applyMutations, rebuildInitramfs } from '../../controllers';
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
    const immutableMsg = checkImmutability(profile);
    if (immutableMsg) {
        const config = await getSettings();
        refreshChrome(config);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write(pc.yellow('⚠  Immutable System Detected'));
        terminal.moveTo(3, 6);
        terminal.write(immutableMsg);
        terminal.moveTo(3, 8);
        terminal.write(pc.dim('Press any key to go back...'));
        await waitForKey();
        return;
    }

    const analysis = analyzeOptimizations(profile);

    if (analysis.totalRules === 0) {
        const config = await getSettings();
        refreshChrome(config);
        clearContent();
        terminal.moveTo(3, 4);
        terminal.write('No optimizations to apply for this system.');
        terminal.moveTo(3, 6);
        terminal.write(pc.dim('Press any key to go back...'));
        await waitForKey();
        return;
    }

    const allRules = [...analysis.recommended, ...analysis.optional];
    const selected = new Set<string>(analysis.recommended.map(r => r.id));
    let cursor = 0;

    async function render(): Promise<void> {
        const config = await getSettings();
        refreshChrome(config);
        clearContent();

        let row = 4;
        terminal.moveTo(3, row++);
        terminal.write(pc.bold(pc.cyan(`Apply Optimizations (${analysis.totalRules} available)`)));
        terminal.moveTo(3, row++);
        terminal.write(pc.dim('Space: toggle  │  i: info  │  Enter: apply selected  │  q: cancel'));
        row++;

        for (let i = 0; i < allRules.length; i++) {
            const rule = allRules[i]!;
            const isSelected = selected.has(rule.id);
            const isCursor = i === cursor;
            const isRecommended = rule.severity === 'recommended';

            terminal.moveTo(3, row + i);

            if (isCursor) {
                terminal.bgCyanBlack(' ▸ ');
            } else {
                terminal.write('   ');
            }

            terminal.write(isSelected ? ' [✓] ' : ' [ ] ');

            if (isRecommended) {
                terminal.write(pc.green('[REC] '));
            } else {
                terminal.write(pc.dim('[OPT] '));
            }

            if (isCursor) {
                terminal.write(pc.bold(rule.description));
            } else {
                terminal.write(rule.description);
            }
        }

        const infoRow = row + allRules.length + 2;
        if (allRules[cursor]) {
            terminal.moveTo(3, infoRow);
            terminal.write(pc.dim(`Value: ${allRules[cursor]!.value}`));
        }
    }

    await render();

    const action = await new Promise<string>((resolve) => {
        const handler = (key: string) => {
            if (key === 'q' || key === 'ESCAPE') {
                terminal.removeKeyListener(handler);
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
                terminal.removeKeyListener(handler);
                resolve('info');
            }
            if (key === 'ENTER') {
                terminal.removeKeyListener(handler);
                resolve('apply');
            }
        };
        terminal.onKey(handler);
    });

    if (action === 'cancel') return;

    if (action === 'info') {
        await showRuleInfo(allRules[cursor]!);
        return showApplyFlow(profile);
    }

    if (action === 'apply') {
        const selectedRules = allRules.filter(r => selected.has(r.id));

        if (selectedRules.length === 0) {
            const config = await getSettings();
            refreshChrome(config);
            clearContent();
            terminal.moveTo(3, 4);
            terminal.write('No optimizations selected.');
            terminal.moveTo(3, 6);
            terminal.write(pc.dim('Press any key to go back...'));
            await waitForKey();
            return;
        }

        const { mutations, warnings } = stageOptimizations(profile, selectedRules);

        const config = await getSettings();
        refreshChrome(config);
        clearContent();

        let row = 4;
        terminal.moveTo(3, row++);
        terminal.write(pc.bold(pc.cyan('Proposed Changes')));
        row++;

        for (const w of warnings) {
            terminal.moveTo(3, row++);
            terminal.write(pc.yellow(`⚠  ${w}`));
        }

        if (mutations.length === 0) {
            terminal.moveTo(3, row++);
            terminal.write('No file mutations to apply.');
            terminal.moveTo(3, row + 1);
            terminal.write(pc.dim('Press any key to go back...'));
            await waitForKey();
            return;
        }

        for (const mut of mutations) {
            terminal.moveTo(3, row++);
            terminal.write(pc.bold(`File: ${mut.targetPath}`));
            terminal.moveTo(3, row++);
            terminal.write(pc.dim('─'.repeat(46)));
            for (const line of mut.diff.split('\n').slice(0, 15)) {
                terminal.moveTo(3, row++);
                terminal.write(`  ${line}`);
            }
            terminal.moveTo(3, row++);
            terminal.write(pc.dim('─'.repeat(46)));
            row++;
        }

        terminal.moveTo(3, row++);
        terminal.write(pc.bold('Apply these changes? (requires sudo) [y/N] '));

        const confirmed = await new Promise<boolean>((resolve) => {
            const handler = (key: string) => {
                terminal.removeKeyListener(handler);
                resolve(key === 'y' || key === 'Y');
            };
            terminal.onKey(handler);
        });

        if (!confirmed) {
            terminal.moveTo(3, row + 1);
            terminal.write(pc.yellow('Changes not applied.'));
            await waitForKeyWithDelay(1500);
            return;
        }

        const result = applyMutations(mutations);

        clearContent();
        row = 4;

        if (result.success) {
            terminal.moveTo(3, row++);
            terminal.write(pc.green('✓ Changes applied successfully!'));
            terminal.moveTo(3, row++);
            terminal.write(pc.dim(`Backup ID: ${result.backupId}`));
            row++;

            if (profile.initramfs !== 'Unknown') {
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
                        terminal.write(pc.green('✓ Initramfs rebuilt successfully.'));
                    } catch (e: any) {
                        terminal.moveTo(3, row++);
                        terminal.write(pc.red(`✗ Rebuild failed: ${e.message}`));
                    }
                }
            }

            terminal.moveTo(3, row + 1);
            terminal.write(pc.bold(pc.green('All optimizations applied!')));
        } else {
            terminal.moveTo(3, row++);
            terminal.write(pc.red(`✗ Apply failed: ${result.error}`));
            terminal.moveTo(3, row++);
            terminal.write('Your backup is safe. Use Rollback to restore if needed.');
        }

        terminal.moveTo(3, row + 2);
        terminal.write(pc.dim('Press any key to continue...'));
        await waitForKey();
    }
}

/**
 * Shows detailed information about a specific optimization rule.
 */
async function showRuleInfo(rule: OptimizationRule): Promise<void> {
    const config = await getSettings();
    refreshChrome(config);
    clearContent();

    let row = 4;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.cyan('Optimization Details')));
    row++;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(`ID:          ${rule.id}`));
    terminal.moveTo(3, row++);
    terminal.write(`Vendor:      ${rule.vendor}`);
    terminal.moveTo(3, row++);
    terminal.write(`Description: ${rule.description}`);
    terminal.moveTo(3, row++);
    terminal.write(`Target:      ${rule.target}`);
    terminal.moveTo(3, row++);
    terminal.write(`Value:       ${rule.value}`);
    terminal.moveTo(3, row++);
    terminal.write(`Severity:    `);
    terminal.write(rule.severity === 'recommended' ? pc.green('Recommended') : pc.dim('Optional'));

    terminal.moveTo(3, row + 2);
    terminal.write(pc.dim('Press any key to go back...'));
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

/**
 * Waits for a keypress or a timeout, whichever comes first.
 */
function waitForKeyWithDelay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        let resolved = false;
        const handler = () => {
            if (resolved) return;
            resolved = true;
            terminal.removeKeyListener(handler);
            resolve();
        };
        terminal.onKey(handler);
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                terminal.removeKeyListener(handler);
                resolve();
            }
        }, ms);
    });
}
