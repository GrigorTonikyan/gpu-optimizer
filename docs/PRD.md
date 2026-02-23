# PROJECT REQUIREMENT DOCUMENT (PRD): Universal GPU Optimizer

## 1. Project Overview

**Name:** Universal GPU Optimizer (CLI)
**Environment:** Linux (Distribution Agnostic)
**Runtime:** Bun + TypeScript
**Goal:** A safe, interactive, non-root CLI tool that analyzes a Linux system’s hardware (Intel, AMD, NVIDIA GPUs), discovers its boot/init infrastructure, and applies optimal kernel parameters and module configurations (like GuC/HuC, FBC, DRM modesetting, and zram/zswap tuning).

## 2. Core Architectural Constraints

The agent MUST adhere strictly to these constraints:

1. **Just-In-Time (JIT) Privilege Escalation:** The application MUST NOT be run as `root` or with `sudo` directly. It runs in user-space. When a file write or elevated command (like `mkinitcpio`) is required, it must wrap the specific command using `sudo` (e.g., `sudo tee`, `sudo cp`, or `sudo <cmd>`).
2. **Zero-Destruction / Atomic Operations:** No file is ever modified directly.
* Files are copied to a timestamped backup directory (`~/.local/state/gpu-optimizer/backups/`).
* Modifications are made to a temporary staging file (`/tmp/gpu-opt-...`).
* A diff is presented to the user.
* Only upon confirmation is the staged file moved to the system directory using elevated privileges.


3. **Agnostic Discovery:** Do not hardcode paths like `/boot/loader`. The system must probe for GRUB, systemd-boot, rEFInd, and initramfs generators (mkinitcpio, dracut, update-initramfs).
4. **UI/UX:** Use `@clack/prompts` for interactive menus and `picocolors` for terminal output.

---

## 3. Core Data Structures (TypeScript Interfaces)

*Agent Instructions: Implement these interfaces early to ensure type safety across modules.*

```typescript
type GPUVendor = 'Intel' | 'NVIDIA' | 'AMD';
type BootloaderType = 'GRUB' | 'systemd-boot' | 'Unknown';
type InitramfsType = 'mkinitcpio' | 'dracut' | 'update-initramfs' | 'Unknown';

interface SystemProfile {
  gpus: GPUVendor[];
  /** e.g., Intel + NVIDIA detected */
  isHybrid: boolean;
  bootloader: {
    type: BootloaderType;
    configPath: string; // Resolved path to the active config
  };
  initramfs: InitramfsType;
  memory: {
    hasZram: boolean;
    hasZswap: boolean;
  };
}

interface BackupRecord {
  /** Timestamp ISO */
  id: string;
  /** Human readable */
  date: string;
  files: {
    originalPath: string;
    backupPath: string; // Path within the backup folder
  }[];
}

```

---

## 4. Implementation Stages (The To-Do List)

The agent must implement the application sequentially following these stages:

### Stage 1: Scaffolding & Utility Layer

* [ ] **1.1 Project Init:** Initialize Bun project, configure `tsconfig.json` for ESNext, Node resolution, and strict typing. Install `@clack/prompts`, `picocolors`, and `zod`.
* [ ] **1.2 Shell Execution Wrapper (`src/utils/shell.ts`):** Create a robust wrapper around `node:child_process.execSync`.
* Implement `runUser(cmd)`: Returns stdout.
* Implement `runElevated(cmd)`: Wraps command in `sudo`.
* Implement `writeElevated(path, content)`: Uses `echo "<content>" | sudo tee <path> > /dev/null` to safely write protected files.


* [ ] **1.3 File Staging System:** Create a utility to generate unique temp files in `/tmp` for staging edits before applying them.

### Stage 2: The Discovery Engine (`src/discovery/`)

