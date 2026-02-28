import pc from 'picocolors';
import fs from 'fs';

const DEBUG_LOG = '/tmp/gpu-optimizer-tui.log';
function log(msg: string) {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

/**
 * ANSI escape code constants for terminal control sequences.
 * These are the raw escape sequences used to control cursor,
 * screen buffer, and text styling in VT100-compatible terminals.
 */
const ESC = {
    ALTERNATE_BUFFER_ON: '\x1b[?1049h',
    ALTERNATE_BUFFER_OFF: '\x1b[?1049l',
    CURSOR_HIDE: '\x1b[?25l',
    CURSOR_SHOW: '\x1b[?25h',
    ERASE_LINE: '\x1b[2K',
    CLEAR_SCREEN: '\x1b[2J',
    CLEAR_DOWN: '\x1b[J',
    RESET_STYLE: '\x1b[0m',
    CURSOR_HOME: '\x1b[H',
} as const;

/**
 * Background color ANSI codes for styled menu highlights.
 * Uses 256-color mode for broader terminal compatibility.
 */
const BG = {
    cyan: '\x1b[46m',
    red: '\x1b[41m',
    yellow: '\x1b[43m',
    reset: '\x1b[49m',
} as const;

/**
 * Foreground color codes used alongside background colors
 * to ensure readable contrast in menu highlights.
 */
const FG = {
    black: '\x1b[30m',
    white: '\x1b[37m',
    reset: '\x1b[39m',
} as const;

/**
 * Named key identifiers emitted by the key parser.
 * These map raw ANSI escape sequences to human-readable key names
 * matching the naming convention used by terminal-kit.
 */
type KeyName =
    | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
    | 'ENTER' | 'ESCAPE' | 'BACKSPACE' | 'TAB' | 'DELETE'
    | 'PAGE_UP' | 'PAGE_DOWN' | 'HOME' | 'END'
    | 'CTRL_C' | 'CTRL_D' | 'CTRL_A' | 'CTRL_E'
    | string;

/** Callback signature for key event listeners */
type KeyHandler = (key: KeyName) => void;

/**
 * Options for the singleColumnMenu interactive menu.
 */
interface MenuOptions {
    /** Row position to start rendering the menu */
    y?: number;
    /** Background color for the selected item */
    selectedBg?: keyof typeof BG;
    /** Whether pressing Escape or 'q' cancels the menu */
    cancelable?: boolean;
    /** Whether pressing an unmapped key exits the menu */
    exitOnUnexpectedKey?: boolean;
}

/**
 * Result returned from singleColumnMenu after user interaction.
 */
interface MenuResponse {
    /** Index of the selected item */
    selectedIndex: number;
    /** Whether the menu was canceled by the user */
    canceled: boolean;
    /** The key that caused an unexpected exit, if exitOnUnexpectedKey was true */
    unexpectedKey?: string;
}

/**
 * Options for the inputField text input.
 */
interface InputFieldOptions {
    /** Default text pre-filled in the input */
    default?: string;
    /** Whether pressing Escape cancels the input */
    cancelable?: boolean;
    /** Optional hook for providing autocomplete suggestions */
    onAutocomplete?: (current: string) => Promise<string[] | string>;
    /** Optional prompt to show above the input line */
    prompt?: string;
}

/**
 * Parses raw stdin byte sequences into named key identifiers.
 * Handles ANSI escape sequences for arrow keys, function keys,
 * and control characters.
 *
 * @param data - Raw buffer from stdin
 * @returns Array of parsed key names (may contain multiple keys if input was buffered)
 */
export function parseKeys(data: Buffer): KeyName[] {
    const keys: KeyName[] = [];
    let i = 0;

    while (i < data.length) {
        const byte = data[i]!;

        // Handle Escape sequences
        if (byte === 0x1b) {
            if (i + 1 < data.length && data[i + 1] === 0x5b) {
                // CSI (Control Sequence Introducer)
                let j = i + 2;
                let seq = '';
                while (j < data.length && data[j]! >= 0x30 && data[j]! <= 0x3f) {
                    seq += String.fromCharCode(data[j]!);
                    j++;
                }
                const final = data[j] !== undefined ? String.fromCharCode(data[j]!) : '';
                j++;

                if (final === 'A') { keys.push('UP'); i = j; continue; }
                if (final === 'B') { keys.push('DOWN'); i = j; continue; }
                if (final === 'C') { keys.push('RIGHT'); i = j; continue; }
                if (final === 'D') { keys.push('LEFT'); i = j; continue; }
                if (final === 'H') { keys.push('HOME'); i = j; continue; }
                if (final === 'F') { keys.push('END'); i = j; continue; }

                if (seq === '5' && final === '~') { keys.push('PAGE_UP'); i = j; continue; }
                if (seq === '6' && final === '~') { keys.push('PAGE_DOWN'); i = j; continue; }
                if (seq === '3' && final === '~') { keys.push('DELETE'); i = j; continue; }

                keys.push('ESCAPE');
                i = j;
                continue;
            }

            keys.push('ESCAPE');
            i += 1;
            continue;
        }

        // Control characters
        if (byte === 0x03) { keys.push('CTRL_C'); i += 1; continue; }
        if (byte === 0x04) { keys.push('CTRL_D'); i += 1; continue; }
        if (byte === 0x01) { keys.push('CTRL_A'); i += 1; continue; }
        if (byte === 0x05) { keys.push('CTRL_E'); i += 1; continue; }
        if (byte === 0x0d || byte === 0x0a) { keys.push('ENTER'); i += 1; continue; }
        if (byte === 0x7f || byte === 0x08) { keys.push('BACKSPACE'); i += 1; continue; }
        if (byte === 0x09) { keys.push('TAB'); i += 1; continue; }

        // Normal characters / UTF-8
        if (byte >= 32) {
            try {
                // Attempt to decode as much as possible as UTF-8
                const char = data.subarray(i).toString('utf8');
                if (char.length > 0) {
                    // Only take the first character's worth of bytes
                    const firstChar = Array.from(char)[0]!;
                    keys.push(firstChar);
                    i += Buffer.from(firstChar, 'utf8').length;
                    continue;
                }
            } catch {
                // Fallback to single byte if UTF-8 fails
                keys.push(String.fromCharCode(byte));
            }
        }
        i += 1;
    }

    return keys;
}

/**
 * Zero-dependency terminal abstraction built on raw ANSI escape codes.
 *
 * Replaces `terminal-kit` with a lightweight, statically-analyzable module
 * that bundles cleanly with `bun build --compile`. Provides cursor control,
 * fullscreen mode, styled output, interactive menus, and text input fields.
 *
 * @example
 * ```ts
 * import { terminal } from './terminal';
 *
 * terminal.fullscreen(true);
 * terminal.moveTo(1, 1);
 * terminal.write(pc.bold(pc.cyan('Hello World')));
 * terminal.fullscreen(false);
 * ```
 */
export class Terminal {
    private keyHandlers: Set<KeyHandler> = new Set();
    private stdinListener: ((data: Buffer) => void) | null = null;
    private rawModeActive = false;

    /** Current terminal width in columns */
    get width(): number {
        return process.stdout.columns || 80;
    }

    /** Current terminal height in rows */
    get height(): number {
        return process.stdout.rows || 24;
    }

    /**
     * Writes raw text to stdout without a trailing newline.
     * @param text - The text to write
     */
    write(text: string): void {
        process.stdout.write(text);
    }

    /**
     * Moves the cursor to an absolute position.
     * Uses 1-based coordinates matching the VT100 convention.
     *
     * @param col - Column number (1-based, left edge = 1)
     * @param row - Row number (1-based, top edge = 1)
     */
    moveTo(col: number, row: number): void {
        this.write(`\x1b[${row};${col}H`);
    }

    /**
     * Erases the entire current line without moving the cursor.
     */
    eraseLine(): void {
        this.write(ESC.ERASE_LINE);
    }

    /**
     * Clears the entire screen and moves cursor to home position.
     */
    clearScreen(): void {
        this.write(ESC.CLEAR_SCREEN + ESC.CURSOR_HOME);
    }

    /**
     * Toggles the alternate screen buffer (fullscreen mode).
     * When entering, also clears the alternate buffer.
     * When leaving, restores the original buffer contents.
     *
     * @param on - true to enter fullscreen, false to leave
     */
    fullscreen(on: boolean): void {
        this.write(on ? ESC.ALTERNATE_BUFFER_ON + ESC.CLEAR_SCREEN + ESC.CURSOR_HOME : ESC.ALTERNATE_BUFFER_OFF);
    }

    /**
     * Toggles cursor visibility.
     * @param hidden - true to hide the cursor, false to show it
     */
    hideCursor(hidden = true): void {
        this.write(hidden ? ESC.CURSOR_HIDE : ESC.CURSOR_SHOW);
    }

    /**
     * Clears everything on the current line to the right of the cursor.
     */
    clearDown(): void {
        this.write(ESC.CLEAR_DOWN);
    }

    /**
     * Resets all text styling (colors, bold, dim, etc.).
     */
    styleReset(): void {
        this.write(ESC.RESET_STYLE);
    }

    /**
     * Enables or disables raw input mode on stdin.
     * When raw mode is active, stdin delivers individual keypress
     * instead of line-buffered input.
     *
     * @param on - true to enable raw mode, false to disable
     */
    rawMode(on: boolean): void {
        if (on && !this.rawModeActive) {
            this.rawModeActive = true;
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }
            process.stdin.resume();

            this.stdinListener = (data: Buffer) => {
                const keys = parseKeys(data);
                for (const key of keys) {
                    for (const handler of Array.from(this.keyHandlers)) {
                        handler(key);
                    }
                }
            };
            process.stdin.on('data', this.stdinListener);
        } else if (!on && this.rawModeActive) {
            this.rawModeActive = false;
            if (this.stdinListener) {
                process.stdin.removeListener('data', this.stdinListener);
                this.stdinListener = null;
            }
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.pause();
        }
    }

    /**
     * Registers a key event handler.
     * The handler is called with a key name string for each keypress.
     *
     * @param handler - Callback invoked with the key name
     */
    onKey(handler: KeyHandler): void {
        this.keyHandlers.add(handler);
    }

    /**
     * Removes a previously registered key event handler.
     *
     * @param handler - The handler to remove
     */
    removeKeyListener(handler: KeyHandler): void {
        this.keyHandlers.delete(handler);
    }

    /**
     * Writes styled text with a cyan background and black foreground.
     * Used for selected menu items and highlights.
     *
     * @param text - Text content to style
     */
    bgCyanBlack(text: string): void {
        this.write(`${BG.cyan}${FG.black}${pc.bold(text)}${ESC.RESET_STYLE}`);
    }

    /**
     * Writes styled text with a red background and white foreground.
     * Used for destructive action highlights in menus.
     *
     * @param text - Text content to style
     */
    bgRedWhite(text: string): void {
        this.write(`${BG.red}${FG.white}${pc.bold(text)}${ESC.RESET_STYLE}`);
    }

    /**
     * Writes styled text with a yellow background and black foreground.
     * Used for warning highlights and caution actions.
     *
     * @param text - Text content to style
     */
    bgYellowBlack(text: string): void {
        this.write(`${BG.yellow}${FG.black}${pc.bold(text)}${ESC.RESET_STYLE}`);
    }

    /**
     * Displays an interactive single-column menu and waits for user selection.
     * Supports arrow key navigation, Enter to select, and Escape/q to cancel.
     *
     * @param items - Array of menu item labels
     * @param options - Menu configuration options
     * @returns Promise resolving to the menu response
     */
    singleColumnMenu(items: string[], options: MenuOptions = {}): Promise<MenuResponse> {
        const startRow = options.y ?? 1;
        const cancelable = options.cancelable ?? false;
        const exitOnUnexpectedKey = options.exitOnUnexpectedKey ?? false;
        const selectedBg = options.selectedBg ?? 'cyan';
        let cursor = 0;

        const render = () => {
            for (let i = 0; i < items.length; i++) {
                this.moveTo(1, startRow + i);
                this.eraseLine();
                if (i === cursor) {
                    this.moveTo(3, startRow + i);
                    if (selectedBg === 'red') {
                        this.bgRedWhite(` ${items[i]} `);
                    } else if (selectedBg === 'yellow') {
                        this.bgYellowBlack(` ${items[i]} `);
                    } else {
                        this.bgCyanBlack(` ${items[i]} `);
                    }
                } else {
                    this.moveTo(3, startRow + i);
                    this.write(`  ${items[i]}`);
                }
            }
        };

        render();

        return new Promise<MenuResponse>((resolve) => {
            const handler = (key: KeyName) => {
                if (key === 'UP' && cursor > 0) {
                    cursor--;
                    render();
                    return;
                }
                if (key === 'DOWN' && cursor < items.length - 1) {
                    cursor++;
                    render();
                    return;
                }
                if (key === 'ENTER') {
                    this.removeKeyListener(handler);
                    resolve({ selectedIndex: cursor, canceled: false });
                    return;
                }
                if (cancelable && (key === 'ESCAPE' || key === 'q')) {
                    this.removeKeyListener(handler);
                    resolve({ selectedIndex: cursor, canceled: true, unexpectedKey: key });
                    return;
                }
                if (exitOnUnexpectedKey && key !== 'UP' && key !== 'DOWN') {
                    this.removeKeyListener(handler);
                    resolve({ selectedIndex: cursor, canceled: false, unexpectedKey: key });
                    return;
                }
            };
            this.onKey(handler);
        });
    }

    /**
     * Displays an inline text input field and waits for user submission.
     * Supports typing, backspace, and optional cancellation with Escape.
     *
     * @param options - Input field configuration options
     * @returns Promise resolving to the entered text, or empty string if canceled
     */
    inputField(options: InputFieldOptions = {}): Promise<string> {
        let value = options.default ?? '';
        const cancelable = options.cancelable ?? false;
        let autocompleteIndex = -1;

        const startX = 3;
        const startY = this.height - 1;

        const renderInput = () => {
            if (options.prompt) {
                this.moveTo(startX, startY - 1);
                this.eraseLine();
                this.write(pc.dim(options.prompt));
            }
            this.moveTo(startX, startY);
            this.eraseLine();
            this.write(`${pc.cyan('❯')} ${value}`);
            this.hideCursor(false);
        };

        this.hideCursor(false);
        renderInput();

        return new Promise<string>((resolve) => {
            const handler = async (key: KeyName) => {
                if (key === 'ENTER') {
                    this.removeKeyListener(handler);
                    this.hideCursor(true);
                    this.moveTo(startX, startY);
                    this.eraseLine();
                    if (options.prompt) {
                        this.moveTo(startX, startY - 1);
                        this.eraseLine();
                    }
                    resolve(value);
                    return;
                }
                if (cancelable && key === 'ESCAPE') {
                    this.removeKeyListener(handler);
                    this.hideCursor(true);
                    this.moveTo(startX, startY);
                    this.eraseLine();
                    if (options.prompt) {
                        this.moveTo(startX, startY - 1);
                        this.eraseLine();
                    }
                    resolve('');
                    return;
                }
                if (key === 'TAB' && options.onAutocomplete) {
                    const result = await options.onAutocomplete(value);
                    if (typeof result === 'string') {
                        value = result;
                    } else if (Array.isArray(result) && result.length > 0) {
                        autocompleteIndex = (autocompleteIndex + 1) % result.length;
                        value = result[autocompleteIndex]!;
                    }
                    renderInput();
                    return;
                }

                autocompleteIndex = -1;

                if (key === 'BACKSPACE') {
                    if (value.length > 0) {
                        value = value.slice(0, -1);
                        renderInput();
                    }
                    return;
                }

                // Append normal characters
                if (key.length === 1 && key.charCodeAt(0) >= 32) {
                    value += key;
                    renderInput();
                }
            };
            this.onKey(handler);
        });
    }
}

/**
 * Singleton terminal instance.
 * All TUI modules should import and use this shared instance.
 */
export const terminal = new Terminal();
