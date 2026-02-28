import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome, getContentHeight } from '../app';
import { getSettings } from '../../controllers';
import { formatBytes, formatTemp, formatPercent } from '../helpers';
import type { SystemProfile } from '../../types';

/**
 * Renders the detailed system info screen with scrollable content.
 * Provides exhaustive information about OS, hardware, and configuration
 * with explanations and improvement recommendations.
 *
 * @param profile - The SystemProfile snapshot to display
 */
export async function showDetailedStatus(profile: SystemProfile): Promise<void> {
    const lines = buildDetailLines(profile);

    let scrollOffset = 0;
    const maxOffset = Math.max(0, lines.length - getContentHeight());

    async function render(): Promise<void> {
        const config = await getSettings();
        refreshChrome(config);
        clearContent();

        const contentHeight = getContentHeight();
        const visible = lines.slice(scrollOffset, scrollOffset + contentHeight);

        for (let i = 0; i < visible.length; i++) {
            terminal.moveTo(3, 4 + i);
            terminal.write(visible[i]!);
        }

        terminal.moveTo(3, terminal.height - 1);
        terminal.write(pc.dim(`  Lines ${scrollOffset + 1}–${Math.min(scrollOffset + contentHeight, lines.length)} of ${lines.length}  │  ↑↓ Scroll  │  q Back`));
    }

    await render();

    return new Promise<void>((resolve) => {
        const handler = (key: string) => {
            if (key === 'q' || key === 'ESCAPE') {
                terminal.removeKeyListener(handler);
                resolve();
                return;
            }
            if (key === 'UP' && scrollOffset > 0) {
                scrollOffset--;
                render();
            }
            if (key === 'DOWN' && scrollOffset < maxOffset) {
                scrollOffset++;
                render();
            }
            if (key === 'PAGE_UP') {
                scrollOffset = Math.max(0, scrollOffset - 10);
                render();
            }
            if (key === 'PAGE_DOWN') {
                scrollOffset = Math.min(maxOffset, scrollOffset + 10);
                render();
            }
        };
        terminal.onKey(handler);
    });
}

/**
 * Builds the complete set of detail lines for the scrollable view.
 */
function buildDetailLines(profile: SystemProfile): string[] {
    const lines: string[] = [];

    lines.push('═══ DETAILED SYSTEM INFORMATION ═══');
    lines.push('');

    lines.push('─── GPU DEVICES ───');
    lines.push('');

    if (profile.gpus.length === 0) {
        lines.push('  No GPUs detected on this system.');
    } else {
        for (const gpu of profile.gpus) {
            lines.push(`  Vendor:       ${gpu.vendor}`);
            lines.push(`  Model:        ${gpu.model}`);
            lines.push(`  PCI ID:       ${gpu.pciId}`);
            lines.push(`  Driver:       ${gpu.activeDriver || 'none'}`);

            if (gpu.stats) {
                if (gpu.stats.temperature !== undefined) {
                    lines.push(`  Temperature:  ${gpu.stats.temperature}°C`);
                }
                if (gpu.stats.utilization !== undefined) {
                    lines.push(`  Utilization:  ${gpu.stats.utilization}%`);
                }
                if (gpu.stats.vramTotal !== undefined) {
                    lines.push(`  VRAM Total:   ${formatBytes(gpu.stats.vramTotal)}`);
                    lines.push(`  VRAM Used:    ${formatBytes(gpu.stats.vramUsed ?? 0)}`);
                }
            }

            lines.push('');

            if (gpu.vendor === 'Intel') {
                lines.push('  ℹ  Intel GPU Configuration:');
                if (gpu.activeDriver === 'i915') {
                    lines.push('     The legacy i915 driver is in use. Modern Intel GPUs (Gen 12+)');
                    lines.push('     can benefit from the newer xe driver. Enable GuC/HuC/FBC for');
                    lines.push('     hardware-accelerated scheduling and framebuffer compression.');
                } else if (gpu.activeDriver === 'xe') {
                    lines.push('     The modern xe driver is active. No additional kernel params needed.');
                }
            } else if (gpu.vendor === 'NVIDIA') {
                lines.push('  ℹ  NVIDIA GPU Configuration:');
                lines.push('     DRM modesetting (nvidia-drm.modeset=1) is mandatory for proper');
                lines.push('     desktop compositing. On Wayland, nvidia-drm.fbdev=1 may resolve');
                lines.push('     flickering issues with driver version 550+.');
            } else if (gpu.vendor === 'AMD') {
                lines.push('  ℹ  AMD GPU Configuration:');
                lines.push('     Enabling ppfeaturemask=0xffffffff unlocks OverDrive for undervolting');
                lines.push('     via CoreCtrl. RDNA3 GPUs may benefit from sg_display=0 and tmz=0');
                lines.push('     to prevent fence timeout hangs.');
            }
            lines.push('');
        }

        if (profile.isHybrid) {
            lines.push('  ⚡ HYBRID GPU: Multiple vendors detected.');
            lines.push('     Power management udev rules can put the dGPU to sleep when idle.');
            lines.push('');
        }
    }

    lines.push('─── CPU ───');
    lines.push('');
    lines.push(`  Model:        ${profile.cpuInfo.model}`);
    lines.push(`  Cores:        ${profile.cpuInfo.cores}`);
    lines.push(`  Usage:        ${profile.cpuInfo.usagePercent}%`);
    if (profile.cpuInfo.temperature !== undefined) {
        lines.push(`  Temperature:  ${profile.cpuInfo.temperature}°C`);
    }
    lines.push('');

    lines.push('─── MEMORY ───');
    lines.push('');
    lines.push(`  Total:        ${formatBytes(profile.memoryStats.total)}`);
    lines.push(`  Used:         ${formatBytes(profile.memoryStats.used)}`);
    lines.push(`  Free:         ${formatBytes(profile.memoryStats.free)}`);
    lines.push(`  ZRAM:         ${profile.memory.hasZram ? 'Active' : 'Inactive'}`);
    lines.push(`  ZSWAP:        ${profile.memory.hasZswap ? 'Active' : 'Inactive'}`);

    if (profile.memory.hasZram && profile.memory.hasZswap) {
        lines.push('');
        lines.push('  ⚠  Both ZRAM and ZSWAP are active. This is redundant.');
        lines.push('     Recommendation: Disable ZSWAP (zswap.enabled=0) when using ZRAM.');
    }
    lines.push('');

    lines.push('─── BOOT INFRASTRUCTURE ───');
    lines.push('');
    lines.push(`  Bootloader:   ${profile.bootloader.type}`);
    if (profile.bootloader.configPath) {
        lines.push(`  Config Path:  ${profile.bootloader.configPath}`);
    }
    lines.push(`  Initramfs:    ${profile.initramfs}`);
    lines.push(`  Kernel:       ${profile.kernelVersion}`);
    lines.push('');

    lines.push('─── DISPLAY ───');
    lines.push('');
    lines.push(`  Server:       ${profile.displayServer}`);
    if (profile.displayServer === 'Wayland') {
        lines.push('  ℹ  Wayland is the active display server. NVIDIA GPUs require');
        lines.push('     nvidia-drm.modeset=1 for proper Wayland compositing.');
    }
    lines.push('');

    if (profile.isImmutable) {
        lines.push('─── IMMUTABLE SYSTEM ───');
        lines.push('');
        lines.push(`  Type: ${profile.immutableType}`);
        lines.push('  ⚠  This system uses an immutable filesystem.');
        lines.push('     Direct file writes are not supported. Use distribution-specific');
        lines.push('     commands to modify kernel parameters.');
        lines.push('');
    }

    return lines;
}
