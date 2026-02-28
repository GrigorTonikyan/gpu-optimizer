import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome } from '../app';
import { getSettings } from '../../controllers';
import { formatBytes, formatTemp, formatPercent } from '../helpers';
import type { SystemProfile } from '../../types';

/**
 * Renders the brief system status screen.
 * Shows GPU details (model, driver, PCI ID, temps), CPU info,
 * memory stats, bootloader, initramfs, and display server.
 *
 * @param profile - The SystemProfile snapshot to display
 */
export async function showBriefStatus(profile: SystemProfile): Promise<void> {
    const config = await getSettings();
    refreshChrome(config);
    const startRow = clearContent();

    let row = startRow;

    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.cyan('System Status')));
    terminal.moveTo(3, row++);
    terminal.write(pc.dim('Press r to refresh, q to go back'));
    row++;

    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.white('GPUs')));
    terminal.moveTo(3, row++);
    terminal.write(pc.dim('─'.repeat(46)));

    if (profile.gpus.length === 0) {
        terminal.moveTo(3, row++);
        terminal.write(pc.dim('  No GPUs detected'));
    } else {
        for (const gpu of profile.gpus) {
            terminal.moveTo(3, row++);
            terminal.write(pc.bold(`  ${gpu.vendor} `));
            terminal.write(`${gpu.model}`);
            terminal.moveTo(3, row++);
            terminal.write(`    Driver: `);
            terminal.write(pc.green(gpu.activeDriver || 'none'));
            terminal.write(`  │  PCI: `);
            terminal.write(pc.yellow(gpu.pciId));
            if (gpu.stats?.temperature !== undefined) {
                terminal.write(`  │  Temp: `);
                terminal.write(formatTemp(gpu.stats.temperature));
            }
            if (gpu.stats?.utilization !== undefined) {
                terminal.write(`  │  Usage: `);
                terminal.write(formatPercent(gpu.stats.utilization));
            }
            if (gpu.stats?.vramTotal) {
                terminal.moveTo(3, row++);
                terminal.write(`    VRAM: ${formatBytes(gpu.stats.vramUsed ?? 0)} / ${formatBytes(gpu.stats.vramTotal)}`);
            }
        }
    }

    if (profile.isHybrid) {
        row++;
        terminal.moveTo(3, row++);
        terminal.write(pc.magenta('⚡ Hybrid GPU configuration detected'));
    }

    row++;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.white('CPU')));
    terminal.moveTo(3, row++);
    terminal.write(pc.dim('─'.repeat(46)));
    terminal.moveTo(3, row++);
    terminal.write(`  ${profile.cpuInfo.model}`);
    terminal.moveTo(3, row++);
    terminal.write(`  Cores: ${profile.cpuInfo.cores}  │  Usage: ${formatPercent(profile.cpuInfo.usagePercent)}  │  Temp: ${formatTemp(profile.cpuInfo.temperature)}`);

    row++;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.white('Memory')));
    terminal.moveTo(3, row++);
    terminal.write(pc.dim('─'.repeat(46)));
    terminal.moveTo(3, row++);
    terminal.write(`  Used: ${formatBytes(profile.memoryStats.used)} / ${formatBytes(profile.memoryStats.total)}  │  Free: ${formatBytes(profile.memoryStats.free)}`);
    terminal.moveTo(3, row++);
    terminal.write(`  ZRAM: `);
    terminal.write(profile.memory.hasZram ? pc.green('active') : pc.dim('inactive'));
    terminal.write(`  │  ZSWAP: `);
    terminal.write(profile.memory.hasZswap ? pc.yellow('active') : pc.dim('inactive'));

    row++;
    terminal.moveTo(3, row++);
    terminal.write(pc.bold(pc.white('System')));
    terminal.moveTo(3, row++);
    terminal.write(pc.dim('─'.repeat(46)));
    terminal.moveTo(3, row++);
    terminal.write(`  Display Server    ${profile.displayServer}`);
    terminal.moveTo(3, row++);
    terminal.write(`  Bootloader        ${profile.bootloader.type}`);
    if (profile.bootloader.configPath) {
        terminal.write(pc.dim(` (${profile.bootloader.configPath})`));
    }
    terminal.moveTo(3, row++);
    terminal.write(`  Initramfs         ${profile.initramfs}`);
    terminal.moveTo(3, row++);
    terminal.write(`  Kernel            ${profile.kernelVersion}`);

    if (profile.isImmutable) {
        row++;
        terminal.moveTo(3, row++);
        terminal.write(pc.yellow(`⚠  Immutable filesystem (${profile.immutableType})`));
    }

    return new Promise<void>((resolve) => {
        const handler = (key: string) => {
            if (key === 'q' || key === 'ESCAPE') {
                terminal.removeKeyListener(handler);
                resolve();
            } else if (key === 'r') {
                terminal.removeKeyListener(handler);
                resolve();
            }
        };
        terminal.onKey(handler);
    });
}
