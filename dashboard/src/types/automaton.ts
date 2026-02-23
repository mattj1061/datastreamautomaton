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

export interface FactoryDataSourceStatus {
  name: string;
  status: string;
  reachable: boolean;
  stale: boolean;
  staleAgeSeconds: number | null;
  used: boolean;
  lastFetchedAt: string | null;
  path: string | null;
  message: string | null;
  error: string | null;
}

export interface FactoryRelatedEntityRef {
  type: string;
  id: string;
}

export interface FactoryAlert {
  code: string;
  severity: 'high' | 'medium' | 'info' | 'low' | string;
  message: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  relatedEntity: FactoryRelatedEntityRef | null;
  details: Record<string, unknown> | null;
}

export interface FactoryIntegrationSummary {
  enabled: boolean;
  apiBaseUrl: string;
  internalSnapshotPath: string;
  productServiceReachability: 'connected' | 'degraded' | 'offline' | string;
  factoryStatus: 'nominal' | 'attention' | 'warning' | 'degraded' | string;
  pipelineFreshnessMaxMinutes: number;
  thresholds: {
    marginFloor: number;
    retentionFloor: number;
    signalQualityMin: number;
    signalQualityDriftMax: number;
    minPaidCustomers: number;
    nextSourceMonthlyCost: number;
  };
  autoReprice: {
    enabled: boolean;
    productId: string;
    accessMode: 'latest' | 'history' | string;
    stepPct: number;
    maxUsdc: number;
  };
  autoExpansion: {
    applyEnabled: boolean;
    family: string;
    sourceRef: string;
    pollingIntervalSeconds: number;
    qualityScore: number;
    namePrefix: string;
    runSynthesis: boolean;
    targetProductIds: string[];
  };
}

export interface FactoryInputStream {
  id: string;
  name: string;
  family: string;
  status: string;
  sourceRef: string;
  pollingIntervalSeconds: number | null;
  qualityScore: number | null;
  lastObservedAt: string | null;
  freshnessSeconds: number | null;
  observationsLastHour: number | null;
  errorCount24h: number | null;
  costPerMonthUsd: number | null;
}

export interface FactoryInputFamilySummary {
  family: string;
  total: number;
  active: number;
  healthyCount: number;
  medianFreshnessSeconds: number | null;
  qualityAvg: number | null;
}

export interface FactorySourceInputsSection {
  totalStreams: number;
  activeStreams: number;
  families: FactoryInputFamilySummary[];
  items: FactoryInputStream[];
}

export interface FactoryPipelineStageStatus {
  stage: string;
  status: string;
  cadenceSeconds: number | null;
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  backlogCount: number | null;
  errorCount24h: number | null;
}

export interface FactoryAutomationHeartbeatStatus {
  task: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  lastRun: string | null;
  nextRun: string | null;
  status: string;
}

export interface FactoryPipelineHealth {
  checkedAt: string | null;
  healthy: boolean | null;
  status: string | null;
  lastFeatureAt: string | null;
  lastPublishAt: string | null;
  freshnessMinutes: number | null;
  freshnessThresholdMinutes: number | null;
  uptime7dPercent: number | null;
  uptime7dSampleCount: number;
  lastError: {
    checkedAt: string | null;
    error: string | null;
  } | null;
}

export interface FactoryPipelineSection {
  health: FactoryPipelineHealth;
  stages: FactoryPipelineStageStatus[];
  automationHeartbeats: FactoryAutomationHeartbeatStatus[];
}

export interface FactoryOutputProduct {
  productId: string;
  status: string;
  latestPublishAt: string | null;
  freshnessMinutes: number | null;
  latestScore: number | null;
  latestConfidence: number | null;
  latestRegime: string | null;
  pricing: {
    latestPriceUsdc: number | null;
    historyBasePriceUsdc: number | null;
  };
  usage: {
    calls24h: number | null;
    paidCalls24h: number | null;
  };
  economics: {
    revenue24h: number | null;
    revenue7d: number | null;
  };
  quality: {
    qualityScore: number | null;
    medianConfidence24h: number | null;
  };
  badges: string[];
}

export interface FactoryOutputsSection {
  totalProducts: number;
  activeProducts: number;
  items: FactoryOutputProduct[];
}

export interface FactoryWebhookDeliveryAttempt {
  id: string;
  subscriptionId: string;
  productId: string;
  customerId: string;
  triggerType: string;
  triggerEventId: string | null;
  triggerEventCreatedAt: string | null;
  attemptNumber: number | null;
  terminal: boolean;
  status: string;
  httpStatus: number | null;
  errorMessage: string | null;
  signalPointId: string | null;
  signalBucketAt: string | null;
  nextRetryAt: string | null;
  createdAt: string | null;
}

