import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GPUDevice } from '../types';

/**
 * Collects CPU information as a point-in-time snapshot.
 * Reads `/proc/cpuinfo` for the model name and core count,
 * and computes aggregate usage from two `/proc/stat` samples ~100ms apart.
 *
 * @returns CPU telemetry object matching `SystemProfile.cpuInfo`
 */
export function collectCpuInfo(): {
    model: string;
    cores: number;
    usagePercent: number;
    temperature?: number;
} {
    let model = 'Unknown';
    let cores = 1;

    try {
        const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8');
        const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/i);
        if (modelMatch?.[1]) {
            model = modelMatch[1].trim();
        }
        const coreMatches = cpuinfo.match(/^processor\s*:/gim);
        if (coreMatches) {
            cores = coreMatches.length;
        }
    } catch {
        /** /proc/cpuinfo unavailable */
    }

    const usagePercent = computeCpuUsage();
    const temperature = readCpuTemperature();

    return { model, cores, usagePercent, temperature };
}

/**
 * Computes aggregate CPU usage by sampling `/proc/stat` twice with a 100ms delay.
 * Uses the standard idle-delta / total-delta formula.
 *
 * @returns CPU usage as a percentage (0–100), or 0 if `/proc/stat` is unavailable
 */
function computeCpuUsage(): number {
    try {
        const sample1 = parseProcStat();
        const waitResult = Bun.sleepSync(100);
        void waitResult;
        const sample2 = parseProcStat();

        const totalDelta = sample2.total - sample1.total;
        const idleDelta = sample2.idle - sample1.idle;

        if (totalDelta === 0) return 0;
        return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
    } catch {
        return 0;
    }
}

/**
 * Parses the first (aggregate) line of `/proc/stat` to extract
 * total and idle CPU time values.
 */
function parseProcStat(): { total: number; idle: number } {
    const stat = readFileSync('/proc/stat', 'utf-8');
    const cpuLine = stat.split('\n')[0];
    if (!cpuLine) return { total: 0, idle: 0 };

    const values = cpuLine.replace(/^cpu\s+/, '').split(/\s+/).map(Number);
    const total = values.reduce((sum, v) => sum + v, 0);
    const idle = values[3] ?? 0;

    return { total, idle };
}

/**
 * Reads CPU package temperature from hwmon sysfs.
 * Scans `/sys/class/hwmon/` for `coretemp` (Intel) or `k10temp` (AMD) sensors.
 *
 * @returns Temperature in °C, or `undefined` if no sensor is found
 */
function readCpuTemperature(): number | undefined {
    try {
        const hwmonBase = '/sys/class/hwmon';
        if (!existsSync(hwmonBase)) return undefined;

        const hwmons = readdirSync(hwmonBase);
        for (const hwmon of hwmons) {
            const namePath = join(hwmonBase, hwmon, 'name');
            if (!existsSync(namePath)) continue;

            const name = readFileSync(namePath, 'utf-8').trim();
            if (name === 'coretemp' || name === 'k10temp') {
                const tempPath = join(hwmonBase, hwmon, 'temp1_input');
                if (existsSync(tempPath)) {
                    const raw = readFileSync(tempPath, 'utf-8').trim();
                    return Math.round(parseInt(raw, 10) / 1000);
                }
            }
        }
    } catch {
        /** hwmon unavailable */
    }
    return undefined;
}

/**
 * Collects detailed memory statistics from `/proc/meminfo`.
 *
 * @returns Memory telemetry object matching `SystemProfile.memoryStats`
 */
export function collectMemoryStats(): { total: number; used: number; free: number } {
    try {
        const meminfo = readFileSync('/proc/meminfo', 'utf-8');
        const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/i);
        const freeMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/i);

        const totalKb = totalMatch ? parseInt(totalMatch[1]!, 10) : 0;
        const freeKb = freeMatch ? parseInt(freeMatch[1]!, 10) : 0;

        const total = totalKb * 1024;
        const free = freeKb * 1024;
        const used = total - free;

        return { total, used, free };
    } catch {
        return { total: 0, used: 0, free: 0 };
    }
}

