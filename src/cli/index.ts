import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';
import { formatBytes } from './formatters';
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
    deleteBackup,
} from '../controllers';
import { loadConfig, saveConfig } from '../config';
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
 * CLI flow: --status
 * Prints a high-level summary of the system hardware and state.
 */
export async function cliStatus(): Promise<void> {
    const profile = await getStatusSnapshot();
    printStatus(profile);
}

/**
 * CLI flow: --apply
 * Interactive optimization flow. Discovers hardware, analyzes risks,
 * and stages/applies kernel and module-level optimizations.
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
        const status = rule.isApplied ? pc.dim(' [applied]') : '';
        console.log(`  ${pc.cyan('●')} [${severity}] ${rule.isApplied ? pc.dim(rule.description) : rule.description}${status}`);
        console.log(`    ${pc.dim(rule.value)}`);
    }
    console.log('');

    let selectedOptional: string[] = [];
    if (analysis.optional.length > 0) {
        const optResult = await p.multiselect({
            message: 'Select optional optimizations to include:',
            options: analysis.optional.filter(r => !r.isApplied).map(r => ({
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
        ...analysis.recommended.filter(r => !r.isApplied),
        ...analysis.optional.filter(r => selectedOptional.includes(r.id)),
    ];

    if (selectedRules.length === 0) {
        p.log.info('No optimizations selected.');
        return;
    }

    const { mutations, warnings } = await stageOptimizations(profile, selectedRules);

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
    const result = await applyMutations(mutations);

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
 * CLI flow: --rollback
 * Lists available snapshots and allows selecting one to restore.
 * Performs a deep rollback of all staged file mutations.
 */
export async function cliRollback(): Promise<void> {
    p.intro(pc.bold(pc.cyan(' Universal GPU Optimizer — Rollback ')));

    const backups = await listBackups();

    if (backups.length === 0) {
        p.log.info('No backup snapshots found.');
        return;
    }

    const snapshotId = await p.select({
        message: 'Select a backup to restore:',
        options: backups.map(s => ({
            value: s.id,
            label: `${s.date} (${s.files.length} file${s.files.length !== 1 ? 's' : ''})`,
            hint: s.id,
        })),
    });

    if (isCancel(snapshotId)) {
        p.log.warning('Rollback cancelled.');
        return;
    }

    const shouldRollback = await p.confirm({
        message: `Restore backup ${snapshotId}? This will overwrite current configs.`,
    });

    if (isCancel(shouldRollback) || !shouldRollback) {
        p.log.warning('Rollback cancelled.');
        return;
    }

    const spin = p.spinner();
    spin.start('Restoring files...');
    try {
        const restored = await rollbackToSnapshot(snapshotId as string);
        spin.stop(`Restored ${restored.length} file(s).`);
        for (const file of restored) {
            console.log(`  ${pc.green('✓')} ${file}`);
        }
    } catch (e: any) {
        spin.stop(pc.red('Rollback failed.'));
        p.log.error(e.message);
        return;
    }
    const profile = await getStatusSnapshot();

    // Restore initramfs rebuild prompt if applicable
    if (profile.initramfs !== 'Unknown') {
        const shouldRebuild = await p.confirm({
            message: `Rebuild initramfs using ${profile.initramfs}?`,
        });

        if (!isCancel(shouldRebuild) && shouldRebuild) {
            try {
                await rebuildInitramfs(profile);
            } catch (e: any) {
                p.log.error(`Rebuild failed: ${e.message}`);
            }
        }
    }

    p.log.success('Rollback complete!');
}

/**
 * CLI flow: --detailed
 * Prints an exhaustive system profile for advanced debugging.
 * Includes full hardware stats, PCI IDs, and driver details.
 */
