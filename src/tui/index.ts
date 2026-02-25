import { startApp, stopApp, refreshChrome } from './app';
import { showMainMenu } from './screens/main-menu';
import { showBriefStatus } from './screens/status-brief';
import { showDetailedStatus } from './screens/status-detailed';
import { showApplyFlow } from './screens/apply';
import { showBackupManagement } from './screens/backup';
import { showSettings } from './screens/settings';
import { getStatusSnapshot } from '../controllers';
import type { SystemProfile } from '../types';

/**
 * Launches the interactive TUI application.
 * Enters fullscreen mode, runs the main menu loop, and restores
 * the terminal on exit.
 */
export async function launchTUI(): Promise<void> {
    let shouldExit = false;

    startApp(() => {
        shouldExit = true;
        process.exit(0);
    });

    try {
        let profile = await getStatusSnapshot();

        while (!shouldExit) {
            const action = await showMainMenu();

            switch (action) {
                case 'status-brief':
                    profile = await getStatusSnapshot();
                    await showBriefStatus(profile);
                    break;

                case 'status-detailed':
                    profile = await getStatusSnapshot();
                    await showDetailedStatus(profile);
                    break;

                case 'apply':
                    profile = await getStatusSnapshot();
                    await showApplyFlow(profile);
                    break;

                case 'backup':
                    await showBackupManagement(profile);
                    break;

                case 'settings':
                    await showSettings();
                    break;

                case 'exit':
                    shouldExit = true;
                    break;
            }
        }
    } finally {
        stopApp();
    }
}
