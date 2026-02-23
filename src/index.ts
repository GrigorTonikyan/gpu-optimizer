import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';
import { discoverSystem } from './discovery';
import { generateOptimizationPlan } from './engine/matrix';
import { createSnapshot, listSnapshots, rollback } from './engine/backup';
import { injectGrub, injectSystemdBoot, writeModprobeConfig, applyStaged, triggerRebuild } from './engine/mutate';
import type { SystemProfile, StagedMutation } from './types';

/**
 * Pretty-prints the discovered system profile to the terminal.
 * Shows GPU details, display server, bootloader, initramfs, memory, and immutability.
 *
 * @param profile - The SystemProfile from the discovery engine
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
            console.log(`  ${pc.bold(gpu.vendor)} GPU  │  PCI: ${pc.yellow(gpu.pciId)}  │  Driver: ${driver}`);
        }
    }

    if (profile.isHybrid) {
        console.log(`  ${pc.magenta('⚡ Hybrid GPU configuration detected')}`);
    }

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
 * Handles the "Apply Optimizations" flow:
 * 1. Discover system → 2. Generate optimization plan → 3. Stage mutations
 * 4. Show diffs → 5. Confirm → 6. Backup → 7. Apply → 8. Rebuild
 *
 * @param profile - The pre-discovered SystemProfile
 */