export async function cliDetailedStatus(): Promise<void> {
    const profile = await getStatusSnapshot();

    console.log('');
    console.log(pc.bold(pc.cyan('  ━━━ Detailed System Profile ━━━')));
    console.log('');

    console.log(pc.bold('  OS Architecture'));
    console.log(`    Kernel Version:   ${pc.white(profile.kernelVersion)}`);
    console.log(`    Display Server:   ${pc.white(profile.displayServer)}`);
    console.log(`    Immutability:     ${profile.isImmutable ? pc.yellow(`Yes (${profile.immutableType})`) : pc.dim('No')}`);
    console.log('');

    // Boot Infrastructure
    console.log(pc.bold('  Boot Infrastructure'));
    console.log(`    Bootloader:       ${pc.white(profile.bootloader.type)}`);
    console.log(`    Config Path:      ${pc.dim(profile.bootloader.configPath || 'N/A')}`);
    console.log(`    Initramfs Gen:    ${pc.white(profile.initramfs)}`);
    console.log('');

    // CPU & Memory
    console.log(pc.bold('  CPU & Memory'));
    console.log(`    Model:            ${pc.white(profile.cpuInfo.model)}`);
    console.log(`    Cores:            ${pc.white(profile.cpuInfo.cores.toString())}`);
    console.log(`    Usage:            ${pc.white(`${profile.cpuInfo.usagePercent}%`)}`);
    if (profile.cpuInfo.temperature) {
        console.log(`    Package Temp:     ${pc.white(`${profile.cpuInfo.temperature}°C`)}`);
    }
    console.log(`    Physical RAM:     ${pc.white(formatBytes(profile.memoryStats.total))}`);
    console.log(`    RAM Used:         ${pc.white(formatBytes(profile.memoryStats.used))}`);
    console.log(`    RAM Free:         ${pc.white(formatBytes(profile.memoryStats.free))}`);
    console.log(`    ZRAM Enabled:     ${profile.memory.hasZram ? pc.green('Yes') : pc.dim('No')}`);
    console.log(`    ZSWAP Enabled:    ${profile.memory.hasZswap ? pc.yellow('Yes') : pc.dim('No')}`);
    console.log('');

    // GPUs
    console.log(pc.bold('  Graphics Processing Units'));
    if (profile.gpus.length === 0) {
        console.log(pc.dim('    No GPUs detected'));
    } else {
        profile.gpus.forEach((gpu, index) => {
            console.log(`    ${pc.bold(`GPU ${index + 1}`)}: ${pc.green(gpu.vendor)} ${pc.white(gpu.model)}`);
            console.log(`      PCI ID:         ${pc.yellow(gpu.pciId)}`);
            console.log(`      Active Driver:  ${gpu.activeDriver ? pc.cyan(gpu.activeDriver) : pc.dim('None')}`);

            if (gpu.stats) {
                if (gpu.stats.temperature !== undefined) console.log(`      Temperature:    ${pc.white(`${gpu.stats.temperature}°C`)}`);
                if (gpu.stats.utilization !== undefined) console.log(`      Utilization:    ${pc.white(`${gpu.stats.utilization}%`)}`);
                if (gpu.stats.vramTotal !== undefined) console.log(`      VRAM Total:     ${pc.white(formatBytes(gpu.stats.vramTotal))}`);
                if (gpu.stats.vramUsed !== undefined) console.log(`      VRAM Used:      ${pc.white(formatBytes(gpu.stats.vramUsed))}`);
            }
            console.log('');
        });
    }

    console.log(pc.bold(pc.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
    console.log('');
}

/**
 * CLI flow: --list-backups
 * Prints all available backups with timestamps and metadata.
 */
export async function cliListBackups(): Promise<void> {
    const backups = await listBackups();
    console.log('');
    console.log(pc.bold(pc.cyan('  ━━━ Backup Snapshots ━━━')));
    console.log('');

    if (backups.length === 0) {
        console.log(pc.dim('  No backups found.'));
    } else {
        for (const s of backups) {
            console.log(`  ${pc.bold(pc.green(s.id))} │ ${pc.white(s.date)}`);
            console.log(pc.dim(`    Contains ${s.files.length} file(s)`));
            console.log('');
        }
    }
    console.log(pc.bold(pc.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━')));
    console.log('');
}

/**
 * CLI flow: --config key=value
 * Updates a configuration key and persists it to disk.
 *
 * @param keyValueString - The raw string input from the CLI (e.g., "dryMode=true")
 */
export async function cliConfig(keyValueString: string): Promise<void> {
    const config = await loadConfig();
    const [key, rawValue] = keyValueString.split('=');

    if (!key || rawValue === undefined) {
        console.error(pc.red('Error: Invalid format. Use --config <key>=<value>'));
        return;
    }

    const keyStr = key.trim() as keyof typeof config;
    const valueStr = rawValue.trim();

    if (!(keyStr in config)) {
        console.error(pc.red(`Error: Unknown configuration key '${keyStr}'`));
        return;
    }

    try {
        const typeofVal = typeof (config as any)[keyStr];
        let newVal: any = valueStr;

        if (typeofVal === 'number') {
            newVal = parseInt(valueStr, 10);
            if (isNaN(newVal)) throw new Error('Must be a number');
        } else if (typeofVal === 'boolean') {
            newVal = valueStr === 'true' || valueStr === '1';
        }

        (config as any)[keyStr] = newVal;
        await saveConfig(config);

        console.log(pc.green(`✓ Configuration updated: ${keyStr} = ${newVal}`));
    } catch (e: any) {
        console.error(pc.red(`Error saving config: ${e.message}`));
    }
}
