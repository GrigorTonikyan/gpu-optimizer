# Version Management & Changelog Rules

**Context & Purpose:** This rule enforces disciplined application versioning and changelog management tailored exactly to the User's preferences.

## 1. App Version Control
- The project `package.json` MUST maintain a strictly controlled `"version"` string following semantic versioning (e.g., `"version": "0.2.0"`).
- Every meaningful change, feature addition, or architectural/PRD update MUST be accompanied by an appropriate version bump in `package.json` at the conclusion of the updates.

## 2. Changelog Conventions
- The `CHANGELOG.md` file MUST strictly use the exact version releases defined in `package.json`.
- Every release entry header MUST include the exact **date and time** (ISO 8601 extended format with timezone, e.g., `2026-02-23T09:10:00+04:00`) alongside the version number to reflect what and when changes occurred. Example: `## [0.2.0] - 2026-02-23T09:10:00+04:00`.
- Entries in the changelog must clearly and chronologically reflect what was changed and in what order.

## 3. Atomic Commits
- Version bumps and changelog updates MUST be checked into the repository utilizing standard Conventional Commits targeting the specific version (e.g., `chore(release): bump version to 0.2.0`).
