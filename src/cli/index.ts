import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';
import {
    getStatusSnapshot,
    checkImmutability,
    analyzeOptimizations,
    stageOptimizations,
    applyMutations,
    rebuildInitramfs,
    listBackups,
    rollbackToSnapshot,
    getAvailableServices,
    applyNvidiaPersistence,
    applyUdevPowerRule,
} from '../controllers';
import type { SystemProfile } from '../types';

/**
 * Prints a brief system status summary to stdout.
 * Uses picocolors for formatting — suitable for piped/scripted output.
 *
 * @param profile - The SystemProfile snapshot
 */
function printStatus(profile: SystemProfile): void {
    console.log('');
    console.log(pc.bold(pc.cyan('  ━━━ System Profile ━━━')));
    console.log('');

    if (profile.gpus.length === 0) {
        console.log(pc.dim('  No GPUs detected'));
    } else {
        for (const gpu of profile.gpus) {
            const driver = gpu.activeDriver ? pc.green(gpu.activeDriver) : pc.dim('none');
            console.log(`  ${pc.bold(gpu.model)}  │  PCI: ${pc.yellow(gpu.pciId)}  │  Driver: ${driver}`);

            if (gpu.stats) {
                const parts: string[] = [];
                if (gpu.stats.temperature !== undefined) parts.push(`Temp: ${gpu.stats.temperature}°C`);
                if (gpu.stats.utilization !== undefined) parts.push(`Usage: ${gpu.stats.utilization}%`);
                if (parts.length > 0) {
                    console.log(`    ${pc.dim(parts.join('  │  '))}`);
                }
            }
        }
    }

    if (profile.isHybrid) {
        console.log(`  ${pc.magenta('⚡ Hybrid GPU configuration detected')}`);
    }

    console.log('');
    console.log(`  CPU               ${pc.white(profile.cpuInfo.model)} (${profile.cpuInfo.cores} cores)`);
    console.log(`  CPU Usage         ${pc.white(`${profile.cpuInfo.usagePercent}%`)}`);
    console.log(`  RAM               ${pc.white(formatBytes(profile.memoryStats.used))} / ${pc.white(formatBytes(profile.memoryStats.total))}`);
    console.log('');
    console.log(`  Display Server    ${pc.white(profile.displayServer)}`);
    console.log(`  Bootloader        ${pc.white(profile.bootloader.type)}${profile.bootloader.configPath ? pc.dim(` (${profile.bootloader.configPath})`) : ''}`);
    console.log(`  Initramfs         ${pc.white(profile.initramfs)}`);
    console.log(`  Kernel            ${pc.white(profile.kernelVersion)}`);
    console.log(`  ZRAM              ${profile.memory.hasZram ? pc.green('active') : pc.dim('inactive')}`);
    console.log(`  ZSWAP             ${profile.memory.hasZswap ? pc.yellow('active') : pc.dim('inactive')}`);

    if (profile.isImmutable) {
        console.log('');
        console.log(`  ${pc.yellow('⚠')}  ${pc.bold(pc.yellow('Immutable filesystem detected'))} (${profile.immutableType})`);
    }

    console.log('');
    console.log(pc.bold(pc.cyan('  ━━━━━━━━━━━━━━━━━━━━━━')));
    console.log('');
}

/**
 * CLI passthrough: --status
 * Prints the current system status and exits.
 */
export async function cliStatus(): Promise<void> {
    const profile = await getStatusSnapshot();
    printStatus(profile);
}

/**
 * CLI passthrough: --apply
 * Runs the full apply flow non-interactively, applying all recommended
 * optimizations automatically. Optional rules are skipped.
 */
