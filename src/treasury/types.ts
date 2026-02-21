export type TreasuryIntentStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "submitted"
  | "executed"
  | "failed";

export type TreasuryIntentSource =
  | "transfer_credits"
  | "fund_child"
  | "cli"
  | "system";

export interface TreasuryApprovalRecord {
  approvedBy: string;
  note?: string;
  at: string;
}

export interface TreasuryRejectionRecord {
  rejectedBy: string;
  reason: string;
  at: string;
}

export interface TreasuryExecutionRecord {
  backend: "conway" | "vultisig";
  transactionRef?: string;
  message: string;
  executedBy: string;
  executedAt: string;
}

export interface TreasuryPolicySnapshot {
  enabled: boolean;
  decision: "auto_approve" | "require_human" | "reject";
  reasons: string[];
  requireAllowlist: boolean;
  allowlistMatched: boolean;
  projectedBalanceCents: number;
  minReserveCents: number;
  projectedSpentLast24hCents: number;
  hardDailyLimitCents: number;
  autoApproveMaxCents: number;
  hardPerTransferCents: number;
}

export interface TreasuryTransferIntent {
  id: string;
  createdAt: string;
  updatedAt: string;
  requestedBy: "agent" | "human";
  source: TreasuryIntentSource;
  toAddress: string;
  amountCents: number;
  reason?: string;
  childId?: string;
  status: TreasuryIntentStatus;
  policy: TreasuryPolicySnapshot;
  approvals: TreasuryApprovalRecord[];
  rejection?: TreasuryRejectionRecord;
  execution?: TreasuryExecutionRecord;
}

export interface TreasuryPolicyInput {
  toAddress: string;
  amountCents: number;
  balanceCents: number;
  spentLast24hCents: number;
}

export interface TreasuryPolicyDecision {
  decision: "auto_approve" | "require_human" | "reject";
  reasons: string[];
  snapshot: TreasuryPolicySnapshot;
}
