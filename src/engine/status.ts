import { readFileSync, existsSync } from 'node:fs';
import type { OptimizationRule, OptimizationPlan } from '../types';
import { runElevated } from '../utils/shell';

/**
 * Checks if a specific optimization rule is already applied to the system.
 * 
 * For kernel parameters, it parses /proc/cmdline.
 * For modprobe options, it checks the content of our managed config file.
 *
 * @param rule - The OptimizationRule to check
 * @returns true if the rule's value is found in the relevant system config
 */
export function checkRuleApplied(rule: OptimizationRule): boolean {
    if (rule.target === 'kernel-param') {
        try {
            const cmdline = readFileSync('/proc/cmdline', 'utf-8');
            const params = cmdline.split(/\s+/);
            // rule.value might be "key=value" or "flag"
            // We search for exact match of the parameter string
            return params.includes(rule.value);
        } catch {
            return false;
        }
    }

    if (rule.target === 'modprobe') {
        const configPath = '/etc/modprobe.d/gpu-optimizer.conf';
        if (!existsSync(configPath)) return false;

        let content = '';
        try {
            content = readFileSync(configPath, 'utf-8');
        } catch {
            // Fallback to elevated read if needed
            content = runElevated(`cat '${configPath}'`);
        }

        if (!content) return false;

        // Check if the exact value line exists in the file
        const lines = content.split('\n').map(l => l.trim());
        return lines.includes(rule.value);
    }

    return false;
}

/**
 * Enriches all rules within an optimization plan with their current 
 * "applied" status by probing the system state.
 *
 * @param plan - The OptimizationPlan to enrich
 */
export function enrichRuleStatus(plan: OptimizationPlan): void {
    const allRules = [...plan.kernelParams, ...plan.modprobeOptions];
    for (const rule of allRules) {
        rule.isApplied = checkRuleApplied(rule);
    }
}