export async function cliApply(): Promise<void> {
    p.intro(pc.bold(pc.cyan(' Universal GPU Optimizer — Apply ')));

    const spin = p.spinner();
    spin.start('Discovering system hardware...');
    const profile = await getStatusSnapshot();
    spin.stop('System discovery complete.');

    const immutableMsg = checkImmutability(profile);
    if (immutableMsg) {
        p.log.warning(pc.yellow('Immutable system detected.'));
        p.log.info(immutableMsg);
        return;
    }

    spin.start('Generating optimization plan...');
    const analysis = analyzeOptimizations(profile);
    spin.stop(`Found ${analysis.totalRules} optimization(s).`);

    if (analysis.totalRules === 0) {
        p.log.info('No optimizations to apply.');
        return;
    }

    for (const rule of [...analysis.recommended, ...analysis.optional]) {
        const severity = rule.severity === 'recommended' ? pc.green('recommended') : pc.dim('optional');
        console.log(`  ${pc.cyan('●')} [${severity}] ${rule.description}`);
        console.log(`    ${pc.dim(rule.value)}`);
    }
    console.log('');

    let selectedOptional: string[] = [];
    if (analysis.optional.length > 0) {
        const optResult = await p.multiselect({
            message: 'Select optional optimizations to include:',
            options: analysis.optional.map(r => ({
                value: r.id,
                label: r.description,
                hint: r.value,
            })),
            required: false,
        });

        if (isCancel(optResult)) {
            p.log.warning('Operation cancelled.');
            return;
        }
        selectedOptional = optResult as string[];
    }

    const selectedRules = [
        ...analysis.recommended,
        ...analysis.optional.filter(r => selectedOptional.includes(r.id)),
    ];

    if (selectedRules.length === 0) {
        p.log.info('No optimizations selected.');
        return;
    }

    const { mutations, warnings } = stageOptimizations(profile, selectedRules);

    for (const w of warnings) {
        p.log.warning(w);
    }

    if (mutations.length === 0) {
        p.log.info('No file mutations to apply.');
        return;
    }

    console.log('');
    p.log.step('Proposed changes:');
    for (const mut of mutations) {
        console.log('');
        console.log(pc.bold(`  File: ${mut.targetPath}`));
        console.log(pc.dim('  ─────────────────────────────────────'));
        for (const line of mut.diff.split('\n')) {
            console.log(`  ${line}`);
        }
        console.log(pc.dim('  ─────────────────────────────────────'));
    }
    console.log('');

    const shouldApply = await p.confirm({
        message: 'Apply these changes? (requires sudo)',
    });

    if (isCancel(shouldApply) || !shouldApply) {
        p.log.warning('Changes not applied.');
        return;
    }

    spin.start('Applying changes...');
    const result = applyMutations(mutations);

    if (!result.success) {
        spin.stop(pc.red('Failed to apply changes.'));
        p.log.error(result.error ?? 'Unknown error');
        return;
    }
    spin.stop(`Changes applied. Backup: ${pc.dim(result.backupId!)}`);

    if (profile.initramfs !== 'Unknown') {
        const shouldRebuild = await p.confirm({
            message: `Rebuild initramfs using ${profile.initramfs}?`,
        });

        if (!isCancel(shouldRebuild) && shouldRebuild) {
            try {
                rebuildInitramfs(profile);
            } catch (e: any) {
                p.log.error(`Initramfs rebuild failed: ${e.message}`);
            }
        }
    }

    p.log.success('All optimizations applied successfully!');

    const services = getAvailableServices(profile);
    if (services.nvidiaPersistence) {
        const enable = await p.confirm({
            message: 'Enable NVIDIA persistence daemon?',
        });
        if (!isCancel(enable) && enable) {
            try { applyNvidiaPersistence(); } catch (e: any) { p.log.error(e.message); }
        }
    }
    if (services.udevPowerManagement) {
        const enable = await p.confirm({
            message: 'Install PCI power management udev rule?',
        });
        if (!isCancel(enable) && enable) {
            try { applyUdevPowerRule(); } catch (e: any) { p.log.error(e.message); }
        }
    }
}

/**
 * CLI passthrough: --rollback
 * Lists available snapshots and allows selecting one to restore.
 */
export async function cliRollback(): Promise<void> {
    p.intro(pc.bold(pc.cyan(' Universal GPU Optimizer — Rollback ')));

    const profile = await getStatusSnapshot();
    const snapshots = listBackups();

    if (snapshots.length === 0) {
        p.log.info('No backup snapshots found.');
        return;
    }

    const selected = await p.select({
        message: 'Select a backup to restore:',
        options: snapshots.map(s => ({
            value: s.id,
            label: `${s.date} (${s.files.length} file${s.files.length !== 1 ? 's' : ''})`,
            hint: s.id,
        })),
    });

    if (isCancel(selected)) {
        p.log.warning('Rollback cancelled.');
        return;
    }

    const shouldRollback = await p.confirm({
        message: `Restore backup ${selected}? This will overwrite current configs.`,
    });

    if (isCancel(shouldRollback) || !shouldRollback) {
        p.log.warning('Rollback cancelled.');
        return;
    }

    const spin = p.spinner();
    spin.start('Restoring files...');
    try {
        const restored = rollbackToSnapshot(selected as string);
        spin.stop(`Restored ${restored.length} file(s).`);
        for (const file of restored) {
            console.log(`  ${pc.green('✓')} ${file}`);
        }
    } catch (e: any) {
        spin.stop(pc.red('Rollback failed.'));
        p.log.error(e.message);
        return;
    }

    if (profile.initramfs !== 'Unknown') {
        const shouldRebuild = await p.confirm({
            message: `Rebuild initramfs using ${profile.initramfs}?`,
        });

        if (!isCancel(shouldRebuild) && shouldRebuild) {
            try {
                rebuildInitramfs(profile);
            } catch (e: any) {
                p.log.error(`Rebuild failed: ${e.message}`);
            }
        }
    }

    p.log.success('Rollback complete!');
}

/**
 * Formats bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
