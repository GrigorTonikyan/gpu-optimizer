import { discoverSystem } from '../discovery';
import pc from 'picocolors';

async function runTest() {
    console.log(pc.cyan('Starting System Discovery...\n'));

    try {
        const profile = await discoverSystem();
        console.log(pc.green('Discovery Complete! System Profile:\n'));
        console.log(JSON.stringify(profile, null, 2));
    } catch (e) {
        console.error(pc.red('Discovery failed:'), e);
    }
}

runTest();
