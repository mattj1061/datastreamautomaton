#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFileIfPresent(envFilePath) {
  if (!fs.existsSync(envFilePath)) return;
  const raw = fs.readFileSync(envFilePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = parseEnvValue(trimmed.slice(eq + 1));
    if (!key) continue;
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }
}

function resolveHome(inputPath) {
  if (!inputPath) return inputPath;
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function safeMessage(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 3900) return normalized;
  return `${normalized.slice(0, 3897)}...`;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) return { offset: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const offset = Number(parsed?.offset || 0);
    return { offset: Number.isFinite(offset) ? Math.floor(offset) : 0 };
  } catch {
    return { offset: 0 };
  }
}

function writeState(filePath, state) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

function findMessage(update) {
  if (update?.message) return update.message;
  if (update?.edited_message) return update.edited_message;
  return null;
}

async function telegramCall(token, method, payload) {
  const endpoint = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Telegram ${method} returned non-JSON response (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  if (!response.ok || !parsed?.ok) {
    throw new Error(
      `Telegram ${method} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }
  return parsed.result;
}

async function sendTelegramMessage(token, chatId, text) {
  const message = safeMessage(text);
  if (!message) return;
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
  });
}

function runCli(cliEntry, args) {
  const run = spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    ok: run.status === 0,
    status: run.status,
    stdout: (run.stdout || "").trim(),
    stderr: (run.stderr || "").trim(),
    error: run.error ? run.error.message : "",
  };
}

function parseCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.split(/\s+/);
  const rawCommand = (parts[0] || "").toLowerCase();
  const command = rawCommand.split("@")[0];
  const args = parts.slice(1);
  return { command, args, raw: trimmed };
}

function usage() {
  return [
    "Treasury Telegram Commands",
    "/pending [limit]",
    "/show <intent_id>",
    "/approve <intent_id>",
    "/approve_only <intent_id>",
    "/reject <intent_id> <reason>",
    "/help",
  ].join("\n");
}

async function handleCommand({
  command,
  args,
  cliEntry,
  actor,
}) {
  if (command === "/help" || command === "/start") {
    return usage();
  }

  if (command === "/pending") {
    const limit = Math.max(
      1,
      Math.min(20, Number.parseInt(args[0] || "10", 10) || 10),
    );
    const list = runCli(cliEntry, [
      "treasury",
      "list",
      "--status",
      "pending_approval",
      "--limit",
      String(limit),
    ]);
    if (!list.ok) {
      return `Failed to list pending intents:\n${list.stderr || list.stdout || list.error}`;
    }
    return list.stdout || "No pending transfer intents.";
  }

  if (command === "/show") {
    const id = (args[0] || "").trim();
    if (!id) {
      return "Usage: /show <intent_id>";
    }
    const show = runCli(cliEntry, ["treasury", "show", id]);
    if (!show.ok) {
      return `Failed to show intent ${id}:\n${show.stderr || show.stdout || show.error}`;
    }
    return show.stdout || `No output for intent ${id}.`;
  }

  if (command === "/approve" || command === "/approve_only") {
    const id = (args[0] || "").trim();
    if (!id) {
      return `Usage: ${command} <intent_id>`;
    }

    const approve = runCli(cliEntry, [
      "treasury",
      "approve",
      id,
      "--by",
      actor,
      "--note",
      "Approved via Telegram command",
    ]);
    const approveText = approve.stdout || approve.stderr || approve.error;
    const approveLooksTerminal =
      /already terminal|must be in pending_approval|not found/i.test(approveText);
    if (!approve.ok && !approveLooksTerminal) {
      return `Approve failed for ${id}:\n${approveText}`;
    }

    if (command === "/approve_only") {
      return `Approved ${id}.\n${approveText}`;
    }

    const execute = runCli(cliEntry, [
      "treasury",
      "execute",
      id,
      "--by",
      actor,
    ]);
    if (!execute.ok) {
      return `Approved ${id}, but execute failed:\n${execute.stderr || execute.stdout || execute.error}`;
    }
    return `Approved and executed ${id}.\n${execute.stdout}`;
  }

  if (command === "/reject") {
    const id = (args[0] || "").trim();
    const reason = args.slice(1).join(" ").trim();
    if (!id || !reason) {
      return "Usage: /reject <intent_id> <reason>";
    }
    const reject = runCli(cliEntry, [
      "treasury",
      "reject",
      id,
      "--reason",
      reason,
      "--by",
      actor,
    ]);
    if (!reject.ok) {
      return `Reject failed for ${id}:\n${reject.stderr || reject.stdout || reject.error}`;
    }
    return reject.stdout || `Rejected ${id}.`;
  }

  return usage();
}

function isAuthorizedMessage(message, expectedChatId, expectedUsername) {
  const chatId = String(message?.chat?.id || "").trim();
  if (!chatId || chatId !== expectedChatId) {
    return false;
  }
  if (!expectedUsername) {
    return true;
  }
  const fromUsername = normalizeUsername(message?.from?.username || "");
  return fromUsername === expectedUsername;
}

async function processOnce({
  token,
  chatId,
  username,
  cliEntry,
  statePath,
  timeoutSec,
}) {
  const state = readState(statePath);
  const updates = await telegramCall(token, "getUpdates", {
    offset: state.offset > 0 ? state.offset : undefined,
    timeout: timeoutSec,
    allowed_updates: ["message", "edited_message"],
  });

  if (!Array.isArray(updates) || updates.length === 0) {
    return { processed: 0, offset: state.offset };
  }

  let processed = 0;
  let maxUpdateId = state.offset - 1;
  for (const update of updates) {
    const updateId = Number(update?.update_id);
    if (Number.isFinite(updateId) && updateId > maxUpdateId) {
      maxUpdateId = updateId;
    }

    const message = findMessage(update);
    if (!message || typeof message.text !== "string") continue;
    if (!isAuthorizedMessage(message, chatId, username)) continue;

    const parsed = parseCommand(message.text);
    if (!parsed) continue;

    const actorUsername = normalizeUsername(message?.from?.username || "");
    const actor = `telegram:${actorUsername || "unknown"}`;
    const responseText = await handleCommand({
      command: parsed.command,
      args: parsed.args,
      cliEntry,
      actor,
    });
    await sendTelegramMessage(token, chatId, responseText);
    processed += 1;
  }

  const nextOffset = Math.max(state.offset, maxUpdateId + 1);
  writeState(statePath, { offset: nextOffset });
  return { processed, offset: nextOffset };
}

async function main() {
  const envFilePath =
    process.env.AUTOMATON_ENV_FILE || path.resolve(process.cwd(), ".env.synthesis");
  loadEnvFileIfPresent(envFilePath);

  const token = (process.env.AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (process.env.AUTOMATON_TREASURY_TELEGRAM_CHAT_ID || "").trim();
  const username = normalizeUsername(
    process.env.AUTOMATON_TREASURY_TELEGRAM_USERNAME || "",
  );
  const cliEntry =
    process.env.AUTOMATON_CLI_ENTRY ||
    path.resolve(process.cwd(), "packages/cli/dist/index.js");
  const statePath = resolveHome(
    process.env.AUTOMATON_TREASURY_TELEGRAM_OFFSET_FILE ||
      "~/.automaton/treasury-telegram-offset.json",
  );
  const timeoutSec = Math.max(
    1,
    Math.min(
      50,
      Math.floor(
        readNumberEnv("AUTOMATON_TREASURY_TELEGRAM_COMMAND_POLL_TIMEOUT_SEC", 20),
      ),
    ),
  );
  const loop = process.argv.includes("--loop");

  if (!token || !chatId) {
    console.error(
      "Missing AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN or AUTOMATON_TREASURY_TELEGRAM_CHAT_ID.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(cliEntry)) {
    console.error(`CLI entry not found: ${cliEntry}`);
    process.exit(1);
  }

  if (!loop) {
    const result = await processOnce({
      token,
      chatId,
      username,
      cliEntry,
      statePath,
      timeoutSec,
    });
    console.log(
      `[telegram-command-worker] processed=${result.processed} offset=${result.offset}`,
    );
    return;
  }

  console.log(
    `[telegram-command-worker] listening chat=${chatId} username=@${username || "*"} timeoutSec=${timeoutSec}`,
  );
  while (true) {
    try {
      const result = await processOnce({
        token,
        chatId,
        username,
        cliEntry,
        statePath,
        timeoutSec,
      });
      if (result.processed > 0) {
        console.log(
          `[telegram-command-worker] processed=${result.processed} offset=${result.offset}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[telegram-command-worker] ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
