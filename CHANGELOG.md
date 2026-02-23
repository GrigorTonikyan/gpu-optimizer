# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
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