/**
 * Enriches a GPU device with real-time telemetry stats.
 * Sources vary by vendor:
 * - **Intel/AMD**: reads from DRM sysfs (`/sys/class/drm/card*`)
 * - **NVIDIA**: reads from `nvidia-smi` CLI output
 *
 * @param gpu - The GPU device to collect stats for
 * @returns The stats object, or `undefined` if no data is available
 */
export function collectGpuStats(gpu: GPUDevice): GPUDevice['stats'] {
    try {
        if (gpu.vendor === 'NVIDIA') {
            return collectNvidiaStats();
        }
        return collectDrmStats(gpu);
    } catch {
        return undefined;
    }
}

/**
 * Collects NVIDIA GPU stats via `nvidia-smi` CLI.
 * Parses CSV output for temperature, utilization, and VRAM usage.
 */
function collectNvidiaStats(): GPUDevice['stats'] {
    try {
        const { stdout, success } = Bun.spawnSync([
            'nvidia-smi',
            '--query-gpu=temperature.gpu,utilization.gpu,memory.total,memory.used',
            '--format=csv,noheader,nounits'
        ]);

        if (!success) return undefined;
        const output = stdout.toString().trim();

        const parts = output.split(',').map((s: string) => s.trim());
        if (parts.length < 4) return undefined;

        return {
            temperature: parseInt(parts[0]!, 10) || undefined,
            utilization: parseInt(parts[1]!, 10) || undefined,
            vramTotal: (parseInt(parts[2]!, 10) || 0) * 1024 * 1024,
            vramUsed: (parseInt(parts[3]!, 10) || 0) * 1024 * 1024,
        };
    } catch {
        return undefined;
    }
}

/**
 * Collects GPU stats from the DRM sysfs interface for Intel and AMD GPUs.
 * - Temperature: `/sys/class/drm/card{N}/device/hwmon/hwmon{M}/temp1_input`
 * - Utilization (AMD): `/sys/class/drm/card{N}/device/gpu_busy_percent`
 * - VRAM (AMD): `/sys/class/drm/card{N}/device/mem_info_vram_total` and `_used`
 */
function collectDrmStats(gpu: GPUDevice): GPUDevice['stats'] {
    const drmBase = '/sys/class/drm';
    if (!existsSync(drmBase)) return undefined;

    const cards = readdirSync(drmBase).filter(c => /^card\d+$/.test(c));

    for (const card of cards) {
        const devicePath = join(drmBase, card, 'device');
        if (!existsSync(devicePath)) continue;

        let temperature: number | undefined;
        let utilization: number | undefined;
        let vramTotal: number | undefined;
        let vramUsed: number | undefined;

        const hwmonPath = join(devicePath, 'hwmon');
        if (existsSync(hwmonPath)) {
            const hwmons = readdirSync(hwmonPath);
            for (const h of hwmons) {
                const tempPath = join(hwmonPath, h, 'temp1_input');
                if (existsSync(tempPath)) {
                    const raw = readFileSync(tempPath, 'utf-8').trim();
                    temperature = Math.round(parseInt(raw, 10) / 1000);
                    break;
                }
            }
        }

        if (gpu.vendor === 'AMD') {
            const busyPath = join(devicePath, 'gpu_busy_percent');
            if (existsSync(busyPath)) {
                utilization = parseInt(readFileSync(busyPath, 'utf-8').trim(), 10);
            }

            const vramTotalPath = join(devicePath, 'mem_info_vram_total');
            const vramUsedPath = join(devicePath, 'mem_info_vram_used');
            if (existsSync(vramTotalPath)) {
                vramTotal = parseInt(readFileSync(vramTotalPath, 'utf-8').trim(), 10);
            }
            if (existsSync(vramUsedPath)) {
                vramUsed = parseInt(readFileSync(vramUsedPath, 'utf-8').trim(), 10);
            }
        }

        if (temperature !== undefined || utilization !== undefined) {
            return { temperature, utilization, vramTotal, vramUsed };
        }
    }

    return undefined;
}
