import { readFileSync, existsSync } from 'node:fs';
import type { OptimizationRule, OptimizationPlan } from '../types';

/**
 * Checks if a specific optimization rule is already applied to the system.
 * 
 * For kernel parameters, it parses /proc/cmdline and ensures ALL space-separated 
 * parameters in the rule value are present on the system.
 * For modprobe options, it checks the content of our managed config file.
 * 
 * This function NEVER triggers sudo prompts. If a file is unreadable, 
 * it gracefully returns false.
 *
 * @param rule - The OptimizationRule to check
 * @returns true if the rule's value is found in the relevant system config
 */
export function checkRuleApplied(rule: OptimizationRule): boolean {
    if (rule.target === 'kernel-param') {
        try {
            const cmdline = readFileSync('/proc/cmdline', 'utf-8');
            const systemParams = cmdline.split(/\s+/).filter(Boolean);

            // Split rule value into individual parameters (e.g. "a=1 b=2" -> ["a=1", "b=2"])
            const ruleParams = rule.value.split(/\s+/).filter(Boolean);

            // ALL parameters from the rule must be present in the system cmdline
            return ruleParams.every(rp => systemParams.includes(rp));
        } catch {
            return false;
        }
    }

    if (rule.target === 'modprobe') {
        const configPath = '/etc/modprobe.d/gpu-optimizer.conf';

        try {
            // Only attempt to read if it exists and is readable by us
            if (!existsSync(configPath)) return false;

            const content = readFileSync(configPath, 'utf-8');
            if (!content) return false;

            // Check if the exact value line exists in the file (ignoring whitespace)
            const lines = content.split('\n').map(l => l.trim());
            return lines.includes(rule.value.trim());
        } catch {
            // Permission denied or other error? Assume not applied to avoid sudo prompt
            return false;
        }
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
