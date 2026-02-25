import termkit from 'terminal-kit';
import { getSettings } from '../controllers';
import { THEME } from './helpers';

const term = termkit.terminal;

/** Tracks whether the TUI is currently active (in alternate buffer) */
let isActive = false;

/**
 * Renders the persistent header bar shown on every TUI screen.
 * Displays app name, version, and dry-mode badge if active.
 */
function renderHeader(): void {
    const config = getSettings();

    term.moveTo(1, 1);
    term.eraseLine();
    term.bold.cyan(' ⚡ Universal GPU Optimizer ');
    term.dim(' v0.3.0 ');

    if (config.dryMode) {
        term(' ');
        term.bgYellow.black.bold(' DRY MODE ');
    }

    term.moveTo(1, 2);
    term.dim('─'.repeat(term.width));
}

/**
 * Renders the persistent footer bar with keybinding hints.
 */
function renderFooter(): void {
    term.moveTo(1, term.height);
    term.eraseLine();
    term.dim(' ↑↓ Navigate  │  Enter Select  │  q Back  │  Ctrl+C Exit');
}

/**
 * Clears the content area between header and footer.
 * Returns the starting row for content rendering.
 */
export function clearContent(): number {
    for (let row = 3; row < term.height; row++) {
        term.moveTo(1, row);
        term.eraseLine();
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
 * Switches to alternate screen buffer, enables raw mode and mouse input,
 * and renders the initial chrome.
 *
 * @param onExit - Callback invoked when the user requests application exit
 */
export function startApp(onExit: () => void): void {
    if (isActive) return;
    isActive = true;

    term.fullscreen(true);
    term.grabInput({ mouse: 'button' });
    term.hideCursor();

    renderHeader();
    renderFooter();

    term.on('key', (key: string) => {
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

    term.grabInput(false);
    term.hideCursor(false);
    term.fullscreen(false);
    term.styleReset();
}

/**
 * Returns the terminal-kit terminal instance for direct access.
 */
export function getTerm(): typeof term {
    return term;
}

/**
 * Returns the usable content height (total height minus header and footer).
 */
export function getContentHeight(): number {
    return term.height - 4;
}
