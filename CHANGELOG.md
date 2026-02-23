# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Optimization Matrix engine (`src/engine/matrix.ts`): generates kernel parameter and modprobe rules based on system profile
  - Intel: GuC/HuC/FBC modprobe options for i915; optional xe force_probe migration
  - NVIDIA: DRM modesetting (mandatory); fbdev for Wayland (optional)
  - AMD: ppfeaturemask OverDrive unlock; sg_display and tmz stability fixes for RDNA3
  - Memory: zswap disable when zram is already present
- New types: `OptimizationRule`, `OptimizationPlan`, `BackupRecord`, `OptimizationTarget`, `OptimizationSeverity`
- Unit tests for optimization matrix (14 tests, 85 assertions)
- Backup & Rollback engine (`src/engine/backup.ts`):
  - `initBackupDir`: creates `~/.local/state/gpu-optimizer/backups/`
  - `createSnapshot`: copies target files into timestamped directory with `manifest.json`
  - `listSnapshots`: returns available snapshots sorted newest-first
  - `rollback`: restores files from snapshot via `writeElevated`
- Unit tests for backup engine (11 tests)
- Mutation Engine (`src/engine/mutate.ts`):
  - `injectGrub`: parse GRUB config, deduplicate params, stage and diff
  - `injectSystemdBoot`: parse systemd-boot entry, deduplicate params, stage and diff
  - `writeModprobeConfig`: generate modprobe.d config from optimization rules
  - `applyStaged`: write staged file to target via `writeElevated`
  - `triggerRebuild`: execute initramfs rebuild with Boot Rescue Guide
  - `generateDiff`: color-coded terminal diff using `picocolors`
- `StagedMutation` type for tracking staged file mutations
- `bun run bundle` script (`bun build --compile`) for single-file executables
- `.agents/rules/runtime.md` documenting Bun as sole runtime/package manager
- Unit tests for mutation engine (14 tests)
- Interactive CLI (`src/index.ts`):
  - Main menu loop with @clack/prompts (View Status, Apply, Rollback, Exit)
  - Pretty-printed system status with GPU details, driver, display server, memory
  - Apply flow: discover → matrix → optional rule selection → diff → confirm → backup → apply → rebuild
  - Rollback flow: list snapshots → select → restore → rebuild
  - Immutable system guard with distro-specific instructions


- Project scaffolding with Bun runtime, TypeScript strict mode, `@clack/prompts`, `picocolors`, `zod`
- Shell execution wrapper (`src/utils/shell.ts`): `runUser`, `runElevated`, `writeElevated`, `stageFile`
- Discovery Engine (`src/discovery/`):
  - GPU detection via `lspci -nnk` parsing with PCI ID and driver extraction
  - Bootloader detection for GRUB and systemd-boot with `bootctl` fallback
  - Initramfs generator detection (mkinitcpio, dracut, update-initramfs)
  - Memory profiler (zram/zswap detection)
  - Immutable distro detection (ostree, SteamOS, NixOS)
  - Display server detection (Wayland/X11)
  - Kernel version retrieval
- Core type definitions (`src/types.ts`): `GPUVendor`, `GPUDevice`, `SystemProfile`, `BootloaderType`, `InitramfsType`
- Comprehensive unit tests (`src/tests/discovery.test.ts`) for all discovery modules

### Fixed
- Bootloader detection failing on systems where `/boot` requires elevated permissions (e.g., Arch Linux with 0700 boot partition). Added `runLenient` helper to capture `bootctl` stdout even on non-zero exit codes.
