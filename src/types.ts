export type GPUVendor = 'Intel' | 'NVIDIA' | 'AMD';
export type BootloaderType = 'GRUB' | 'systemd-boot' | 'Unknown';
export type InitramfsType = 'mkinitcpio' | 'dracut' | 'update-initramfs' | 'Unknown';

/** Injection target for an optimization rule */
export type OptimizationTarget = 'kernel-param' | 'modprobe';

/** Severity level indicating how critical an optimization is */
export type OptimizationSeverity = 'recommended' | 'optional';

export interface GPUDevice {
    vendor: GPUVendor;
    /** e.g., "8086:9a60" — crucial for Intel Xe binding and force_probe */
    pciId: string;
    /** e.g., "i915", "xe", "amdgpu", "radeon", "nvidia" */
    activeDriver: string;
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
