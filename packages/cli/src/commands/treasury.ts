/**
 * automaton-cli treasury <subcommand>
 *
 * Creator-facing treasury controls:
 * - list intents
 * - approve/reject intents
 * - execute approved intents
 * - set child wallet addresses for safe funding
 */

import { importAutomatonModule } from "../runtime-import.js";

type TreasuryIntentStatus =
  import("@conway/automaton/treasury/types.js").TreasuryIntentStatus;

const { loadConfig, resolvePath } =
  await importAutomatonModule<typeof import("@conway/automaton/config.js")>(
    "config.js",
  );
const { createConwayClient } = await importAutomatonModule<
  typeof import("@conway/automaton/conway/client.js")
>("conway/client.js");
const { createDatabase } = await importAutomatonModule<
  typeof import("@conway/automaton/state/database.js")
>("state/database.js");
const {
  approveTransferIntent,
  getTransferIntentById,
  listTransferIntents,
  rejectTransferIntent,
  setTransferIntentExecution,
} = await importAutomatonModule<
  typeof import("@conway/automaton/treasury/intent-queue.js")
>("treasury/intent-queue.js");
const { executeApprovedTransferIntent } = await importAutomatonModule<
  typeof import("@conway/automaton/treasury/executor.js")
>("treasury/executor.js");

const args = process.argv.slice(3);
const subcommand = args[0];

function usage(): void {
  console.log(`Usage:
  automaton-cli treasury list [--status <status>] [--limit <n>]
  automaton-cli treasury show <intent-id>
  automaton-cli treasury approve <intent-id> [--note <text>] [--by <actor>] [--execute]
  automaton-cli treasury reject <intent-id> --reason <text> [--by <actor>]
  automaton-cli treasury execute <intent-id> [--by <actor>]
  automaton-cli treasury confirm <intent-id> --tx <ref> [--status submitted|executed] [--message <text>] [--by <actor>]
  automaton-cli treasury fail <intent-id> --reason <text> [--tx <ref>] [--by <actor>]
  automaton-cli treasury set-child-address <child-id> <0xaddress>

Statuses:
  pending_approval | approved | rejected | submitted | executed | failed
`);
}

function readFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 50;
}

function parseStatus(raw: string | undefined): TreasuryIntentStatus | undefined {
  if (!raw) return undefined;
  const allowed: TreasuryIntentStatus[] = [
    "pending_approval",
    "approved",
    "rejected",
    "submitted",
    "executed",
    "failed",
  ];
  return allowed.includes(raw as TreasuryIntentStatus)
    ? (raw as TreasuryIntentStatus)
    : undefined;
}

function parseConfirmStatus(raw: string | undefined): "submitted" | "executed" {
  const normalized = (raw || "executed").trim().toLowerCase();
  return normalized === "submitted" ? "submitted" : "executed";
}

