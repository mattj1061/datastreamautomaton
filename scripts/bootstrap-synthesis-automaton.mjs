#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AUTOMATON_HOME =
  process.env.AUTOMATON_HOME || path.join(os.homedir(), ".automaton");
const CONWAY_HOME =
  process.env.CONWAY_HOME || path.join(os.homedir(), ".conway");
const WALLET_PATH = path.join(AUTOMATON_HOME, "wallet.json");
const API_CONFIG_PATH = path.join(AUTOMATON_HOME, "config.json");
const AUTOMATON_CONFIG_PATH = path.join(AUTOMATON_HOME, "automaton.json");
const CONWAY_CONFIG_PATH = path.join(CONWAY_HOME, "config.json");

const DEFAULT_GENESIS_PROMPT = `You are the controller for a research-only data synthesis API business.
You must maintain service reliability, pricing quality, and safe expansion.

Hard rules:
1. Never disable billing gates.
2. Never disable audit/event logging.
3. Never touch secret/key files.
4. Do not perform order routing or trade execution.

Primary loop:
- Monitor pipeline freshness, profitability, customer demand, and source quality.
- Trigger synthesis/pricing/expansion actions through internal API endpoints.
- Favor reversible, tested changes and keep an audit trail.`;

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeAddress(input, label) {
  if (typeof input !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(input)) {
    throw new Error(`${label} must be a 0x-prefixed 40-hex Ethereum address`);
  }
  return input;
}

function normalizeSandboxId(input) {
  if (typeof input !== "string" || !/^[a-f0-9]{32}$/i.test(input)) {
    throw new Error("AUTOMATON_SANDBOX_ID must be a 32-char sandbox id");
  }
  return input;
}

const wallet = readJson(WALLET_PATH, "wallet file");
const apiConfig = readJson(API_CONFIG_PATH, "API key config");
const conwayProfile = readJsonIfExists(CONWAY_CONFIG_PATH) || {};

const walletAddress = normalizeAddress(
  wallet?.address || apiConfig?.walletAddress || conwayProfile?.walletAddress,
  "wallet.address/apiConfig.walletAddress",
);
const creatorAddress = normalizeAddress(
  process.env.AUTOMATON_CREATOR_ADDRESS || walletAddress,
  "AUTOMATON_CREATOR_ADDRESS",
);
const sandboxId = normalizeSandboxId(
  process.env.AUTOMATON_SANDBOX_ID || "",
);
const conwayApiKey =
  process.env.AUTOMATON_CONWAY_API_KEY ||
  apiConfig.apiKey ||
  conwayProfile.apiKey;
if (typeof conwayApiKey !== "string" || conwayApiKey.length < 12) {
  throw new Error(
    "No Conway API key found. Set AUTOMATON_CONWAY_API_KEY or run --provision.",
  );
}

const config = {
  name: process.env.AUTOMATON_NAME || "Synthesis Controller",
  genesisPrompt:
    process.env.AUTOMATON_GENESIS_PROMPT || DEFAULT_GENESIS_PROMPT,
  creatorMessage:
    process.env.AUTOMATON_CREATOR_MESSAGE ||
    "Operate the synthesis service safely and profitably.",
  creatorAddress,
  registeredWithConway:
    (process.env.AUTOMATON_REGISTERED_WITH_CONWAY || "false") === "true",
  sandboxId,
  conwayApiUrl: process.env.CONWAY_API_URL || "https://api.conway.tech",
  conwayApiKey,
  inferenceModel: process.env.AUTOMATON_INFERENCE_MODEL || "gpt-4o",
  maxTokensPerTurn: Number(process.env.AUTOMATON_MAX_TOKENS || 4096),
  heartbeatConfigPath: "~/.automaton/heartbeat.yml",
  dbPath: "~/.automaton/state.db",
  logLevel: process.env.AUTOMATON_LOG_LEVEL || "info",
  walletAddress,
  version: "0.1.0",
  skillsDir: "~/.automaton/skills",
  maxChildren: Number(process.env.AUTOMATON_MAX_CHILDREN || 3),
  socialRelayUrl:
    process.env.AUTOMATON_SOCIAL_RELAY_URL || "https://social.conway.tech",
};

fs.mkdirSync(AUTOMATON_HOME, { recursive: true, mode: 0o700 });
fs.writeFileSync(AUTOMATON_CONFIG_PATH, JSON.stringify(config, null, 2), {
  mode: 0o600,
});

console.log(
  `[bootstrap-synthesis-automaton] wrote ${AUTOMATON_CONFIG_PATH} for sandbox ${sandboxId}`,
);
