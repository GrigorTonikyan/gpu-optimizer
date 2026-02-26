import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { parseKeys, Terminal } from '../tui/terminal';

describe('parseKeys — Arrow Keys', () => {
    it('parses UP arrow escape sequence', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x41]));
        expect(result).toEqual(['UP']);
    });

    it('parses DOWN arrow escape sequence', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x42]));
        expect(result).toEqual(['DOWN']);
    });

    it('parses RIGHT arrow escape sequence', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x43]));
        expect(result).toEqual(['RIGHT']);
    });

    it('parses LEFT arrow escape sequence', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x44]));
        expect(result).toEqual(['LEFT']);
    });

    it('parses HOME key escape sequence', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x48]));
        expect(result).toEqual(['HOME']);
    });

    it('parses END key escape sequence', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x46]));
        expect(result).toEqual(['END']);
    });
});

describe('parseKeys — Extended Keys', () => {
    it('parses PAGE_UP escape sequence (ESC [ 5 ~)', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x35, 0x7e]));
        expect(result).toEqual(['PAGE_UP']);
    });

    it('parses PAGE_DOWN escape sequence (ESC [ 6 ~)', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x36, 0x7e]));
        expect(result).toEqual(['PAGE_DOWN']);
    });

    it('parses DELETE escape sequence (ESC [ 3 ~)', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x33, 0x7e]));
        expect(result).toEqual(['DELETE']);
    });
});

describe('parseKeys — Control Characters', () => {
    it('parses Ctrl+C (0x03)', () => {
        const result = parseKeys(Buffer.from([0x03]));
        expect(result).toEqual(['CTRL_C']);
    });

    it('parses Ctrl+D (0x04)', () => {
        const result = parseKeys(Buffer.from([0x04]));
        expect(result).toEqual(['CTRL_D']);
    });

    it('parses Ctrl+A (0x01)', () => {
        const result = parseKeys(Buffer.from([0x01]));
        expect(result).toEqual(['CTRL_A']);
    });

    it('parses Ctrl+E (0x05)', () => {
        const result = parseKeys(Buffer.from([0x05]));
        expect(result).toEqual(['CTRL_E']);
    });

    it('parses ENTER from carriage return (0x0d)', () => {
        const result = parseKeys(Buffer.from([0x0d]));
        expect(result).toEqual(['ENTER']);
    });

    it('parses ENTER from newline (0x0a)', () => {
        const result = parseKeys(Buffer.from([0x0a]));
        expect(result).toEqual(['ENTER']);
    });

    it('parses BACKSPACE (0x7f)', () => {
        const result = parseKeys(Buffer.from([0x7f]));
        expect(result).toEqual(['BACKSPACE']);
    });

    it('parses BACKSPACE alternate (0x08)', () => {
        const result = parseKeys(Buffer.from([0x08]));
        expect(result).toEqual(['BACKSPACE']);
    });

    it('parses TAB (0x09)', () => {
        const result = parseKeys(Buffer.from([0x09]));
        expect(result).toEqual(['TAB']);
    });
});

describe('parseKeys — ESCAPE key', () => {
    it('parses bare ESC (0x1b) as ESCAPE', () => {
        const result = parseKeys(Buffer.from([0x1b]));
        expect(result).toEqual(['ESCAPE']);
    });

    it('parses ESC followed by unknown CSI sequence as ESCAPE plus remaining chars', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x5a]));
        expect(result).toEqual(['ESCAPE', '[', 'Z']);
    });
});

describe('parseKeys — Printable Characters', () => {
    it('parses single printable character', () => {
        const result = parseKeys(Buffer.from([0x61]));
        expect(result).toEqual(['a']);
    });

    it('parses space character', () => {
        const result = parseKeys(Buffer.from([0x20]));
        expect(result).toEqual([' ']);
    });

    it('parses multiple sequential characters', () => {
        const result = parseKeys(Buffer.from([0x68, 0x69]));
        expect(result).toEqual(['h', 'i']);
    });
});

describe('parseKeys — Buffered Input', () => {
    it('parses multiple keys in a single buffer (arrow then char)', () => {
        const result = parseKeys(Buffer.from([0x1b, 0x5b, 0x41, 0x61]));
        expect(result).toEqual(['UP', 'a']);
    });

    it('parses mixed control and printable keys', () => {
        const result = parseKeys(Buffer.from([0x09, 0x61, 0x0d]));
        expect(result).toEqual(['TAB', 'a', 'ENTER']);
    });

    it('handles empty buffer', () => {
        const result = parseKeys(Buffer.from([]));
        expect(result).toEqual([]);
    });
});

