# PRD ADDENDUM: 2026 Modernization & Edge Cases

## 1. Architectural Expansion: Immutable & Atomic Distros

The tool cannot assume the root filesystem is writable (`/etc/`, `/boot/`, etc.). Modern Linux (Fedora Silverblue, Bazzite, SteamOS, NixOS) uses atomic updates.

* **Constraint 5:** The Discovery Engine MUST check for immutability.
* Check for `rpm-ostree` (Fedora Atomic).
* Check for `steamos-readonly` (SteamOS).
* Check for NixOS (`/etc/NIXOS`).


* **Action Logic:** If an immutable system is detected, the standard file-writing method (via `sudo tee`) must be bypassed. Instead, the tool must instruct the user on the distro-specific command (e.g., `rpm-ostree kargs --append=...`) or gracefully exit indicating manual intervention is required.

## 2. Updated Data Structures

*Agent Instructions: Merge these properties into the existing `SystemProfile` interface.*

```typescript
interface SystemProfile {
  // ... existing properties ...
  displayServer: 'Wayland' | 'X11' | 'Unknown';
  isImmutable: boolean;
  immutableType?: 'ostree' | 'steamos' | 'nixos';
  /** Parsed from `uname -r` */
  kernelVersion: string;
  /** Extended stats for brief/detailed views */
  cpuInfo: {
    model: string;
    cores: number;
    usagePercent: number;
    temperature?: number;
  };
  memoryStats: {
    total: number;
    used: number;
    free: number;
  };
}

interface GPUDevice {
  vendor: GPUVendor;
  model: string;
  /** e.g., "8086:9a60" (Crucial for Intel Xe binding) */
  pciId: string;
  /** e.g., "i915", "xe", "amdgpu", "radeon" */
  activeDriver: string;
  currentState: string;
  stats?: {
    temperature?: number;
    utilization?: number;
    vramTotal?: number;
    vramUsed?: number;
  };
}

```

## 3. Modern Optimization Matrix (Kernel 6.19+ Standards)

### 3.1 Intel: The `i915` vs `xe` Driver Shift

Intel is actively migrating from the legacy `i915` driver to the modern `xe` driver. While `xe` is default on Lunar Lake and newer, older chips (Tiger Lake, Alder Lake, Meteor Lake, Alchemist) can see significant compute/Vulkan gains by forcing the `xe` driver.

* **Detection:** Use `lspci -nnk` to extract the PCI-ID (e.g., `8086:56a0`).
* **Injection Rule:** If the user elects to use the modern `xe` driver on supported older hardware, the injector must add: `i915.force_probe=!<PCI-ID> xe.force_probe=<PCI-ID>`.

### 3.2 AMD: RDNA3/RDNA4 & Legacy Support

The AMD landscape has shifted. Kernel 6.19 moved legacy GCN 1.0/1.1 cards to `amdgpu` by default, but modern RDNA cards require specific parameters for stability.

* **RDNA3 Stability Rule:** If random hangs or "fence timeouts" are reported in logs (or simply as a safe default for Navi 3x chips), queue: `amdgpu.sg_display=0` and `amdgpu.tmz=0` (disables Trusted Memory Zone which causes freezes).
* **Power Management:** Queue `amdgpu.ppfeaturemask=0xffffffff` to unlock OverDrive/undervolting capabilities via tools like CoreCtrl.

### 3.3 NVIDIA: Wayland Native

* **Display Server Detection:** The agent must check `process.env.XDG_SESSION_TYPE`.
* **Wayland Rule:** If `Wayland` + `NVIDIA` are detected, `nvidia-drm.modeset=1` is strictly mandatory. Optionally, suggest adding `nvidia-drm.fbdev=1` for the newer 550+ proprietary drivers to fix Wayland flickering.

## 4. Enhanced Safety: The "Boot Rescue" Generator

Writing kernel parameters is inherently risky. If a parameter causes a kernel panic, the user needs to know how to fix it before they apply the change.

* **Pre-Flight Requirement:** Before executing the `mkinitcpio`/`dracut` rebuild, the CLI MUST print a "Rescue Guide".
* **Example Output:** *"If your system fails to boot, press 'e' at the GRUB menu (or Space at systemd-boot), find the line starting with 'linux', delete the parameters we just added, and press F10 to boot normally."*

## 5. Implementation Stage 7: Systemd & Udev Rules

GPU optimization isn't just about kernel parameters; it involves system services.

* [ ] **7.1 NVIDIA Persistence:** If NVIDIA is detected, offer to enable the persistence daemon to prevent module load/unload lag: `shell.runElevated('systemctl enable --now nvidia-persistenced')`.
* [ ] **7.2 PCI Power Management (`udev`):** Create a staging file for `/etc/udev/rules.d/80-gpu-pm.rules` to set `ACTION=="add", SUBSYSTEM=="pci", ATTR{vendor}=="0x10de", ATTR{power/control}="auto"` to ensure the dGPU sleeps properly in Hybrid setups.

