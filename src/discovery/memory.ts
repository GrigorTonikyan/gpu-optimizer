import { existsSync, readFileSync } from 'node:fs';
import { runUser } from '../utils/shell';

export function detectMemory(): { hasZram: boolean; hasZswap: boolean } {
    let hasZram = false;
    let hasZswap = false;

    /** Check ZRAM */
    try {
        hasZram = runUser('which zramctl').trim().length > 0;
    } catch {
        /** Fallback or not found */
        if (existsSync('/proc/swaps')) {
            const swaps = readFileSync('/proc/swaps', 'utf-8');
            hasZram = swaps.includes('/dev/zram');
        }
    }

    /** Check ZSWAP */
    if (existsSync('/sys/module/zswap/parameters/enabled')) {
        try {
            const zswapEnabled = readFileSync('/sys/module/zswap/parameters/enabled', 'utf-8').trim();
            hasZswap = (zswapEnabled === 'Y' || zswapEnabled === '1');
        } catch (e) {
            /** Ignore read error */
        }
    }

    return { hasZram, hasZswap };
}