* [ ] **2.1 GPU Detection (`hardware.ts`):** Parse `lspci -nnk` to detect VGA/3D controllers. Return an array of detected `GPUVendor`s and set `isHybrid` if length > 1.
* [ ] **2.2 Bootloader Resolution (`boot.ts`):** - Check for GRUB (`/etc/default/grub`).
* Check for systemd-boot by probing `/boot/loader/entries/`, `/efi/loader/entries/`, and `/boot/efi/loader/entries/`. Locate the active `.conf` file based on the current kernel (`uname -r`).


* [ ] **2.3 Initramfs Resolution (`initramfs.ts`):** Use `which mkinitcpio`, `which dracut`, or `which update-initramfs` to determine the active generator.
* [ ] **2.4 Memory Profiler (`memory.ts`):** Check `/sys/module/zswap/parameters/enabled` and `zramctl` to determine current swap architecture.

### Stage 3: The Optimization Matrix (`src/engine/matrix.ts`)

*Agent Instructions: Create a mapping of required kernel parameters and modprobe rules based on discovered hardware.*

* [ ] **3.1 Intel Rules:** If Intel, queue `options i915 enable_guc=3 enable_fbc=1`. If hybrid, ensure `i915` parameters don't conflict with dGPU.
* [ ] **3.2 NVIDIA Rules:** If NVIDIA, queue `nvidia-drm.modeset=1` for kernel parameters.
* [ ] **3.3 AMD Rules:** If AMD, queue `amdgpu.ppfeaturemask=0xffffffff` (if overclocking support is requested).
* [ ] **3.4 Memory Rules:** If `zram` is present and `zswap` is enabled, queue kernel parameter `zswap.enabled=0`.

### Stage 4: Backup & Rollback Engine (`src/engine/backup.ts`)

* [ ] **4.1 Backup Initialization:** Create `~/.local/state/gpu-optimizer/backups/`.
* [ ] **4.2 Snapshot Creation:** Before any mutation, copy target files (e.g., `grub.cfg`, `modprobe.d/*.conf`) into a new timestamped directory.
* [ ] **4.3 Metadata Registry:** Create a `manifest.json` in the backup folder linking original absolute paths to the backup filenames.
* [ ] **4.4 Rollback Logic:** Read `manifest.json`, use `shell.runElevated(cp ...)` to restore files, and automatically trigger the Initramfs rebuild (Stage 5.3).

### Stage 5: The Mutation Engine (`src/engine/mutate.ts`)

* [ ] **5.1 GRUB Injector:** Safely parse `/etc/default/grub`, append necessary parameters to `GRUB_CMDLINE_LINUX_DEFAULT` (ensuring no duplicates), write to staging, and provide a diff string.
* [ ] **5.2 Systemd-Boot Injector:** Parse the active `.conf` file, append to the `options` line (ensuring no duplicates), write to staging, and provide a diff string.
* [ ] **5.3 Rebuild Trigger:** A function to execute `sudo mkinitcpio -P`, `sudo dracut --force`, or `sudo update-initramfs -u` based on the discovery phase.

### Stage 6: The Interactive CLI (`src/index.ts`)

* [ ] **6.1 Main Menu:** Use `@clack/prompts` `select` to offer: [1. View Status], [2. Apply Optimizations], [3. Rollback], [4. Exit].
* [ ] **6.2 View Status Flow:** Pretty-print the `SystemProfile` (detected GPUs, Bootloader, Initramfs, GuC/HuC status, memory layout).
* [ ] **6.3 Apply Flow:**
1. Run Discovery.
2. Generate required changes via Optimization Matrix.
3. Generate temporary staging files.
4. Print Diffs to the console using color coding (Red for old, Green for new).
5. Prompt: "Apply these changes? (requires sudo)".
6. If yes, run Backup Engine -> write elevated -> trigger Rebuild.


* [ ] **6.4 Rollback Flow:** List available backups by timestamp using `@clack/prompts` `select`. On selection, execute Rollback Logic and trigger Rebuild.