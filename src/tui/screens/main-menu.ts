import { getTerm, clearContent, refreshChrome } from '../app';

/**
 * Displays the TUI main menu and waits for user selection.
 * Uses terminal-kit single-column menu with arrow key and mouse navigation.
 *
 * @returns The selected menu action, or 'exit' if the user chose to quit
 */
export async function showMainMenu(): Promise<string> {
    const term = getTerm();

    refreshChrome();
    const startRow = clearContent();

    term.moveTo(3, startRow);
    term.bold.cyan('Main Menu\n');

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

    return new Promise<string>((resolve) => {
        term.singleColumnMenu(menuItems, {
            y: startRow + 2,
            selectedStyle: term.bold.bgCyan.black,
            style: term.white,
            cancelable: true,
            exitOnUnexpectedKey: true,
        }, (error: any, response: any) => {
            if (error || !response || response.canceled) {
                resolve('exit');
                return;
            }

            if (response.unexpectedKey === 'q' || response.unexpectedKey === 'ESCAPE') {
                resolve('exit');
                return;
            }

            resolve(actionMap[response.selectedIndex] ?? 'exit');
        });
    });
}
