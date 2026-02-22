export interface DashboardTurnSummary {
  id: string;
  timestamp: string;
  state: string;
  inputSource: string | null;
  thinkingPreview: string;
  toolCalls: Array<{
    name: string;
    error: string | null;
    durationMs: number;
  }>;
  costCents: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface DashboardTxnSummary {
  id: string;
  type: string;
  amountCents: number | null;
  balanceAfterCents: number | null;
  description: string;
  timestamp: string;
}

export interface DashboardIntentSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  requestedBy: string;
  toAddress: string;
  amountCents: number;
  reason: string | null;
  status: string;
  policy?: {
    reasons?: string[];
    decision?: string;
  } | null;
  approvals?: Array<{
    approvedBy: string;
    note?: string;
    at: string;
  }>;
  rejection?: {
    rejectedBy: string;
    reason: string;
    at: string;
  } | null;
  execution: {
    backend: string;
    transactionRef: string | null;
    transactionUrl?: string | null;
    message: string | null;
    executedBy: string;
    executedAt: string;
  } | null;
}

export interface DashboardHeartbeatSummary {
  name: string;
  task: string;
  enabled: boolean;
  schedule: string;
  lastRun: string | null;
  nextRun: string | null;
}

export interface AutomatonDashboardSnapshot {
  ok: boolean;
  generatedAt: string;
  snapshotMs?: number;
  error?: string;
  config?: {
    name: string;
    walletAddress: string;
    creatorAddress: string;
    sandboxId: string;
    inferenceModel: string;
    dbPath: string;
    version: string;
  };
  status?: {
    agentState: string;
    turnCount: number;
    installedToolsCount: number;
    heartbeatTotal: number;
    heartbeatEnabled: number;
    roughHealth: "nominal" | "attention" | "warning" | string;
    lastTurnAt: string | null;
  };
  heartbeats?: DashboardHeartbeatSummary[];
  treasury?: {
    counts: Record<string, number>;
    pendingApprovalCount: number;
    executedSpendLast24hCents: number;
    txExplorerTxUrlTemplate?: string | null;
    recentIntents: DashboardIntentSummary[];
  };
  activity?: {
    recentTurns: DashboardTurnSummary[];
    recentTransactions: DashboardTxnSummary[];
  };
  telemetry?: {
    serverUptimeSeconds: number;
    nodeRssMb: number;
    nodeHeapUsedMb: number;
    nodeHeapTotalMb: number;
  };
}

export interface AutomatonDashboardRuntime {
  snapshot: AutomatonDashboardSnapshot | null;
  loading: boolean;
  connected: boolean;
  error: string | null;
  fetchLatencyMs: number | null;
  refresh: () => Promise<void>;
}

export interface TreasuryIntentListResponse {
  ok: boolean;
  error?: string;
  filters?: {
    status: string;
    limit: number;
    q: string;
  };
  counts?: Record<string, number>;
  intents?: DashboardIntentSummary[];
}

export interface TreasuryPolicySettingsValues {
  requireAllowlist: boolean;
  allowlist: string[];
  minReserveCents: number;
  autoApproveMaxCents: number;
  hardPerTransferCents: number;
  hardDailyLimitCents: number;
  autoExecuteApproved: boolean;
}

export interface TreasuryPolicySettingsEnvelope {
  envFilePath: string;
  editableKeys: string[];
  confirmationPhrase: string;
  file: {
    exists: boolean;
    sizeBytes: number;
    mtime: string | null;
  };
  values: TreasuryPolicySettingsValues;
  notes?: {
    localDashboardApiAppliedImmediately?: boolean;
    restartOtherProcessesRecommended?: boolean;
    restartTargets?: string[];
  };
}



export interface OperatorStackComponentStatus {
  name: string;
  raw: string;
  state: string;
  pid: number | null;
  port: number | null;
  logPath: string | null;
  details: string;
}

export interface OperatorStackStatusEnvelope {
  scriptPath: string;
  stateDir: string;
  statusFetchedAt: string;
  components: Record<string, OperatorStackComponentStatus>;
  rawStatusOutput: string;
  statusCommandOk: boolean;
  statusCommandError: string | null;
}

export interface OperatorStackActionResult {
  ok: boolean;
  action: string;
  force: boolean;
  components: string[];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
  timedOut: boolean;
}

export interface OperatorStackStatusResponse {
  ok: boolean;
  error?: string;
  operatorStack?: OperatorStackStatusEnvelope;
  actionResult?: OperatorStackActionResult | null;
}

export interface TreasurySettingsResponse {
  ok: boolean;
  error?: string;
  settings?: TreasuryPolicySettingsEnvelope;
  updated?: {
    actor: string;
    reason: string;
    at: string;
    changedKeys: string[];
  };
}
