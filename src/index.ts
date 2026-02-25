import pc from 'picocolors';

/**
 * Application entry point for the Universal GPU Optimizer.
 *
 * Dispatches to one of three interfaces based on CLI flags:
 * - No flags or `--tui` → Interactive TUI (terminal-kit, fullscreen)
 * - `--status`          → Print system status and exit
 * - `--apply`           → Interactive apply flow (clack/prompts)
 * - `--rollback`        → Interactive rollback flow (clack/prompts)
 * - `--help`            → Print usage and exit
 *
 * The existing @clack/prompts CLI is preserved as the CLI passthrough layer,
 * while the TUI provides a persistent fullscreen experience via terminal-kit.
 */
async function main(): Promise<void> {
    const args = Bun.argv.slice(2);
    const flag = args[0] ?? '';

    if (flag === '--help' || flag === '-h') {
        printHelp();
        return;
    }

    if (flag === '--status') {
        const { cliStatus } = await import('./cli');
        await cliStatus();
        return;
    }

    if (flag === '--apply') {
        const { cliApply } = await import('./cli');
        await cliApply();
        return;
    }

    if (flag === '--rollback') {
        const { cliRollback } = await import('./cli');
        await cliRollback();
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
    console.log(`    ${pc.bold('gpu-optimizer')}             Launch interactive TUI`);
    console.log(`    ${pc.bold('gpu-optimizer --tui')}       Launch interactive TUI (explicit)`);
    console.log(`    ${pc.bold('gpu-optimizer --status')}    Print system status and exit`);
    console.log(`    ${pc.bold('gpu-optimizer --apply')}     Apply optimizations (CLI mode)`);
    console.log(`    ${pc.bold('gpu-optimizer --rollback')}  Rollback to a previous backup`);
    console.log(`    ${pc.bold('gpu-optimizer --help')}      Show this help message`);
    console.log('');
}

main().catch(e => {
    console.error(pc.red('Fatal error:'), e);
    process.exit(1);
});
