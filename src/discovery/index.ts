import type { SystemProfile } from '../types';
import { detectGPUs, detectDisplayServer, getKernelVersion } from './hardware';
import { detectBootloader } from './boot';
import { detectInitramfs } from './initramfs';
import { detectMemory } from './memory';
import { detectImmutability } from './immutability';
import { collectCpuInfo, collectMemoryStats, collectGpuStats } from './telemetry';

/**
 * Performs a full system discovery pass and returns a complete SystemProfile.
 * Aggregates hardware detection, boot infrastructure resolution, memory
 * profiling, immutability checks, and point-in-time telemetry snapshots.
 */
export async function discoverSystem(): Promise<SystemProfile> {
    const { gpus, isHybrid } = detectGPUs();
    const displayServer = detectDisplayServer();
    const kernelVersion = getKernelVersion();
    const bootloader = detectBootloader(kernelVersion);
    const initramfs = detectInitramfs();
    const memory = detectMemory();
    const { isImmutable, immutableType } = detectImmutability();

    const cpuInfo = collectCpuInfo();
    const memoryStats = collectMemoryStats();

    const enrichedGpus = gpus.map(gpu => ({
        ...gpu,
        stats: collectGpuStats(gpu),
    }));

    return {
        gpus: enrichedGpus,
        isHybrid,
        displayServer,
        isImmutable,
        immutableType,
        kernelVersion,
        bootloader,
        initramfs,
        memory,
        cpuInfo,
        memoryStats,
    };
}

