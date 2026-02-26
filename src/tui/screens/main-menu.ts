import pc from 'picocolors';
import { terminal } from '../terminal';
import { clearContent, refreshChrome } from '../app';

/**
 * Displays the TUI main menu and waits for user selection.
 * Uses an interactive single-column menu with arrow key navigation.
 *
 * @returns The selected menu action, or 'exit' if the user chose to quit
 */
export async function showMainMenu(): Promise<string> {
    refreshChrome();
    const startRow = clearContent();

    terminal.moveTo(3, startRow);
    terminal.write(pc.bold(pc.cyan('Main Menu\n')));

    const menuItems = [
        '📊  Brief Status',
        '🔍  Detailed System Info',
        '⚡  Apply Optimizations',
        '💾  Backup Management',
        '⚙️   Settings',
        '🚪  Exit',
    ];

    const actionMap: Record<number, string> = {
        0: 'status-brief',
        1: 'status-detailed',
        2: 'apply',
        3: 'backup',
        4: 'settings',
        5: 'exit',
    };

    const response = await terminal.singleColumnMenu(menuItems, {
        y: startRow + 2,
        cancelable: true,
        exitOnUnexpectedKey: true,
    });

    if (response.canceled) {
        return 'exit';
    }

    if (response.unexpectedKey === 'q' || response.unexpectedKey === 'ESCAPE') {
        return 'exit';
    }

    return actionMap[response.selectedIndex] ?? 'exit';
}
