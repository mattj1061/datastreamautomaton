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

async function main() {
  const envFilePath =
    process.env.AUTOMATON_ENV_FILE || path.resolve(process.cwd(), ".env.synthesis");
  loadEnvFileIfPresent(envFilePath);

  const token = (process.env.AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (process.env.AUTOMATON_TREASURY_TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    console.error(
      "Missing AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN or AUTOMATON_TREASURY_TELEGRAM_CHAT_ID.",
    );
    process.exit(1);
  }

  const customMessage = process.argv.slice(2).join(" ").trim();
  const message =
    customMessage || `Automaton treasury alert test (${new Date().toISOString()})`;

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `Failed to send Telegram message (${response.status}): ${body.slice(0, 300)}`,
    );
    process.exit(1);
  }

  console.log("Telegram test message sent.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
