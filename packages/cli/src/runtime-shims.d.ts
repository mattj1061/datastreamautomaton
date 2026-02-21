declare module "@conway/automaton/config.js" {
  export interface AutomatonCliConfig {
    name: string;
    walletAddress: string;
    creatorAddress: string;
    sandboxId: string;
    dbPath: string;
    inferenceModel: string;
    conwayApiUrl: string;
    conwayApiKey: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    socialRelayUrl?: string;
  }

  export function loadConfig(): AutomatonCliConfig | null;
  export function resolvePath(p: string): string;
}

declare module "@conway/automaton/state/database.js" {
  export interface CliToolCall {
    name: string;
    result: string;
    error?: string;
  }

  export interface CliTurn {
    id: string;
    timestamp: string;
    state: string;
    input?: string;
    inputSource?: string;
    thinking: string;
    toolCalls: CliToolCall[];
    tokenUsage: { totalTokens: number };
    costCents: number;
  }

  export interface CliHeartbeatEntry {
    enabled: boolean;
  }

  export interface CliInstalledTool {
    id: string;
    name: string;
  }

  export interface AutomatonCliDatabase {
    getAgentState(): string;
    getTurnCount(): number;
    getInstalledTools(): CliInstalledTool[];
    getHeartbeatEntries(): CliHeartbeatEntry[];
    getRecentTurns(limit: number): CliTurn[];
    getChildById(id: string): { id: string; fundedAmountCents: number } | undefined;
    updateChildAddress(id: string, address: string): void;
    updateChildFunding(id: string, fundedAmountCents: number): void;
    close(): void;
  }

  export function createDatabase(path: string): AutomatonCliDatabase;
}

declare module "@conway/automaton/conway/client.js" {
  export interface CliConwayClient {
    transferCredits(
      toAddress: string,
      amountCents: number,
      note?: string,
    ): Promise<{
      transferId?: string;
      status: string;
      toAddress: string;
      amountCents: number;
      balanceAfterCents?: number;
    }>;
  }

  export function createConwayClient(params: {
    apiUrl: string;
    apiKey: string;
    sandboxId: string;
  }): CliConwayClient;
}

declare module "@conway/automaton/treasury/types.js" {
  export type TreasuryIntentStatus =
    | "pending_approval"
    | "approved"
    | "rejected"
    | "submitted"
    | "executed"
    | "failed";
}

declare module "@conway/automaton/treasury/intent-queue.js" {
  import type { TreasuryIntentStatus } from "@conway/automaton/treasury/types.js";

  export interface CliTreasuryIntent {
    id: string;
    createdAt: string;
    source: string;
    toAddress: string;
    amountCents: number;
    reason?: string;
    childId?: string;
    status: TreasuryIntentStatus;
    execution?: {
      backend: "conway" | "vultisig";
      transactionRef?: string;
      message: string;
      executedBy: string;
      executedAt: string;
    };
  }

  export function listTransferIntents(
    db: unknown,
    opts?: { status?: TreasuryIntentStatus; limit?: number },
  ): CliTreasuryIntent[];
  export function getTransferIntentById(
    db: unknown,
    id: string,
  ): CliTreasuryIntent | undefined;
  export function approveTransferIntent(
    db: unknown,
    id: string,
    approvedBy: string,
    note?: string,
  ): CliTreasuryIntent | undefined;
  export function rejectTransferIntent(
    db: unknown,
    id: string,
    rejection: { rejectedBy: string; reason: string; at: string },
  ): CliTreasuryIntent | undefined;
  export function setTransferIntentExecution(
    db: unknown,
    id: string,
    status: "submitted" | "executed" | "failed",
    execution: {
      backend: "conway" | "vultisig";
      transactionRef?: string;
      message: string;
      executedBy: string;
      executedAt: string;
    },
  ): CliTreasuryIntent | undefined;
}

declare module "@conway/automaton/treasury/executor.js" {
  export interface CliExecutedIntent {
    id: string;
    status: "submitted" | "executed" | "failed";
    amountCents: number;
    childId?: string;
    execution?: {
      backend: "conway" | "vultisig";
      message: string;
    };
  }

  export function executeApprovedTransferIntent(
    db: unknown,
    conway: unknown,
    intentId: string,
    options: { executedBy: string },
  ): Promise<CliExecutedIntent>;
}
