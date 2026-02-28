export type GPUVendor = 'Intel' | 'NVIDIA' | 'AMD';
export type BootloaderType = 'GRUB' | 'systemd-boot' | 'Unknown';
export type InitramfsType = 'mkinitcpio' | 'dracut' | 'update-initramfs' | 'Unknown';

/** Injection target for an optimization rule */
export type OptimizationTarget = 'kernel-param' | 'modprobe';

/** Severity level indicating how critical an optimization is */
export type OptimizationSeverity = 'recommended' | 'optional';

export interface GPUDevice {
    vendor: GPUVendor;
    /** Human-readable model name extracted from lspci, e.g. "Intel UHD Graphics 770" */
    model: string;
    /** e.g., "8086:9a60" — crucial for Intel Xe binding and force_probe */
    pciId: string;
    /** e.g., "i915", "xe", "amdgpu", "radeon", "nvidia" */
    activeDriver: string;
    /** Real-time GPU telemetry, populated on-demand per snapshot */
    stats?: {
        /** GPU die temperature in °C, read from hwmon sysfs */
        temperature?: number;
        /** GPU utilization percentage (0–100) */
        utilization?: number;
        /** Total VRAM in bytes (NVIDIA/AMD only) */
        vramTotal?: number;
        /** Used VRAM in bytes (NVIDIA/AMD only) */
        vramUsed?: number;
    };
}

export interface SystemProfile {
    gpus: GPUDevice[];
    /** `true` when multiple distinct GPU vendors are detected (e.g., Intel + NVIDIA) */
    isHybrid: boolean;
    displayServer: 'Wayland' | 'X11' | 'Unknown';
    isImmutable: boolean;
    immutableType?: 'ostree' | 'steamos' | 'nixos';
    /** Parsed from `uname -r` */
    kernelVersion: string;
    bootloader: {
        type: BootloaderType;
        /** Resolved path to the active config */
        configPath: string;
    };
    initramfs: InitramfsType;
    memory: {
        hasZram: boolean;
        hasZswap: boolean;
    };
    /** CPU information for the status display */
    cpuInfo: {
        /** CPU model string from /proc/cpuinfo */
        model: string;
        /** Number of logical cores */
        cores: number;
        /** Current aggregate CPU usage percentage (0–100) */
        usagePercent: number;
        /** CPU package temperature in °C from hwmon sysfs */
        temperature?: number;
    };
    /** Detailed memory statistics from /proc/meminfo */
    memoryStats: {
        /** Total physical RAM in bytes */
        total: number;
        /** Used RAM in bytes */
        used: number;
        /** Free RAM in bytes */
        free: number;
    };
}

/** Standardized log levels for the application */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Persistent application configuration stored at
 * `$XDG_CONFIG_HOME/gpu-optimizer/config.json`.
 * Validated with zod on load to prevent corrupt state.
 */
export interface AppConfig {
    /** Verbosity level: default debug (dev), info (prod) */
    verbosity: LogLevel;
    /** Enable logging to files */
    loggingEnabled: boolean;
    /** Custom path overrides (absolute paths allowed) */
    paths: {
        /** default: XDG_CONFIG_HOME/gpu-optimizer/config.json */
        config?: string;
        /** default: XDG_DATA_HOME/gpu-optimizer/ */
        data?: string;
        /** default: XDG_STATE_HOME/gpu-optimizer/logs/ */
        logs?: string;
    };
    /** Backup storage configuration */
    backupPaths: {
        /** The directory where NEW backups are saved by default */
        primary: string;
        /** Additional directories scanned for existing backups (read-only) */
        sources: string[];
    };
    /** Dry mode: simulate all mutations without writing */
    dryMode: boolean;
}

/**
 * A single optimization action the engine recommends.
 * Each rule represents one kernel parameter or modprobe option
 * that should be applied to the system.
 */
export interface OptimizationRule {
    /** Unique identifier for this rule, e.g. "intel-guc-huc" */
    id: string;
    /** Which vendor (or "system" for non-GPU rules like memory) this rule targets */
    vendor: GPUVendor | 'system';
    /** Human-readable explanation of what this rule does */
    description: string;
    /** Where this rule injects: kernel cmdline or modprobe config */
    target: OptimizationTarget;
    /** The actual parameter string, e.g. "nvidia-drm.modeset=1" */
    value: string;
    /** Whether this is recommended for stability or optional for power users */
    severity: OptimizationSeverity;
    /** Whether this optimization is already applied to the system */
    isApplied?: boolean;
}

/**
 * Complete output of the optimization matrix.
 * Separates rules by injection target for the mutation engine.
 */
export interface OptimizationPlan {
    /** Rules that go into the bootloader kernel cmdline (GRUB/systemd-boot) */
    kernelParams: OptimizationRule[];
    /** Rules that go into modprobe.d config files */
    modprobeOptions: OptimizationRule[];
}

/**
 * Record of a backup snapshot created before applying mutations.
 * Stored in `~/.local/state/gpu-optimizer/backups/`.
 */
export interface BackupRecord {
    /** Timestamp ISO string used as the unique backup identifier */
    id: string;
    /** Human-readable date string for display in the rollback menu */
    date: string;
    /** List of files captured in this backup snapshot */
    files: {
        /** Absolute path to the original system file */
        originalPath: string;
        /** Path within the backup folder where the copy is stored */
        backupPath: string;
    }[];
}

/**
 * Represents a file mutation that has been staged to a temp file
 * but not yet applied. Contains the diff for user review.
 */
export interface StagedMutation {
    /** Path to the staged temp file containing the modified content */
    stagedPath: string;
    /** Absolute path to the target system file to be overwritten */
    targetPath: string;
    /** Color-coded diff string for terminal display */
    diff: string;
}
