import pc from 'picocolors';
import { terminal } from './terminal';
import { getSettings } from '../controllers';

/** Tracks whether the TUI is currently active (in alternate buffer) */
let isActive = false;

/**
 * Renders the persistent header bar shown on every TUI screen.
 * Displays app name, version, and dry-mode badge if active.
 */
function renderHeader(): void {
    const config = getSettings();

    terminal.moveTo(1, 1);
    terminal.eraseLine();
    terminal.write(pc.bold(pc.cyan(' ⚡ Universal GPU Optimizer ')));
    terminal.write(pc.dim(' v0.3.0 '));

    if (config.dryMode) {
        terminal.write(' ');
        terminal.bgYellowBlack(' DRY MODE ');
    }

    terminal.moveTo(1, 2);
    terminal.write(pc.dim('─'.repeat(terminal.width)));
}

/**
 * Renders the persistent footer bar with keybinding hints.
 */
function renderFooter(): void {
    terminal.moveTo(1, terminal.height);
    terminal.eraseLine();
    terminal.write(pc.dim(' ↑↓ Navigate  │  Enter Select  │  q Back  │  Ctrl+C Exit'));
}

/**
 * Clears the content area between header and footer.
 * Returns the starting row for content rendering.
 */
export function clearContent(): number {
    for (let row = 3; row < terminal.height; row++) {
        terminal.moveTo(1, row);
        terminal.eraseLine();
    }
    return 4;
}

/**
 * Refreshes the chrome (header + footer) without clearing content.
 */
export function refreshChrome(): void {
    renderHeader();
    renderFooter();
}

/**
 * Starts the TUI application.
 * Switches to alternate screen buffer, enables raw mode,
 * and renders the initial chrome.
 *
 * @param onExit - Callback invoked when the user requests application exit
 */
export function startApp(onExit: () => void): void {
    if (isActive) return;
    isActive = true;

    terminal.fullscreen(true);
    terminal.rawMode(true);
    terminal.hideCursor(true);

    renderHeader();
    renderFooter();

    terminal.onKey((key: string) => {
        if (key === 'CTRL_C') {
            stopApp();
            onExit();
        }
    });
}

/**
 * Stops the TUI application.
 * Restores the original terminal state, disabling raw mode and
 * switching back from the alternate screen buffer.
 */
export function stopApp(): void {
    if (!isActive) return;
    isActive = false;

    terminal.rawMode(false);
    terminal.hideCursor(false);
    terminal.fullscreen(false);
    terminal.styleReset();
}

/**
 * Returns the usable content height (total height minus header and footer).
 */
export function getContentHeight(): number {
    return terminal.height - 4;
}
