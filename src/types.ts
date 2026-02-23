export type GPUVendor = 'Intel' | 'NVIDIA' | 'AMD';
export type BootloaderType = 'GRUB' | 'systemd-boot' | 'Unknown';
export type InitramfsType = 'mkinitcpio' | 'dracut' | 'update-initramfs' | 'Unknown';

export interface GPUDevice {
    vendor: GPUVendor;
    /** e.g., "8086:9a60" */
    pciId: string;
    /** e.g., "i915", "xe", "amdgpu", "radeon", "nvidia" */
    activeDriver: string;
}

export interface SystemProfile {
    gpus: GPUDevice[];
    /** e.g., Intel + NVIDIA detected */
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
