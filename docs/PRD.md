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


4. **UI/UX:** The application MUST be a proper Terminal User Interface (TUI), not just sequential `console.log` output. It should provide a structured, persistent screen layout where dry-mode status and current context are clearly visible on all screens. The TUI must completely support rich interaction, allowing users to navigate with arrow keys, select/deselect items, and use mouse input across all screens.
5. **Decoupled Architecture:** The UI/TUI layer MUST be strictly decoupled from the underlying logic/backend. The backend "engine" containing hardware discovery, rule generation, and file mutation must operate independently and expose clean interfaces or APIs that the TUI consumes, ensuring the core engine could hypothetically run heedlessly or with a different UI.
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

### Stage 6: The Interactive TUI

* [ ] **6.1 Main Menu:** Implement a rich TUI main menu offering: [1. View Brief Status], [2. View Detailed System Info], [3. Apply Optimizations], [4. Backup Management], [5. Settings], [6. Exit].
  * *Global UI Requirement:* Dry mode (if enabled) MUST be clearly visible on all screens.
* [ ] **6.2 Settings Submenu:** A fully persistent settings menu where the user can configure:
  * Verbosity level
  * Logging to files (enable/disable)
  * Target location of logs and backups
  * Dry mode (Simulation mode)
* [ ] **6.3 View Brief Status Flow:** Display a concise, updated `SystemProfile` including device models, driver versions, current states, and real-time stats (CPU info, detailed memory info, component temperatures, etc.).
* [ ] **6.4 View Detailed System Info:** A dedicated submenu where the user can get exhaustive information about the OS, OS config, and all hardware devices. This must include explanations of how, why, and where everything is configured, and how it can be improved (with detailed descriptions and explanations).
* [ ] **6.5 Apply Flow:**
  1. Run Discovery.
  2. Generate required changes via Optimization Matrix and present available optimizations as a selectable list.
  3. The user can navigate, select, and deselect multiple specific optimizations.
  4. The user can request detailed information for any optimization in the list (explaining what it does, why/how it works, pros/cons, and risks involved).
  5. Generate temporary staging files covering only the selected optimizations.
  6. Print Diffs to the screen using color coding (Red for old, Green for new).
  7. Prompt: "Apply these changes? (requires sudo)".
  8. If yes, run Backup Engine -> write elevated -> trigger Rebuild.

* [ ] **6.6 Backup Management Flow:** A dedicated submenu where users can manage system snapshots. It must allow the user to:
  1. Create new manual backups.
  2. Import backup archives from other locations.
  3. Export existing backups to a portable archive.
  4. Delete specific backups.
  5. Execute a Rollback using a specific snapshot, which automatically triggers a Rebuild.