export interface FactoryWebhookDeliverySection {
  available: boolean;
  endpointReachability: string;
  fetchedAt: string | null;
  persistenceBackend: string | null;
  totalAttempts: number;
  statusCounts: {
    delivered: number;
    failed: number;
    deadLettered: number;
  };
  attempts: FactoryWebhookDeliveryAttempt[];
  error: string | null;
}

export interface FactoryDeliverySection {
  webhooks: FactoryWebhookDeliverySection;
}

export interface FactorySettlementReconciliationEvent {
  paymentEventId: string;
  createdAt: string;
  customerId: string;
  productId: string;
  accessMode: string;
  amountUsdc: number | null;
  requiredAmountUsdc: number | null;
  verificationMethod: string;
  transactionRef: string;
  verificationProofRef: string | null;
  settlementTxHash: string | null;
  status: string;
  flags: string[];
  reason: string | null;
  receipt: {
    txHash: string;
    found: boolean;
    status: string | null;
    blockNumber: number | null;
    tokenTransferMatched: boolean | null;
    tokenTransferAmountAtomic: string | null;
    assetAddressMatched: boolean | null;
    payToAddressMatched: boolean | null;
  } | null;
}

export interface FactorySettlementReconciliationException {
  paymentEventId: string;
  createdAt: string;
  productId: string;
  status: string;
  flags: string[];
  settlementTxHash: string | null;
  reason: string | null;
}

export interface FactorySettlementReconciliationSection {
  available: boolean;
  endpointReachability: string;
  fetchedAt: string | null;
  error: string | null;
  rpc: {
    enabled: boolean;
    urlConfigured: boolean;
    tokenDecimals: number | null;
    sellerPayToAddress: string | null;
    sellerTokenAddress: string | null;
    checkedTransactions: number;
  };
  summary: {
    acceptedPayments: number;
    acceptedRevenueUsdc: number | null;
    officialAcceptedPayments: number;
    officialAcceptedRevenueUsdc: number | null;
    legacyAcceptedPayments: number;
    legacyAcceptedRevenueUsdc: number | null;
    reconciledPayments: number;
    reconciledRevenueUsdc: number | null;
    pendingOrUnverifiedOfficialPayments: number;
    failedOfficialPayments: number;
    duplicateSettlementTxHashes: number;
    txHashCoverageRate: number | null;
    receiptConfirmationRate: number | null;
  };
  exceptions: FactorySettlementReconciliationException[];
  events: FactorySettlementReconciliationEvent[];
}

export interface FactoryEconomicsSection {
  revenuePerDay: number | null;
  costPerDay: number | null;
  grossMargin: number | null;
  customerRetention: number | null;
  paidCustomers7d: number | null;
  signalQualityScore: number | null;
  previousSignalQualityScore: number | null;
  metricsGeneratedAt: string | null;
  revenue7d: number | null;
  cost7d: number | null;
  netProfit7d: number | null;
  uptime7dPercent: number | null;
}

export interface FactoryReinvestmentChecklistItem {
  key: string;
  label: string;
  pass: boolean | null;
  actual: number | null;
  target: number | null;
  unit: string;
}

export interface FactoryReinvestmentChecklist {
  netProfit7d: number | null;
  expansionBudget: number | null;
  requiredBudget: number | null;
  items: FactoryReinvestmentChecklistItem[];
}

export interface FactoryAutonomySection {
  lastAutoReprice: Record<string, unknown> | null;
  lastExpansionEvaluation: Record<string, unknown> | null;
  lastExpansionApplied: Record<string, unknown> | null;
  patchPipeline: Record<string, unknown> | null;
  nextSourceCandidate: {
    family: string;
    sourceRef: string;
    pollingIntervalSeconds: number;
    qualityScore: number;
    targetProductIds: string[];
    autoApplyEnabled: boolean;
    runSynthesisAfterApply: boolean;
  };
  autoRepriceConfig: {
    enabled: boolean;
    productId: string;
    accessMode: string;
    stepPct: number;
    maxUsdc: number;
  };
  reinvestment: FactoryReinvestmentChecklist;
}

export interface FactorySnapshot {
  generatedAt: string;
  snapshotMs: number;
  mode: 'live' | 'degraded_runtime_only' | 'offline';
  integration: FactoryIntegrationSummary;
  sources: FactorySourceInputsSection;
  pipeline: FactoryPipelineSection;
  outputs: FactoryOutputsSection;
  delivery: FactoryDeliverySection;
  settlement: FactorySettlementReconciliationSection;
  economics: FactoryEconomicsSection;
  autonomy: FactoryAutonomySection;
  alerts: FactoryAlert[];
  dataSources: FactoryDataSourceStatus[];
}

export interface FactoryDashboardResponse {
  ok: boolean;
  error?: string;
  factory?: FactorySnapshot;
}

export interface FactoryDashboardRuntime {
  snapshot: FactorySnapshot | null;
  loading: boolean;
  connected: boolean;
  error: string | null;
  fetchLatencyMs: number | null;
  refresh: () => Promise<void>;
}
