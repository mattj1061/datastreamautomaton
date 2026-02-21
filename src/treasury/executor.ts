import { ulid } from "ulid";

import type { AutomatonDatabase, ConwayClient } from "../types.js";
import { createVultisigBroker } from "./vultisig-broker.js";
import {
  getTransferIntentById,
  setTransferIntentExecution,
} from "./intent-queue.js";
import type { TreasuryTransferIntent } from "./types.js";

function readExecutionBackend(): "conway" | "vultisig" {
  const raw = (process.env.AUTOMATON_TREASURY_EXECUTION_BACKEND || "vultisig")
    .trim()
    .toLowerCase();
  return raw === "conway" ? "conway" : "vultisig";
}

export interface ExecuteTransferIntentOptions {
  executedBy: string;
}

function markTxn(
  db: AutomatonDatabase,
  intent: TreasuryTransferIntent,
  description: string,
): void {
  db.insertTransaction({
    id: ulid(),
    type: "transfer_out",
    amountCents: intent.amountCents,
    description,
    timestamp: new Date().toISOString(),
  });
}

export async function executeApprovedTransferIntent(
  db: AutomatonDatabase,
  conway: ConwayClient,
  intentId: string,
  options: ExecuteTransferIntentOptions,
): Promise<TreasuryTransferIntent> {
  const intent = getTransferIntentById(db, intentId);
  if (!intent) {
    throw new Error(`Transfer intent ${intentId} not found.`);
  }
  if (intent.status !== "approved") {
    throw new Error(
      `Transfer intent ${intentId} must be approved before execution (current: ${intent.status}).`,
    );
  }

  const backend = readExecutionBackend();
  if (backend === "conway") {
    const transfer = await conway.transferCredits(
      intent.toAddress,
      intent.amountCents,
      intent.reason,
    );
    const executionStatus =
      transfer.status === "completed" ? "executed" : "submitted";
    const updated = setTransferIntentExecution(db, intentId, executionStatus, {
      backend: "conway",
      transactionRef: transfer.transferId || undefined,
      message: `Conway credit transfer ${transfer.status}`,
      executedBy: options.executedBy,
      executedAt: new Date().toISOString(),
    });
    if (!updated) {
      throw new Error(`Failed to update transfer intent ${intentId}.`);
    }

    markTxn(
      db,
      updated,
      `Executed transfer intent ${intentId} via conway (${transfer.status})`,
    );
    return updated;
  }

  const broker = createVultisigBroker();
  const result = await broker.submitTransferIntent(intent);
  if (!result.ok) {
    const failed = setTransferIntentExecution(db, intentId, "failed", {
      backend: "vultisig",
      transactionRef: result.transactionRef,
      message: result.message,
      executedBy: options.executedBy,
      executedAt: new Date().toISOString(),
    });
    if (!failed) {
      throw new Error(`Failed to update transfer intent ${intentId}.`);
    }
    throw new Error(result.message);
  }

  const status = "submitted";
  const updated = setTransferIntentExecution(db, intentId, status, {
    backend: "vultisig",
    transactionRef: result.transactionRef,
    message: result.message,
    executedBy: options.executedBy,
    executedAt: new Date().toISOString(),
  });
  if (!updated) {
    throw new Error(`Failed to update transfer intent ${intentId}.`);
  }

  markTxn(
    db,
    updated,
    `Executed transfer intent ${intentId} via vultisig (${result.status})`,
  );
  return updated;
}
