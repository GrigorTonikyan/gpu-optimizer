# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Fixed
- **Documentation**: Removed non-English (Russian) JSDocs from `src/utils/logger.ts` and replaced them with English equivalents.
- **Unit Tests**: Fixed TypeScript "possibly undefined" errors in `src/tests/backup.test.ts`.
- **Informational**: Resolved "unknown word" spell-checker warning in `src/engine/backup.ts` by refining the timestamp format documentation.

## [0.3.0] - 2026-02-25T11:22:00+04:00

### Added
- **Full TUI Overhaul**: Implemented a rich, terminal-interactive interface using `terminal-kit` with persistent screen layout and keyboard/mouse navigation.
- **Decoupled Architecture**: Refactored the monolithic CLI into a strictly decoupled structure with TUI (`src/tui/`), CLI (`src/cli/`), and Controller (`src/controllers/`) layers.
- **Telemetry System**: Introduced point-in-time system snapshots capturing CPU model/cores/load, GPU thermals/stats, and detailed memory usage (`src/discovery/telemetry.ts`).
- **Configuration Engine**: Added XDG-compliant configuration management with `zod` validation and persistence (`src/config/`).
- **Backup Management UI**: Developed a comprehensive backup screen for creating, listing, exporting, importing, deleting, and rolling back system snapshots.
- **CLI Passthrough Mode**: Implemented non-interactive CLI flags (`--status`, `--detailed`, `--apply`, `--rollback`, etc.) for automation and scripting.
- **Dry Mode**: Integrated a global dry-run simulation mode, visible across all UI screens and CLI operations.
- **Unit Tests**: Added comprehensive test coverage for controllers, configuration, and telemetry modules.

### Changed
- Replaced Node.js specific APIs with Bun-native equivalents (e.g., `crypto.randomUUID`, `Bun.argv`).
- Updated project file structure to support modularized components and controllers.
- Optimized TUI screen rendering and event handling for improved responsiveness.

### Fixed
- Improved bootloader detection reliability for systems with restricted `/boot` permissions.
- Refined TUI layout responsiveness for varying terminal dimensions.

## [0.2.0] - 2026-02-23T09:10:00+04:00

### Changed
- Unified `docs/PRD.md` and `docs/ADDENDUM.md` into a single, comprehensive `docs/PRD.md` without information loss.
- Overhauled UI Constraints in PRD: Replaced simple CLI output with a robust TUI framework requirement boasting rich arrow keys and mouse interaction.
- Introduced Decoupled Architecture constraints (Layer separation between TUI and Backend Engine).
- Replaced flat rollback flow in PRD with a fully-featured Backup Management menu (Create, Import, Export, Delete, Rollback).
- Expanded Types (`SystemProfile`, `GPUDevice`) in PRD to include deep telemetry (CPU stats, detailed RAM, VRAM usage, and thermals).

## [0.1.0] - 2026-02-23T08:00:00+04:00

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
- Systemd & Udev services (`src/engine/services.ts`):
  - NVIDIA persistence daemon enablement via systemctl
  - PCI power management udev rule for hybrid dGPU sleep
  - Service availability detection per system profile
- Unit tests for services (5 tests)


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

### Changed
- All features unified and tested under `bun test` and manual CLI verification. System verified for standalone compilation.

### Fixed
- Bootloader detection failing on systems where `/boot` requires elevated permissions (e.g., Arch Linux with 0700 boot partition). Added `runLenient` helper to capture `bootctl` stdout even on non-zero exit codes.