async function applyFlow(profile: SystemProfile): Promise<void> {
    if (profile.isImmutable) {
        p.log.warning(pc.yellow('This is an immutable system. Direct file writes are not supported.'));

        const instructions: Record<string, string> = {
            ostree: 'Use: rpm-ostree kargs --append=<param> to add kernel parameters',
            steamos: 'SteamOS requires unlocking the filesystem first. Proceed with caution.',
            nixos: 'Add kernel parameters to your NixOS configuration.nix and rebuild',
        };

        const hint = instructions[profile.immutableType ?? ''] ?? 'Please use your distribution\'s native method to modify kernel parameters.';
        p.log.info(hint);
        return;
    }

    const spin = p.spinner();
    spin.start('Generating optimization plan...');
    const plan = generateOptimizationPlan(profile);
    spin.stop('Optimization plan generated.');

    const totalRules = plan.kernelParams.length + plan.modprobeOptions.length;
    if (totalRules === 0) {
        p.log.info('No optimizations to apply for this system.');
        return;
    }

    p.log.info(`Found ${pc.bold(String(totalRules))} optimization${totalRules > 1 ? 's' : ''} to apply:`);

    for (const rule of [...plan.kernelParams, ...plan.modprobeOptions]) {
        const severity = rule.severity === 'recommended'
            ? pc.green('recommended')
            : pc.dim('optional');
        console.log(`  ${pc.cyan('●')} [${severity}] ${rule.description}`);
        console.log(`    ${pc.dim(rule.value)}`);
    }
    console.log('');

    /**
     * Let the user select which optional rules to include.
     * Recommended rules are always included.
     */
    const recommended = [...plan.kernelParams, ...plan.modprobeOptions].filter(r => r.severity === 'recommended');
    const optional = [...plan.kernelParams, ...plan.modprobeOptions].filter(r => r.severity === 'optional');

    let selectedOptional: string[] = [];
    if (optional.length > 0) {
        const optResult = await p.multiselect({
            message: 'Select optional optimizations to include:',
            options: optional.map(r => ({
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

    const activeRules = [
        ...recommended,
        ...optional.filter(r => selectedOptional.includes(r.id)),
    ];

    if (activeRules.length === 0) {
        p.log.info('No optimizations selected.');
        return;
    }

    const activeKernelParams = activeRules.filter(r => r.target === 'kernel-param').map(r => r.value);
    const activeModprobeRules = activeRules.filter(r => r.target === 'modprobe');

    const mutations: StagedMutation[] = [];

    if (activeKernelParams.length > 0) {
        try {
            if (profile.bootloader.type === 'GRUB') {
                mutations.push(injectGrub(activeKernelParams, profile.bootloader.configPath));
            } else if (profile.bootloader.type === 'systemd-boot') {
                if (!profile.bootloader.configPath) {
                    p.log.warning('systemd-boot detected but entry config path not readable. Kernel param injection requires elevated read access.');
                    p.log.info('You may need to manually add these parameters to your boot entry.');
                    for (const param of activeKernelParams) {
                        console.log(`  ${pc.cyan(param)}`);
                    }
                } else {
                    mutations.push(injectSystemdBoot(activeKernelParams, profile.bootloader.configPath));
                }
            } else {
                p.log.warning('Unknown bootloader — cannot inject kernel parameters automatically.');
                p.log.info('Please add these parameters manually:');
                for (const param of activeKernelParams) {
                    console.log(`  ${pc.cyan(param)}`);
                }
            }
        } catch (e: any) {
            p.log.error(`Failed to stage kernel params: ${e.message}`);
            return;
        }
    }

    if (activeModprobeRules.length > 0) {
        try {
            mutations.push(writeModprobeConfig(activeModprobeRules));
        } catch (e: any) {
            p.log.error(`Failed to stage modprobe config: ${e.message}`);
            return;
        }
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

    spin.start('Creating backup snapshot...');
    const filesToBackup = mutations.map(m => m.targetPath);
    const backupRecord = createSnapshot(filesToBackup);
    spin.stop(`Backup created: ${pc.dim(backupRecord.id)}`);

    spin.start('Applying changes...');
    try {
        for (const mut of mutations) {
            applyStaged(mut);
        }
        spin.stop('Changes applied successfully.');
    } catch (e: any) {
        spin.stop(pc.red('Failed to apply changes.'));
        p.log.error(e.message);
        p.log.info('Your backup is safe. Use Rollback to restore if needed.');
        return;
    }

    if (profile.initramfs !== 'Unknown') {
        const shouldRebuild = await p.confirm({
            message: `Rebuild initramfs using ${profile.initramfs}?`,
        });

        if (isCancel(shouldRebuild) || !shouldRebuild) {
            p.log.info('Skipping initramfs rebuild. Changes will take effect after manual rebuild or reboot.');
            return;
        }

        try {
            triggerRebuild(profile.initramfs, profile.bootloader.type);
        } catch (e: any) {
            p.log.error(`Initramfs rebuild failed: ${e.message}`);
            p.log.info('Your changes are applied but initramfs was not rebuilt. Rebuild manually or rollback.');
        }
    }

    p.log.success('All optimizations applied successfully!');
}

/**
 * Handles the "Rollback" flow:
 * 1. List snapshots → 2. Select snapshot → 3. Restore → 4. Rebuild
 *
 * @param profile - The pre-discovered SystemProfile (needed for initramfs type)
 */
async function rollbackFlow(profile: SystemProfile): Promise<void> {
    const snapshots = listSnapshots();

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
        const restored = rollback(selected as string);
        spin.stop(`Restored ${restored.length} file${restored.length !== 1 ? 's' : ''}.`);

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

        if (isCancel(shouldRebuild) || !shouldRebuild) {
            p.log.info('Skipping initramfs rebuild.');
            return;
        }

        try {
            triggerRebuild(profile.initramfs, profile.bootloader.type);
        } catch (e: any) {
            p.log.error(`Initramfs rebuild failed: ${e.message}`);
        }
    }

    p.log.success('Rollback complete!');
}

/**
 * Main entry point for the Universal GPU Optimizer CLI.
 * Presents an interactive menu loop using @clack/prompts.
 */
async function main(): Promise<void> {
    p.intro(pc.bold(pc.cyan(' Universal GPU Optimizer ')));

    const spin = p.spinner();
    spin.start('Discovering system hardware...');
    const profile = await discoverSystem();
    spin.stop('System discovery complete.');

    printStatus(profile);

    let running = true;

    while (running) {
        const action = await p.select({
            message: 'What would you like to do?',
            options: [
                { value: 'status', label: '📊  View System Status', hint: 'Show detected hardware and configuration' },
                { value: 'apply', label: '⚡  Apply Optimizations', hint: 'Generate and apply GPU/memory optimizations' },
                { value: 'rollback', label: '↩️   Rollback', hint: 'Restore a previous configuration backup' },
                { value: 'exit', label: '🚪  Exit', hint: 'Quit the optimizer' },
            ],
        });

        if (isCancel(action)) {
            running = false;
            break;
        }

        switch (action) {
            case 'status':
                printStatus(profile);
                break;
            case 'apply':
                await applyFlow(profile);
                break;
            case 'rollback':
                await rollbackFlow(profile);
                break;
            case 'exit':
                running = false;
                break;
        }
    }

    p.outro(pc.dim('Thanks for using GPU Optimizer!'));
}

main().catch(e => {
    console.error(pc.red('Fatal error:'), e);
    process.exit(1);
});
