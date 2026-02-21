import type {
  TreasuryIntentStatus,
  TreasuryTransferIntent,
} from "./types.js";

export type TreasuryAlertEvent = "request_created" | "status_changed";

export interface TreasuryStatusChangeContext {
  previousStatus: TreasuryIntentStatus;
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

function readStringEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function isTelegramAlertsEnabled(): boolean {
  return readBooleanEnv("AUTOMATON_TREASURY_TELEGRAM_ALERTS_ENABLED", true);
}

function getTelegramBotToken(): string {
  return readStringEnv("AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN");
}

function getTelegramChatId(): string {
  return readStringEnv("AUTOMATON_TREASURY_TELEGRAM_CHAT_ID");
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function trimReason(reason: string | undefined, maxLength = 220): string {
  if (!reason || reason.trim().length === 0) return "-";
  const normalized = reason.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function readTxExplorerTemplate(): string {
  const fromEnv = readStringEnv("AUTOMATON_TREASURY_TX_EXPLORER_TX_URL_TEMPLATE");
  if (fromEnv) {
    return fromEnv;
  }

  const chain = readStringEnv("AUTOMATON_VULTISIG_SEND_CHAIN").toLowerCase();
  switch (chain) {
    case "base":
      return "https://basescan.org/tx/{tx}";
    case "ethereum":
      return "https://etherscan.io/tx/{tx}";
    case "arbitrum":
      return "https://arbiscan.io/tx/{tx}";
    case "optimism":
      return "https://optimistic.etherscan.io/tx/{tx}";
    case "polygon":
      return "https://polygonscan.com/tx/{tx}";
    default:
      return "";
  }
}

function buildTxLink(txRef: string | undefined): string | undefined {
  if (!txRef || !/^0x[a-fA-F0-9]{64}$/.test(txRef)) {
    return undefined;
  }

  const template = readTxExplorerTemplate();
  if (!template) {
    return undefined;
  }
  if (template.includes("{tx}")) {
    return template.replaceAll("{tx}", txRef);
  }

  const normalized = template.endsWith("/") ? template.slice(0, -1) : template;
  return `${normalized}/${txRef}`;
}

function buildAlertMessage(
  event: TreasuryAlertEvent,
  intent: TreasuryTransferIntent,
  context?: TreasuryStatusChangeContext,
): string {
  const lines: string[] = [
    "Automaton Treasury Alert",
    `Event: ${event}`,
    `Intent: ${intent.id}`,
    `Amount: ${formatUsd(intent.amountCents)}`,
    `To: ${intent.toAddress}`,
    `Source: ${intent.source}`,
    `Requested By: ${intent.requestedBy}`,
  ];

  if (event === "status_changed" && context) {
    lines.push(`Status: ${context.previousStatus} -> ${intent.status}`);
  } else {
    lines.push(`Status: ${intent.status}`);
  }

  if (intent.execution?.transactionRef) {
    lines.push(`Tx Ref: ${intent.execution.transactionRef}`);
  }
  const txLink = buildTxLink(intent.execution?.transactionRef);
  if (txLink) {
    lines.push(`Tx Link: ${txLink}`);
  }
  if (intent.childId) {
    lines.push(`Child ID: ${intent.childId}`);
  }
  lines.push(`Reason: ${trimReason(intent.reason)}`);
  if (intent.status === "pending_approval") {
    lines.push(`Action: /approve ${intent.id} | /reject ${intent.id} <reason>`);
  }
  lines.push(`At: ${new Date().toISOString()}`);

  const message = lines.join("\n");
  if (message.length <= 4000) return message;
  return `${message.slice(0, 3997)}...`;
}

async function sendTelegramMessage(message: string): Promise<void> {
  if (!isTelegramAlertsEnabled()) {
    return;
  }

  const botToken = getTelegramBotToken();
  const chatId = getTelegramChatId();
  if (!botToken || !chatId) {
    return;
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Telegram sendMessage failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

function logAlertError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[treasury-alert] ${message}`);
}

export function queueTreasuryAlert(
  event: TreasuryAlertEvent,
  intent: TreasuryTransferIntent,
  context?: TreasuryStatusChangeContext,
): void {
  const message = buildAlertMessage(event, intent, context);
  void sendTelegramMessage(message).catch(logAlertError);
}
