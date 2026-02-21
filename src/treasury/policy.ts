import type {
  TreasuryPolicyDecision,
  TreasuryPolicyInput,
  TreasuryPolicySnapshot,
} from "./types.js";

export interface TreasuryPolicyConfig {
  enabled: boolean;
  requireAllowlist: boolean;
  allowlistedRecipients: Set<string>;
  minReserveCents: number;
  autoApproveMaxCents: number;
  hardPerTransferCents: number;
  hardDailyLimitCents: number;
  autoExecuteApproved: boolean;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAddressAllowlist(raw: string | undefined): Set<string> {
  if (!raw || raw.trim().length === 0) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^0x[a-f0-9]{40}$/.test(value)),
  );
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function getTreasuryPolicyConfig(): TreasuryPolicyConfig {
  return {
    enabled: readBooleanEnv("AUTOMATON_TREASURY_POLICY_ENABLED", true),
    requireAllowlist: readBooleanEnv(
      "AUTOMATON_TREASURY_REQUIRE_ALLOWLIST",
      true,
    ),
    allowlistedRecipients: parseAddressAllowlist(
      process.env.AUTOMATON_TREASURY_ALLOWLIST,
    ),
    minReserveCents: Math.max(
      0,
      Math.floor(readNumberEnv("AUTOMATON_TREASURY_MIN_RESERVE_CENTS", 500)),
    ),
    autoApproveMaxCents: Math.max(
      0,
      Math.floor(
        readNumberEnv("AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS", 100),
      ),
    ),
    hardPerTransferCents: Math.max(
      1,
      Math.floor(
        readNumberEnv("AUTOMATON_TREASURY_HARD_PER_TRANSFER_CENTS", 5000),
      ),
    ),
    hardDailyLimitCents: Math.max(
      1,
      Math.floor(readNumberEnv("AUTOMATON_TREASURY_HARD_DAILY_LIMIT_CENTS", 10_000)),
    ),
    autoExecuteApproved: readBooleanEnv(
      "AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED",
      false,
    ),
  };
}

export function evaluateTreasurySpendPolicy(
  input: TreasuryPolicyInput,
  config = getTreasuryPolicyConfig(),
): TreasuryPolicyDecision {
  const reasons: string[] = [];

  const normalizedTo = normalizeAddress(input.toAddress);
  const allowlistMatched = config.allowlistedRecipients.has(normalizedTo);
  const projectedBalanceCents = input.balanceCents - input.amountCents;
  const projectedSpentLast24hCents =
    input.spentLast24hCents + input.amountCents;

  let decision: TreasuryPolicySnapshot["decision"] = "auto_approve";

  if (!config.enabled) {
    reasons.push("policy_disabled");
    return {
      decision,
      reasons,
      snapshot: {
        enabled: false,
        decision,
        reasons,
        requireAllowlist: config.requireAllowlist,
        allowlistMatched,
        projectedBalanceCents,
        minReserveCents: config.minReserveCents,
        projectedSpentLast24hCents,
        hardDailyLimitCents: config.hardDailyLimitCents,
        autoApproveMaxCents: config.autoApproveMaxCents,
        hardPerTransferCents: config.hardPerTransferCents,
      },
    };
  }

  if (input.amountCents <= 0) {
    decision = "reject";
    reasons.push("non_positive_amount");
  }

  if (input.amountCents > config.hardPerTransferCents) {
    decision = "reject";
    reasons.push("above_hard_per_transfer_limit");
  }

  if (projectedBalanceCents < config.minReserveCents) {
    decision = "reject";
    reasons.push("below_min_reserve");
  }

  if (projectedSpentLast24hCents > config.hardDailyLimitCents) {
    if (decision !== "reject") {
      decision = "require_human";
    }
    reasons.push("above_hard_daily_limit");
  }

  if (config.requireAllowlist && !allowlistMatched) {
    if (decision !== "reject") {
      decision = "require_human";
    }
    reasons.push("recipient_not_allowlisted");
  }

  if (
    decision === "auto_approve" &&
    input.amountCents > config.autoApproveMaxCents
  ) {
    decision = "require_human";
    reasons.push("above_auto_approve_threshold");
  }

  return {
    decision,
    reasons,
    snapshot: {
      enabled: true,
      decision,
      reasons,
      requireAllowlist: config.requireAllowlist,
      allowlistMatched,
      projectedBalanceCents,
      minReserveCents: config.minReserveCents,
      projectedSpentLast24hCents,
      hardDailyLimitCents: config.hardDailyLimitCents,
      autoApproveMaxCents: config.autoApproveMaxCents,
      hardPerTransferCents: config.hardPerTransferCents,
    },
  };
}
