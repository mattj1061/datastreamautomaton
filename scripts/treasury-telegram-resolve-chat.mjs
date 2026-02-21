#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function upsertEnvVar(envFilePath, key, value) {
  const nextLine = `${key}=${value}`;
  if (!fs.existsSync(envFilePath)) {
    fs.writeFileSync(envFilePath, `${nextLine}\n`, "utf8");
    return;
  }

  const lines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });
  if (!replaced) {
    next.push(nextLine);
  }
  const normalized = next.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(envFilePath, normalized, "utf8");
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node scripts/treasury-telegram-resolve-chat.mjs [@username] [--write-env] [--send-test] [--latest-private]",
  );
  console.log("");
  console.log("Reads token from AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN.");
}

function findMessage(update) {
  if (update?.message) return update.message;
  if (update?.edited_message) return update.edited_message;
  if (update?.channel_post) return update.channel_post;
  return null;
}

async function sendTestMessage(botToken, chatId, username) {
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `Automaton treasury alerts configured for @${username}.`,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to send Telegram test message (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

async function main() {
  const envFilePath =
    process.env.AUTOMATON_ENV_FILE || path.resolve(process.cwd(), ".env.synthesis");
  loadEnvFileIfPresent(envFilePath);

  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  const writeEnv = args.includes("--write-env");
  const sendTest = args.includes("--send-test");
  const latestPrivate = args.includes("--latest-private");
  const usernameArg = args.find((arg) => !arg.startsWith("--"));
  const username = normalizeUsername(
    usernameArg || process.env.AUTOMATON_TREASURY_TELEGRAM_USERNAME || "",
  );
  const token = (process.env.AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN || "").trim();

  if (!token) {
    console.error("Missing AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN.");
    process.exit(1);
  }
  if (!username) {
    console.error("Missing Telegram username. Provide @username argument or set AUTOMATON_TREASURY_TELEGRAM_USERNAME.");
    process.exit(1);
  }

  const updatesEndpoint = `https://api.telegram.org/bot${token}/getUpdates`;
  const updatesResponse = await fetch(updatesEndpoint);
  if (!updatesResponse.ok) {
    const body = await updatesResponse.text();
    console.error(`getUpdates failed (${updatesResponse.status}): ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const payload = await updatesResponse.json();
  if (!payload?.ok || !Array.isArray(payload.result)) {
    console.error("Unexpected getUpdates response.");
    process.exit(1);
  }

  let matchedUpdate = [...payload.result].reverse().find((update) => {
    const message = findMessage(update);
    const fromUsername = normalizeUsername(message?.from?.username || "");
    const chatUsername = normalizeUsername(message?.chat?.username || "");
    return fromUsername === username || chatUsername === username;
  });

  if (!matchedUpdate && latestPrivate) {
    matchedUpdate = [...payload.result]
      .reverse()
      .find((update) => findMessage(update)?.chat?.type === "private");
  }

  if (!matchedUpdate) {
    const recent = [...payload.result]
      .reverse()
      .map((update) => {
        const message = findMessage(update);
        if (!message) return null;
        return {
          chatType: message.chat?.type || "unknown",
          chatId: String(message.chat?.id || ""),
          fromUsername: message.from?.username || "",
          chatUsername: message.chat?.username || "",
          text:
            typeof message.text === "string"
              ? message.text.slice(0, 40)
              : "",
        };
      })
      .filter(Boolean)
      .slice(0, 5);

    console.error(
      `No updates found for @${username}. Start a chat with your bot and send a message, then rerun this command.`,
    );
    if (recent.length > 0) {
      console.error("Recent updates:");
      for (const entry of recent) {
        console.error(
          `- type=${entry.chatType} chatId=${entry.chatId} from=@${entry.fromUsername || "-"} chat=@${entry.chatUsername || "-"} text=\"${entry.text}\"`,
        );
      }
      console.error(
        "If this is your DM, rerun with --latest-private to force-select the most recent private chat.",
      );
    }
    process.exit(2);
  }

  const message = findMessage(matchedUpdate);
  const chatId = String(message?.chat?.id || "").trim();
  if (!chatId) {
    console.error("Matched update did not include a chat ID.");
    process.exit(1);
  }

  if (writeEnv) {
    upsertEnvVar(envFilePath, "AUTOMATON_TREASURY_TELEGRAM_CHAT_ID", chatId);
    upsertEnvVar(envFilePath, "AUTOMATON_TREASURY_TELEGRAM_USERNAME", `@${username}`);
    console.log(`Saved AUTOMATON_TREASURY_TELEGRAM_CHAT_ID=${chatId} to ${envFilePath}`);
  }

  if (sendTest) {
    await sendTestMessage(token, chatId, username);
    console.log("Sent Telegram test message.");
  }

  console.log(`Resolved @${username} -> chat_id ${chatId}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