function maskAddress(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return address;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function currentTreasuryBackend(): "conway" | "vultisig" {
  const raw = (process.env.AUTOMATON_TREASURY_EXECUTION_BACKEND || "vultisig")
    .trim()
    .toLowerCase();
  return raw === "conway" ? "conway" : "vultisig";
}

function createConwayClientForExecution(): ReturnType<typeof createConwayClient> {
  const activeConfig = config;
  if (!activeConfig) {
    throw new Error("No automaton configuration found.");
  }

  if (currentTreasuryBackend() === "conway" && !activeConfig.conwayApiKey) {
    throw new Error(
      "Cannot execute: no Conway API key in config while treasury backend is conway.",
    );
  }

  return createConwayClient({
    apiUrl: activeConfig.conwayApiUrl,
    apiKey: activeConfig.conwayApiKey || "",
    sandboxId: activeConfig.sandboxId,
  });
}

function applyChildFundingIfNeeded(
  previousStatus: TreasuryIntentStatus,
  intent: {
    childId?: string;
    amountCents: number;
  },
): void {
  if (!intent.childId) return;
  if (previousStatus === "executed") return;
  const child = db.getChildById(intent.childId);
  if (!child) return;
  db.updateChildFunding(
    child.id,
    Math.max(0, child.fundedAmountCents + intent.amountCents),
  );
}

const config = loadConfig();
if (!config) {
  console.log("No automaton configuration found.");
  process.exit(1);
}
const db = createDatabase(resolvePath(config.dbPath));

try {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    usage();
    process.exit(0);
  }

  if (subcommand === "list") {
    const status = parseStatus(readFlag("--status"));
    const limit = parseLimit(readFlag("--limit"));
    const intents = listTransferIntents(db, { status, limit });
    if (intents.length === 0) {
      console.log("No transfer intents found.");
      process.exit(0);
    }

    for (const intent of intents) {
      const reason =
        intent.reason && intent.reason.trim().length > 0
          ? `reason="${intent.reason.slice(0, 80)}"`
          : "reason=<none>";
      const line = [
        intent.id,
        `[${intent.status}]`,
        `$${(intent.amountCents / 100).toFixed(2)}`,
        `to ${maskAddress(intent.toAddress)}`,
        intent.source,
        reason,
        intent.createdAt,
      ].join(" ");
      console.log(line);
    }
    process.exit(0);
  }

  if (subcommand === "show") {
    const id = args[1];
    if (!id) {
      usage();
      process.exit(1);
    }
    const intent = getTransferIntentById(db, id);
    if (!intent) {
      console.log(`Transfer intent ${id} not found.`);
      process.exit(1);
    }
    console.log(JSON.stringify(intent, null, 2));
    process.exit(0);
  }

  if (subcommand === "approve") {
    const id = args[1];
    if (!id) {
      usage();
      process.exit(1);
    }
    const actor = readFlag("--by") || "creator-cli";
    const note = readFlag("--note");
    const approved = approveTransferIntent(db, id, actor, note);
    if (!approved) {
      console.log(`Transfer intent ${id} not found.`);
      process.exit(1);
    }

    console.log(`Approved transfer intent ${approved.id}.`);
    if (!hasFlag("--execute")) {
      process.exit(0);
    }

    const conway = createConwayClientForExecution();
    const executed = await executeApprovedTransferIntent(
      db,
      conway,
      approved.id,
      { executedBy: actor },
    );
    applyChildFundingIfNeeded(approved.status, executed);
    console.log(
      `Executed transfer intent ${executed.id} -> ${executed.status} (${executed.execution?.message || "ok"})`,
    );
    process.exit(0);
  }

  if (subcommand === "reject") {
    const id = args[1];
    if (!id) {
      usage();
      process.exit(1);
    }
    const reason = readFlag("--reason");
    if (!reason) {
      console.log("Reject requires --reason <text>.");
      process.exit(1);
    }
    const actor = readFlag("--by") || "creator-cli";
    const rejected = rejectTransferIntent(db, id, {
      rejectedBy: actor,
      reason,
      at: new Date().toISOString(),
    });
    if (!rejected) {
      console.log(`Transfer intent ${id} not found.`);
      process.exit(1);
    }
    console.log(`Rejected transfer intent ${rejected.id}.`);
    process.exit(0);
  }

  if (subcommand === "execute") {
    const id = args[1];
    if (!id) {
      usage();
      process.exit(1);
    }
    const actor = readFlag("--by") || "creator-cli";
    const existing = getTransferIntentById(db, id);
    const previousStatus = existing?.status || "approved";
    const conway = createConwayClientForExecution();
    const executed = await executeApprovedTransferIntent(db, conway, id, {
      executedBy: actor,
    });
    applyChildFundingIfNeeded(previousStatus, executed);
    console.log(
      `Executed transfer intent ${executed.id} -> ${executed.status} (${executed.execution?.message || "ok"})`,
    );
    process.exit(0);
  }

  if (subcommand === "confirm") {
    const id = args[1];
    if (!id) {
      usage();
      process.exit(1);
    }

    const intent = getTransferIntentById(db, id);
    if (!intent) {
      console.log(`Transfer intent ${id} not found.`);
      process.exit(1);
    }

    const txRef = readFlag("--tx");
    if (!txRef) {
      console.log("Confirm requires --tx <reference>.");
      process.exit(1);
    }

    const status = parseConfirmStatus(readFlag("--status"));
    const actor = readFlag("--by") || "vultisig-worker";
    const message =
      readFlag("--message") ||
      (status === "executed"
        ? "External signer confirmed execution."
        : "External signer accepted submission.");

    const updated = setTransferIntentExecution(db, id, status, {
      backend: intent.execution?.backend || "vultisig",
      transactionRef: txRef,
      message,
      executedBy: actor,
      executedAt: new Date().toISOString(),
    });
    if (!updated) {
      console.log(`Failed to update transfer intent ${id}.`);
      process.exit(1);
    }

    if (status === "executed") {
      applyChildFundingIfNeeded(intent.status, updated);
    }

    console.log(`Confirmed transfer intent ${id} as ${status} (tx=${txRef}).`);
    process.exit(0);
  }

  if (subcommand === "fail") {
    const id = args[1];
    if (!id) {
      usage();
      process.exit(1);
    }

    const intent = getTransferIntentById(db, id);
    if (!intent) {
      console.log(`Transfer intent ${id} not found.`);
      process.exit(1);
    }

    const reason = readFlag("--reason");
    if (!reason) {
      console.log("Fail requires --reason <text>.");
      process.exit(1);
    }

    const txRef = readFlag("--tx");
    const actor = readFlag("--by") || "vultisig-worker";
    const updated = setTransferIntentExecution(db, id, "failed", {
      backend: intent.execution?.backend || "vultisig",
      transactionRef: txRef,
      message: reason,
      executedBy: actor,
      executedAt: new Date().toISOString(),
    });
    if (!updated) {
      console.log(`Failed to update transfer intent ${id}.`);
      process.exit(1);
    }

    console.log(`Marked transfer intent ${id} as failed (${reason}).`);
    process.exit(0);
  }

  if (subcommand === "set-child-address") {
    const childId = args[1];
    const address = args[2];
    if (!childId || !address) {
      usage();
      process.exit(1);
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      console.log("Address must be a valid 0x-prefixed 40-hex value.");
      process.exit(1);
    }
    const child = db.getChildById(childId);
    if (!child) {
      console.log(`Child ${childId} not found.`);
      process.exit(1);
    }
    db.updateChildAddress(childId, address);
    console.log(`Updated child ${childId} address to ${address}.`);
    process.exit(0);
  }

  usage();
  process.exit(1);
} finally {
  db.close();
}
