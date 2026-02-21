import type { AutomatonDatabase } from "../types.js";
import type {
  TreasuryRejectionRecord,
  TreasuryTransferIntent,
  TreasuryExecutionRecord,
} from "./types.js";
import { queueTreasuryAlert } from "./alerts.js";

const TRANSFER_INTENTS_KV_KEY = "treasury.transfer_intents.v1";
const MAX_INTENTS = 2000;

function readTransferIntents(db: AutomatonDatabase): TreasuryTransferIntent[] {
  const raw = db.getKV(TRANSFER_INTENTS_KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as TreasuryTransferIntent[];
  } catch {
    return [];
  }
}

function writeTransferIntents(
  db: AutomatonDatabase,
  intents: TreasuryTransferIntent[],
): void {
  db.setKV(
    TRANSFER_INTENTS_KV_KEY,
    JSON.stringify(intents.slice(0, MAX_INTENTS)),
  );
}

export function listTransferIntents(
  db: AutomatonDatabase,
  opts?: {
    status?: TreasuryTransferIntent["status"];
    limit?: number;
  },
): TreasuryTransferIntent[] {
  const status = opts?.status;
  const limit = opts?.limit ?? 100;
  const intents = readTransferIntents(db)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((intent) => (status ? intent.status === status : true));
  return intents.slice(0, Math.max(1, limit));
}

export function getTransferIntentById(
  db: AutomatonDatabase,
  id: string,
): TreasuryTransferIntent | undefined {
  return readTransferIntents(db).find((intent) => intent.id === id);
}

export function appendTransferIntent(
  db: AutomatonDatabase,
  intent: TreasuryTransferIntent,
): TreasuryTransferIntent {
  const intents = readTransferIntents(db);
  const next = [intent, ...intents.filter((entry) => entry.id !== intent.id)];
  writeTransferIntents(db, next);
  queueTreasuryAlert("request_created", intent);
  return intent;
}

export function updateTransferIntent(
  db: AutomatonDatabase,
  id: string,
  mutator: (intent: TreasuryTransferIntent) => TreasuryTransferIntent,
): TreasuryTransferIntent | undefined {
  const intents = readTransferIntents(db);
  const index = intents.findIndex((intent) => intent.id === id);
  if (index < 0) return undefined;

  const previousStatus = intents[index]!.status;
  const updated = mutator(intents[index]!);
  updated.updatedAt = new Date().toISOString();
  intents[index] = updated;
  writeTransferIntents(db, intents);
  if (updated.status !== previousStatus) {
    queueTreasuryAlert("status_changed", updated, { previousStatus });
  }
  return updated;
}

export function approveTransferIntent(
  db: AutomatonDatabase,
  id: string,
  approvedBy: string,
  note?: string,
): TreasuryTransferIntent | undefined {
  return updateTransferIntent(db, id, (intent) => ({
    ...intent,
    status:
      intent.status === "executed" || intent.status === "submitted"
        ? intent.status
        : "approved",
    approvals: [
      ...intent.approvals,
      {
        approvedBy,
        note,
        at: new Date().toISOString(),
      },
    ],
  }));
}

export function rejectTransferIntent(
  db: AutomatonDatabase,
  id: string,
  rejection: TreasuryRejectionRecord,
): TreasuryTransferIntent | undefined {
  return updateTransferIntent(db, id, (intent) => ({
    ...intent,
    status: "rejected",
    rejection,
  }));
}

export function setTransferIntentExecution(
  db: AutomatonDatabase,
  id: string,
  status: "submitted" | "executed" | "failed",
  execution: TreasuryExecutionRecord,
): TreasuryTransferIntent | undefined {
  return updateTransferIntent(db, id, (intent) => ({
    ...intent,
    status,
    execution,
  }));
}

export function getExecutedSpendLast24hCents(db: AutomatonDatabase): number {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  return readTransferIntents(db)
    .filter(
      (intent) =>
        intent.status === "submitted" || intent.status === "executed",
    )
    .filter((intent) => new Date(intent.createdAt).getTime() >= cutoffMs)
    .reduce((acc, intent) => acc + intent.amountCents, 0);
}