describe('Terminal — Key Handlers', () => {
    let term: Terminal;
    let writtenOutput: string[];

    beforeEach(() => {
        term = new Terminal();
        writtenOutput = [];
        term.write = (text: string) => { writtenOutput.push(text); };
    });

    it('onKey registers a handler and removeKeyListener removes it', () => {
        const keys: string[] = [];
        const handler = (key: string) => { keys.push(key); };

        term.onKey(handler);

        (term as any).keyHandlers.forEach((h: any) => h('a'));
        expect(keys).toEqual(['a']);

        term.removeKeyListener(handler);
        (term as any).keyHandlers.forEach((h: any) => h('b'));
        expect(keys).toEqual(['a']);
    });

    it('supports multiple simultaneous handlers', () => {
        const keys1: string[] = [];
        const keys2: string[] = [];

        term.onKey((key) => keys1.push(key));
        term.onKey((key) => keys2.push(key));

        for (const handler of (term as any).keyHandlers) {
            handler('x');
        }

        expect(keys1).toEqual(['x']);
        expect(keys2).toEqual(['x']);
    });
});

describe('Terminal — Output Methods', () => {
    let term: Terminal;
    let writtenOutput: string[];

    beforeEach(() => {
        term = new Terminal();
        writtenOutput = [];
        term.write = (text: string) => { writtenOutput.push(text); };
    });

    it('moveTo writes correct ANSI cursor sequence', () => {
        term.moveTo(5, 10);
        expect(writtenOutput).toEqual(['\x1b[10;5H']);
    });

    it('eraseLine writes correct ANSI sequence', () => {
        term.eraseLine();
        expect(writtenOutput).toEqual(['\x1b[2K']);
    });

    it('clearScreen writes clear + home sequences', () => {
        term.clearScreen();
        expect(writtenOutput).toEqual(['\x1b[2J\x1b[H']);
    });

    it('fullscreen(true) writes alternate buffer + clear + home', () => {
        term.fullscreen(true);
        expect(writtenOutput).toEqual(['\x1b[?1049h\x1b[2J\x1b[H']);
    });

    it('fullscreen(false) writes alternate buffer off', () => {
        term.fullscreen(false);
        expect(writtenOutput).toEqual(['\x1b[?1049l']);
    });

    it('hideCursor(true) writes cursor hide sequence', () => {
        term.hideCursor(true);
        expect(writtenOutput).toEqual(['\x1b[?25l']);
    });

    it('hideCursor(false) writes cursor show sequence', () => {
        term.hideCursor(false);
        expect(writtenOutput).toEqual(['\x1b[?25h']);
    });

    it('styleReset writes reset sequence', () => {
        term.styleReset();
        expect(writtenOutput).toEqual(['\x1b[0m']);
    });
});

describe('Terminal — Styled Output', () => {
    let term: Terminal;
    let writtenOutput: string[];

    beforeEach(() => {
        term = new Terminal();
        writtenOutput = [];
        term.write = (text: string) => { writtenOutput.push(text); };
    });

    it('bgCyanBlack writes text with cyan background and black foreground', () => {
        term.bgCyanBlack('test');
        const output = writtenOutput.join('');
        expect(output).toContain('\x1b[46m');
        expect(output).toContain('\x1b[30m');
        expect(output).toContain('test');
        expect(output).toContain('\x1b[0m');
    });

    it('bgRedWhite writes text with red background and white foreground', () => {
        term.bgRedWhite('danger');
        const output = writtenOutput.join('');
        expect(output).toContain('\x1b[41m');
        expect(output).toContain('\x1b[37m');
        expect(output).toContain('danger');
        expect(output).toContain('\x1b[0m');
    });

    it('bgYellowBlack writes text with yellow background and black foreground', () => {
        term.bgYellowBlack('warning');
        const output = writtenOutput.join('');
        expect(output).toContain('\x1b[43m');
        expect(output).toContain('\x1b[30m');
        expect(output).toContain('warning');
        expect(output).toContain('\x1b[0m');
    });
});

