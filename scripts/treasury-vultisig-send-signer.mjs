#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function readBooleanEnv(name, fallback) {
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

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readIntegerEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function findFirstByKeys(root, keys) {
  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findFirstByKeys(entry, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (!isRecord(root)) {
    return undefined;
  }

  for (const [key, value] of Object.entries(root)) {
    if (keys.has(key)) return value;
    const found = findFirstByKeys(value, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function formatRatio(numerator, denominator, maxFractionDigits = 18) {
  if (denominator <= 0n) return "0";
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder === 0n) {
    return whole.toString();
  }

  let fraction = "";
  for (let i = 0; i < maxFractionDigits && remainder > 0n; i += 1) {
    remainder *= 10n;
    const digit = remainder / denominator;
    fraction += digit.toString();
    remainder %= denominator;
  }
  fraction = fraction.replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
}

function emitResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function failResult(message, extras = {}) {
  return {
    ok: false,
    status: "failed",
    message,
    ...extras,
  };
}

function successResult(status, txRef, message, extras = {}) {
  return {
    ok: status !== "failed",
    status,
    txRef,
    message,
    ...extras,
  };
}

function readIntentEnvelope(filePath) {
  if (!filePath) {
    throw new Error("Usage: treasury-vultisig-send-signer.mjs <outbox-file>");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Outbox file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.intent)) {
    throw new Error("Invalid outbox format: missing intent object.");
  }

  const intent = parsed.intent;
  const id = typeof intent.id === "string" ? intent.id : "";
  const toAddress = typeof intent.toAddress === "string" ? intent.toAddress : "";
  const amountCents = Number(intent.amountCents);

  if (!id) {
    throw new Error("Invalid outbox format: intent.id missing.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
    throw new Error("Invalid outbox format: intent.toAddress is not a valid EVM address.");
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Invalid outbox format: intent.amountCents must be a positive number.");
  }

  return {
    intent,
    intentId: id,
    toAddress,
    amountCents,
  };
}

function discoverNode22Path() {
  const explicit = process.env.AUTOMATON_VULTISIG_NODE22_PATH;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const timeoutMs = Math.max(
    5000,
    readNumberEnv("AUTOMATON_VULTISIG_NODE22_DISCOVERY_TIMEOUT_MS", 45_000),
  );
  const discovery = spawnSync(
    "npx",
    ["-y", "node@22", "-e", "process.stdout.write(process.execPath)"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: timeoutMs,
    },
  );
  if (discovery.error) {
    throw new Error(`Unable to discover node@22 path: ${discovery.error.message}`);
  }
  if (discovery.status !== 0) {
    throw new Error(
      `Unable to discover node@22 path (status=${discovery.status}): ${
        (discovery.stderr || discovery.stdout || "").trim() || "no output"
      }`,
    );
  }

  const nodePath = (discovery.stdout || "").trim();
  if (!nodePath || !fs.existsSync(nodePath)) {
    throw new Error(`node@22 path resolved but missing: ${nodePath || "(empty)"}`);
  }
  return nodePath;
}

function resolveCliEntryPath() {
  const explicit = process.env.AUTOMATON_VULTISIG_CLI_ENTRY;
  if (explicit && explicit.trim().length > 0 && fs.existsSync(explicit.trim())) {
    return explicit.trim();
  }

  const local = path.join(REPO_ROOT, "node_modules", "@vultisig", "cli", "dist", "index.js");
  if (fs.existsSync(local)) {
    return local;
  }

  const autoInstall = readBooleanEnv("AUTOMATON_VULTISIG_AUTO_INSTALL_CLI", true);
  if (!autoInstall) {
    throw new Error(
      `@vultisig/cli not found at ${local}. Install it first, or set AUTOMATON_VULTISIG_CLI_ENTRY.`,
    );
  }

  const version = process.env.AUTOMATON_VULTISIG_CLI_VERSION || "0.5.0";
  const timeoutMs = Math.max(
    10_000,
    readNumberEnv("AUTOMATON_VULTISIG_CLI_INSTALL_TIMEOUT_MS", 180_000),
  );

  const install = spawnSync(
    "npm",
    ["install", "--no-save", "--no-package-lock", `@vultisig/cli@${version}`],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: timeoutMs,
    },
  );
  if (install.error) {
    throw new Error(`Failed to install @vultisig/cli: ${install.error.message}`);
  }
  if (install.status !== 0) {
    throw new Error(
      `Failed to install @vultisig/cli@${version} (status=${install.status}): ${
        (install.stderr || install.stdout || "").trim() || "no output"
      }`,
    );
  }

  if (!fs.existsSync(local)) {
    throw new Error(`@vultisig/cli installation finished but binary missing at ${local}.`);
  }
  return local;
}

function buildSendCommand(intentRecord) {
  const chain = (process.env.AUTOMATON_VULTISIG_SEND_CHAIN || "base").trim();
  const token = (process.env.AUTOMATON_VULTISIG_SEND_TOKEN || "").trim();
  const memoRaw = process.env.AUTOMATON_VULTISIG_SEND_MEMO || "";
  const memo = memoRaw.includes("{intent_id}")
    ? memoRaw.replaceAll("{intent_id}", intentRecord.intentId)
    : memoRaw;
  const vault = (process.env.AUTOMATON_VULTISIG_VAULT || "").trim();
  const password = process.env.AUTOMATON_VULTISIG_PASSWORD || "";

  const baseDivisor = BigInt(
    Math.max(
      1,
      Math.floor(readNumberEnv("AUTOMATON_VULTISIG_SEND_AMOUNT_DIVISOR", 100)),
    ),
  );
  const tokenDecimals = readIntegerEnv("AUTOMATON_VULTISIG_SEND_TOKEN_DECIMALS");
  const cliTokenDecimals = Math.max(
    0,
    Math.floor(readNumberEnv("AUTOMATON_VULTISIG_SEND_CLI_TOKEN_DECIMALS", 18)),
  );

  let effectiveDivisor = baseDivisor;
  if (token && typeof tokenDecimals === "number" && Number.isFinite(tokenDecimals)) {
    if (cliTokenDecimals > tokenDecimals) {
      effectiveDivisor *= 10n ** BigInt(cliTokenDecimals - tokenDecimals);
    } else if (tokenDecimals > cliTokenDecimals) {
      effectiveDivisor = effectiveDivisor / (10n ** BigInt(tokenDecimals - cliTokenDecimals));
      if (effectiveDivisor < 1n) {
        effectiveDivisor = 1n;
      }
    }
  }

  const amount = formatRatio(
    BigInt(Math.floor(intentRecord.amountCents)),
    effectiveDivisor,
    Math.max(8, cliTokenDecimals),
  );

  const args = ["--silent", "-o", "json"];
  if (vault) {
    args.push("--vault", vault);
  }

  args.push("send", chain, intentRecord.toAddress, amount, "--yes");
  if (token) {
    args.push("--token", token);
  }
  if (memo && memo.trim().length > 0) {
    args.push("--memo", memo.trim());
  }
  if (password && password.length > 0) {
    args.push("--password", password);
  }

  return {
    args,
    chain,
    token: token || undefined,
    amount,
  };
}

function runSend(node22Path, cliEntry, sendCommand) {
  const timeoutMs = Math.max(
    10_000,
    readNumberEnv("AUTOMATON_VULTISIG_SEND_TIMEOUT_MS", 120_000),
  );
  const run = spawnSync(node22Path, [cliEntry, ...sendCommand.args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
  });

  if (run.error) {
    return failResult(`Failed running Vultisig CLI: ${run.error.message}`);
  }

  const stdout = (run.stdout || "").trim();
  const stderr = (run.stderr || "").trim();
  if (!stdout) {
    return failResult(
      `Vultisig CLI returned empty output (status=${run.status ?? "unknown"}).`,
      { stderr },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    if (run.status === 0) {
      return successResult(
        "submitted",
        undefined,
        "Vultisig CLI output is not JSON; treating output as reference.",
        { rawOutput: stdout, stderr },
      );
    }
    return failResult(
      `Vultisig CLI returned non-JSON output with failure status: ${stdout.slice(0, 300)}`,
      { stderr },
    );
  }

  const isSuccess = parsed?.success === true;
  const message =
    (isRecord(parsed?.error) && typeof parsed.error.message === "string"
      ? parsed.error.message
      : undefined) ||
    (typeof parsed?.message === "string" ? parsed.message : undefined) ||
    (isSuccess ? "Send command succeeded." : "Send command failed.");

  if (!isSuccess || run.status !== 0) {
    return failResult(message, {
      cliStatus: run.status,
      stderr,
      data: parsed?.data,
    });
  }

  const txRefRaw = findFirstByKeys(parsed, new Set([
    "txHash",
    "transactionHash",
    "hash",
    "txid",
    "transactionId",
    "reference",
  ]));
  const txRef =
    typeof txRefRaw === "string" && txRefRaw.trim().length > 0
      ? txRefRaw.trim()
      : undefined;

  return successResult(
    "executed",
    txRef,
    message,
    {
      data: parsed?.data,
      stderr,
    },
  );
}

async function main() {
  const outboxFile = process.argv[2];

  try {
    const intentRecord = readIntentEnvelope(outboxFile);
    const node22Path = discoverNode22Path();
    const cliEntry = resolveCliEntryPath();
    const sendCommand = buildSendCommand(intentRecord);
    const run = runSend(node22Path, cliEntry, sendCommand);

    emitResult({
      ...run,
      intentId: intentRecord.intentId,
      destination: intentRecord.toAddress,
      amountCents: intentRecord.amountCents,
      chain: sendCommand.chain,
      token: sendCommand.token,
      amount: sendCommand.amount,
    });
    process.exit(0);
  } catch (error) {
    emitResult(
      failResult(
        error instanceof Error ? error.message : String(error),
      ),
    );
    process.exit(0);
  }
}

main();
