import pc from 'picocolors';
import { loadConfig, saveConfig } from './config';

/**
 * Application entry point for the Universal GPU Optimizer.
 *
 * Dispatches to one of three interfaces based on CLI flags:
 * - No flags or `--tui` → Interactive TUI (terminal-kit, fullscreen)
 * - `--status`          → Print system status and exit
 * - `--detailed`        → Print detailed system profile and exit
 * - `--apply`           → Interactive apply flow (clack/prompts)
 * - `--rollback`        → Interactive rollback flow (clack/prompts)
 * - `--list-backups`    → List all available backup snapshots
 * - `--config k=v`      → Update a settings key
 * - `--help`            → Print usage and exit
 *
 * Global Flags:
 * - `--dry-run`         → Enables dry mode for the current session
 *
 * The existing @clack/prompts CLI is preserved as the CLI passthrough layer,
 * while the TUI provides a persistent fullscreen experience via terminal-kit.
 */
async function main(): Promise<void> {
    const args = Bun.argv.slice(2);

    // Global flag parsing
    if (args.includes('--dry-run')) {
        const config = loadConfig();
        config.dryMode = true;
        saveConfig(config);
        console.log(pc.yellow('⚠ Dry mode enabled for this session. No files will be modified.'));
        // We remove the flag so it doesn't interfere with command parsing
        const idx = args.indexOf('--dry-run');
        args.splice(idx, 1);
    }

    const flag = args[0] ?? '';

    if (flag === '--help' || flag === '-h') {
        printHelp();
        return;
    }

    if (flag === '--status' || flag === '-s') {
        const { cliStatus } = await import('./cli');
        await cliStatus();
        return;
    }

    if (flag === '--detailed' || flag === '-d') {
        const { cliDetailedStatus } = await import('./cli');
        await cliDetailedStatus();
        return;
    }

    if (flag === '--apply' || flag === '-a') {
        const { cliApply } = await import('./cli');
        await cliApply();
        return;
    }

    if (flag === '--rollback') {
        const { cliRollback } = await import('./cli');
        await cliRollback();
        return;
    }

    if (flag === '--list-backups') {
        const { cliListBackups } = await import('./cli');
        cliListBackups();
        return;
    }

    if (flag === '--config') {
        const { cliConfig } = await import('./cli');
        const kv = args[1];
        if (!kv) {
            console.error(pc.red('Error: Missing key=value argument for --config'));
            return;
        }
        cliConfig(kv);
        return;
    }

    const { launchTUI } = await import('./tui');
    await launchTUI();
}

/**
 * Prints the CLI usage/help message.
 */
function printHelp(): void {
    console.log('');
    console.log(pc.bold(pc.cyan('  Universal GPU Optimizer')) + pc.dim(' v0.3.0'));
    console.log('');
    console.log('  Usage:');
    console.log(`    ${pc.bold('gpu-optimizer')}                     Launch interactive TUI`);
    console.log(`    ${pc.bold('gpu-optimizer --tui')}               Launch interactive TUI (explicit)`);
    console.log(`    ${pc.bold('gpu-optimizer --status | -s')}       Print brief system status and exit`);
    console.log(`    ${pc.bold('gpu-optimizer --detailed | -d')}     Print detailed system info and exit`);
    console.log(`    ${pc.bold('gpu-optimizer --apply | -a')}        Apply optimizations (CLI interactive)`);
    console.log(`    ${pc.bold('gpu-optimizer --rollback')}          Rollback to a previous backup snapshot`);
    console.log(`    ${pc.bold('gpu-optimizer --list-backups')}      List all available backup snapshots`);
    console.log(`    ${pc.bold('gpu-optimizer --config <k>=<v>')}    Set a configuration value`);
    console.log(`    ${pc.bold('gpu-optimizer --help | -h')}         Show this help message`);
    console.log('');
    console.log('  Global Flags:');
    console.log(`    ${pc.bold('--dry-run')}                         Simulate changes without writing files`);
    console.log('');
}

main().catch(e => {
    console.error(pc.red('Fatal error:'), e);
    process.exit(1);
});