describe('Terminal — singleColumnMenu', () => {
    let term: Terminal;
    let writtenOutput: string[];

    beforeEach(() => {
        term = new Terminal();
        writtenOutput = [];
        term.write = (text: string) => { writtenOutput.push(text); };
    });

    it('resolves with selectedIndex on ENTER', async () => {
        const menuPromise = term.singleColumnMenu(['Option A', 'Option B'], { y: 1 });

        for (const handler of (term as any).keyHandlers) {
            handler('ENTER');
        }

        const result = await menuPromise;
        expect(result.selectedIndex).toBe(0);
        expect(result.canceled).toBe(false);
    });

    it('navigates down and selects second item', async () => {
        const menuPromise = term.singleColumnMenu(['A', 'B', 'C'], { y: 1 });

        for (const handler of [...(term as any).keyHandlers]) {
            handler('DOWN');
        }
        for (const handler of [...(term as any).keyHandlers]) {
            handler('ENTER');
        }

        const result = await menuPromise;
        expect(result.selectedIndex).toBe(1);
        expect(result.canceled).toBe(false);
    });

    it('does not go below last item', async () => {
        const menuPromise = term.singleColumnMenu(['A', 'B'], { y: 1 });

        for (const handler of [...(term as any).keyHandlers]) handler('DOWN');
        for (const handler of [...(term as any).keyHandlers]) handler('DOWN');
        for (const handler of [...(term as any).keyHandlers]) handler('DOWN');
        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await menuPromise;
        expect(result.selectedIndex).toBe(1);
    });

    it('does not go above first item', async () => {
        const menuPromise = term.singleColumnMenu(['A', 'B'], { y: 1 });

        for (const handler of [...(term as any).keyHandlers]) handler('UP');
        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await menuPromise;
        expect(result.selectedIndex).toBe(0);
    });

    it('ESCAPE cancels when cancelable is true', async () => {
        const menuPromise = term.singleColumnMenu(['A'], { cancelable: true });

        for (const handler of [...(term as any).keyHandlers]) {
            handler('ESCAPE');
        }

        const result = await menuPromise;
        expect(result.canceled).toBe(true);
        expect(result.unexpectedKey).toBe('ESCAPE');
    });

    it('q cancels when cancelable is true', async () => {
        const menuPromise = term.singleColumnMenu(['A'], { cancelable: true });

        for (const handler of [...(term as any).keyHandlers]) {
            handler('q');
        }

        const result = await menuPromise;
        expect(result.canceled).toBe(true);
    });

    it('ESCAPE does NOT cancel when cancelable is false', async () => {
        const menuPromise = term.singleColumnMenu(['A'], {
            cancelable: false,
            exitOnUnexpectedKey: true,
        });

        for (const handler of [...(term as any).keyHandlers]) {
            handler('ESCAPE');
        }

        const result = await menuPromise;
        expect(result.canceled).toBe(false);
        expect(result.unexpectedKey).toBe('ESCAPE');
    });

    it('exits on unexpected key when exitOnUnexpectedKey is true', async () => {
        const menuPromise = term.singleColumnMenu(['A'], { exitOnUnexpectedKey: true });

        for (const handler of [...(term as any).keyHandlers]) {
            handler('x');
        }

        const result = await menuPromise;
        expect(result.unexpectedKey).toBe('x');
    });
});

describe('Terminal — inputField', () => {
    let term: Terminal;
    let writtenOutput: string[];

    beforeEach(() => {
        term = new Terminal();
        writtenOutput = [];
        term.write = (text: string) => { writtenOutput.push(text); };
    });

    it('resolves with typed text on ENTER', async () => {
        const inputPromise = term.inputField();

        for (const handler of [...(term as any).keyHandlers]) handler('h');
        for (const handler of [...(term as any).keyHandlers]) handler('i');
        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await inputPromise;
        expect(result).toBe('hi');
    });

    it('resolves with default value on immediate ENTER', async () => {
        const inputPromise = term.inputField({ default: '/tmp/test' });

        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await inputPromise;
        expect(result).toBe('/tmp/test');
    });

    it('handles BACKSPACE correctly', async () => {
        const inputPromise = term.inputField();

        for (const handler of [...(term as any).keyHandlers]) handler('a');
        for (const handler of [...(term as any).keyHandlers]) handler('b');
        for (const handler of [...(term as any).keyHandlers]) handler('BACKSPACE');
        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await inputPromise;
        expect(result).toBe('a');
    });

    it('BACKSPACE on empty string does nothing', async () => {
        const inputPromise = term.inputField();

        for (const handler of [...(term as any).keyHandlers]) handler('BACKSPACE');
        for (const handler of [...(term as any).keyHandlers]) handler('a');
        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await inputPromise;
        expect(result).toBe('a');
    });

    it('resolves with empty string on ESCAPE when cancelable', async () => {
        const inputPromise = term.inputField({ cancelable: true });

        for (const handler of [...(term as any).keyHandlers]) handler('a');
        for (const handler of [...(term as any).keyHandlers]) handler('ESCAPE');

        const result = await inputPromise;
        expect(result).toBe('');
    });

    it('ignores non-printable keys (control characters)', async () => {
        const inputPromise = term.inputField();

        for (const handler of [...(term as any).keyHandlers]) handler('UP');
        for (const handler of [...(term as any).keyHandlers]) handler('DOWN');
        for (const handler of [...(term as any).keyHandlers]) handler('a');
        for (const handler of [...(term as any).keyHandlers]) handler('ENTER');

        const result = await inputPromise;
        expect(result).toBe('a');
    });
});

describe('Terminal — Dimension Getters', () => {
    it('width returns a positive number', () => {
        const term = new Terminal();
        expect(term.width).toBeGreaterThan(0);
    });

    it('height returns a positive number', () => {
        const term = new Terminal();
        expect(term.height).toBeGreaterThan(0);
    });
});
