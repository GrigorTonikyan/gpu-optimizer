import { getTerm, clearContent, refreshChrome } from '../app';
import { formatBytes, formatTemp, formatPercent, statusRow } from '../helpers';
import type { SystemProfile } from '../../types';

/**
 * Renders the brief system status screen.
 * Shows GPU details (model, driver, PCI ID, temps), CPU info,
 * memory stats, bootloader, initramfs, and display server.
 *
 * @param profile - The SystemProfile snapshot to display
 */
export async function showBriefStatus(profile: SystemProfile): Promise<void> {
    const term = getTerm();

    refreshChrome();
    const startRow = clearContent();

    let row = startRow;

    term.moveTo(3, row++);
    term.bold.cyan('System Status');
    term.moveTo(3, row++);
    term.dim('Press r to refresh, q to go back');
    row++;

    term.moveTo(3, row++);
    term.bold.white('GPUs');
    term.moveTo(3, row++);
    term.dim('─'.repeat(46));

    if (profile.gpus.length === 0) {
        term.moveTo(3, row++);
        term.dim('  No GPUs detected');
    } else {
        for (const gpu of profile.gpus) {
            term.moveTo(3, row++);
            term.bold(`  ${gpu.vendor} `);
            term(`${gpu.model}`);
            term.moveTo(3, row++);
            term(`    Driver: `);
            term.green(gpu.activeDriver || 'none');
            term(`  │  PCI: `);
            term.yellow(gpu.pciId);
            if (gpu.stats?.temperature !== undefined) {
                term(`  │  Temp: `);
                term(formatTemp(gpu.stats.temperature));
            }
            if (gpu.stats?.utilization !== undefined) {
                term(`  │  Usage: `);
                term(formatPercent(gpu.stats.utilization));
            }
            if (gpu.stats?.vramTotal) {
                term.moveTo(3, row++);
                term(`    VRAM: ${formatBytes(gpu.stats.vramUsed ?? 0)} / ${formatBytes(gpu.stats.vramTotal)}`);
            }
        }
    }

    if (profile.isHybrid) {
        row++;
        term.moveTo(3, row++);
        term.magenta('⚡ Hybrid GPU configuration detected');
    }

    row++;
    term.moveTo(3, row++);
    term.bold.white('CPU');
    term.moveTo(3, row++);
    term.dim('─'.repeat(46));
    term.moveTo(3, row++);
    term(`  ${profile.cpuInfo.model}`);
    term.moveTo(3, row++);
    term(`  Cores: ${profile.cpuInfo.cores}  │  Usage: ${formatPercent(profile.cpuInfo.usagePercent)}  │  Temp: ${formatTemp(profile.cpuInfo.temperature)}`);

    row++;
    term.moveTo(3, row++);
    term.bold.white('Memory');
    term.moveTo(3, row++);
    term.dim('─'.repeat(46));
    term.moveTo(3, row++);
    term(`  Used: ${formatBytes(profile.memoryStats.used)} / ${formatBytes(profile.memoryStats.total)}  │  Free: ${formatBytes(profile.memoryStats.free)}`);
    term.moveTo(3, row++);
    term(`  ZRAM: `);
    profile.memory.hasZram ? term.green('active') : term.dim('inactive');
    term(`  │  ZSWAP: `);
    profile.memory.hasZswap ? term.yellow('active') : term.dim('inactive');

    row++;
    term.moveTo(3, row++);
    term.bold.white('System');
    term.moveTo(3, row++);
    term.dim('─'.repeat(46));
    term.moveTo(3, row++);
    term(`  Display Server    ${profile.displayServer}`);
    term.moveTo(3, row++);
    term(`  Bootloader        ${profile.bootloader.type}`);
    if (profile.bootloader.configPath) {
        term.dim(` (${profile.bootloader.configPath})`);
    }
    term.moveTo(3, row++);
    term(`  Initramfs         ${profile.initramfs}`);
    term.moveTo(3, row++);
    term(`  Kernel            ${profile.kernelVersion}`);

    if (profile.isImmutable) {
        row++;
        term.moveTo(3, row++);
        term.yellow(`⚠  Immutable filesystem (${profile.immutableType})`);
    }

    return new Promise<void>((resolve) => {
        const handler = (key: string) => {
            if (key === 'q' || key === 'ESCAPE') {
                term.removeListener('key', handler);
                resolve();
            } else if (key === 'r') {
                term.removeListener('key', handler);
                resolve();
            }
        };
        term.on('key', handler);
    });
}
