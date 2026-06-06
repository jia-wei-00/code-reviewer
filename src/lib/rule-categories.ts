export const RULE_CATEGORIES = [
  "security",
  "performance",
  "style",
  "best-practices",
  "architecture",
  "testing",
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export function isRuleCategory(value: unknown): value is RuleCategory {
  return typeof value === "string" && (RULE_CATEGORIES as readonly string[]).includes(value);
}
