import fs from "fs";
import path from "path";

import type { TreasuryTransferIntent } from "./types.js";

export interface VultisigSubmitResult {
  ok: boolean;
  status: "queued_external" | "submitted" | "failed";
  transactionRef?: string;
  message: string;
}

export interface VultisigBroker {
  submitTransferIntent(
    intent: TreasuryTransferIntent,
  ): Promise<VultisigSubmitResult>;
}

interface VultisigBrokerConfig {
  mode: "outbox" | "http";
  outboxDir: string;
  brokerUrl?: string;
  brokerToken?: string;
  requestTimeoutMs: number;
  vaultPolicyProfile: string;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveHome(value: string): string {
  if (value.startsWith("~")) {
    return path.join(process.env.HOME || "/root", value.slice(1));
  }
  return value;
}

function readConfig(): VultisigBrokerConfig {
  const modeRaw = (process.env.AUTOMATON_VULTISIG_BROKER_MODE || "outbox")
    .trim()
    .toLowerCase();
  const mode = modeRaw === "http" ? "http" : "outbox";

  return {
    mode,
    outboxDir: resolveHome(
      process.env.AUTOMATON_VULTISIG_OUTBOX_DIR ||
        "~/.automaton/vultisig-outbox",
    ),
    brokerUrl: process.env.AUTOMATON_VULTISIG_BROKER_URL,
    brokerToken: process.env.AUTOMATON_VULTISIG_BROKER_TOKEN,
    requestTimeoutMs: Math.max(
      1000,
      readNumberEnv("AUTOMATON_VULTISIG_BROKER_TIMEOUT_MS", 10_000),
    ),
    vaultPolicyProfile:
      process.env.AUTOMATON_VULTISIG_VAULT_POLICY_PROFILE || "secure",
  };
}

async function submitToOutbox(
  intent: TreasuryTransferIntent,
  cfg: VultisigBrokerConfig,
): Promise<VultisigSubmitResult> {
  try {
    fs.mkdirSync(cfg.outboxDir, { recursive: true, mode: 0o700 });
    const fileName = `${intent.id}.json`;
    const filePath = path.join(cfg.outboxDir, fileName);
    const payload = {
      submittedAt: new Date().toISOString(),
      intent,
      instructions:
        "Process with a Vultisig SDK/CLI worker and update intent status via automaton-cli treasury execute/reject workflow.",
      vaultPolicyProfile: cfg.vaultPolicyProfile,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
    return {
      ok: true,
      status: "queued_external",
      transactionRef: filePath,
      message: `Queued for Vultisig processing: ${filePath}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message:
        error instanceof Error ? error.message : "Failed writing Vultisig outbox file.",
    };
  }
}

async function submitToHttpBroker(
  intent: TreasuryTransferIntent,
  cfg: VultisigBrokerConfig,
): Promise<VultisigSubmitResult> {
  if (!cfg.brokerUrl) {
    return {
      ok: false,
      status: "failed",
      message:
        "AUTOMATON_VULTISIG_BROKER_URL is required for http broker mode.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
  try {
    const response = await fetch(cfg.brokerUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(cfg.brokerToken
          ? {
              authorization: `Bearer ${cfg.brokerToken}`,
            }
          : {}),
      },
      body: JSON.stringify({
        intent,
        vaultPolicyProfile: cfg.vaultPolicyProfile,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: "failed",
        message: `Broker rejected intent (${response.status}): ${responseText.slice(0, 300)}`,
      };
    }

    let transactionRef: string | undefined;
    try {
      const parsed = JSON.parse(responseText);
      transactionRef =
        parsed.transactionRef ||
        parsed.txHash ||
        parsed.intentId ||
        undefined;
    } catch {
      transactionRef = undefined;
    }

    return {
      ok: true,
      status: "submitted",
      transactionRef,
      message: responseText || "Submitted to external Vultisig broker.",
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message:
        error instanceof Error ? error.message : "Failed submitting to Vultisig broker.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createVultisigBroker(): VultisigBroker {
  const cfg = readConfig();
  return {
    submitTransferIntent: async (
      intent: TreasuryTransferIntent,
    ): Promise<VultisigSubmitResult> => {
      if (cfg.mode === "http") {
        return submitToHttpBroker(intent, cfg);
      }
      return submitToOutbox(intent, cfg);
    },
  };
}
