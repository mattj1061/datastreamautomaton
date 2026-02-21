#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

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
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
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

const ENV_FILE_PATH =
  process.env.AUTOMATON_ENV_FILE ||
  path.resolve(SCRIPT_DIR, "../.env.synthesis");
loadEnvFileIfPresent(ENV_FILE_PATH);

function resolveHome(inputPath) {
  if (!inputPath) return inputPath;
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const outboxDir = resolveHome(
  process.env.AUTOMATON_VULTISIG_OUTBOX_DIR || "~/.automaton/vultisig-outbox",
);
const processedDir = resolveHome(
  process.env.AUTOMATON_VULTISIG_PROCESSED_DIR ||
    path.join(outboxDir, "processed"),
);
const failedDir = resolveHome(
  process.env.AUTOMATON_VULTISIG_FAILED_DIR || path.join(outboxDir, "failed"),
);
const cliEntry =
  process.env.AUTOMATON_CLI_ENTRY ||
  path.resolve(SCRIPT_DIR, "../packages/cli/dist/index.js");
const workerActor = process.env.AUTOMATON_VULTISIG_WORKER_ACTOR || "vultisig-worker";
const signerCommand = process.env.AUTOMATON_VULTISIG_SIGNER_CMD || "";
const autoApprove = readBooleanEnv("AUTOMATON_VULTISIG_WORKER_AUTO_APPROVE", true);
const dryRun = readBooleanEnv("AUTOMATON_VULTISIG_WORKER_DRY_RUN", true);
const signerTimeoutMs = Math.max(
  5000,
  readNumberEnv("AUTOMATON_VULTISIG_SIGNER_TIMEOUT_MS", 120000),
);
const cliTimeoutMs = Math.max(
  5000,
  readNumberEnv("AUTOMATON_VULTISIG_CLI_TIMEOUT_MS", 30000),
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

function archiveFile(sourcePath, targetDir, prefix) {
  ensureDir(targetDir);
  const base = path.basename(sourcePath);
  const destination = path.join(targetDir, `${prefix}-${nowStamp()}-${base}`);
  fs.renameSync(sourcePath, destination);
  return destination;
}

function runCli(args) {
  const run = spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: "utf8",
    timeout: cliTimeoutMs,
  });
  return {
    ok: run.status === 0,
    status: run.status,
    stdout: (run.stdout || "").trim(),
    stderr: (run.stderr || "").trim(),
    error: run.error ? run.error.message : "",
  };
}

function readIntentEnvelope(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Envelope is not an object.");
    }
    const intent = parsed.intent;
    if (!intent || typeof intent !== "object" || typeof intent.id !== "string") {
      throw new Error("Envelope is missing intent.id.");
    }
    return {
      envelope: parsed,
      intentId: intent.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: message,
    };
  }
}

function parseSignerOutput(stdout) {
  const text = stdout.trim();
  if (!text) {
    return {
      ok: false,
      status: "failed",
      message: "Signer produced empty output.",
    };
  }

  try {
    const parsed = JSON.parse(text);
    const statusRaw =
      typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "executed";
    const status =
      statusRaw === "submitted" || statusRaw === "failed" ? statusRaw : "executed";
    let txRef =
      parsed.txRef ||
      parsed.txHash ||
      parsed.transactionRef ||
      parsed.reference ||
      "";
    if (
      (typeof txRef !== "string" || txRef.trim().length === 0) &&
      typeof parsed.rawOutput === "string"
    ) {
      const rawOutput = parsed.rawOutput.trim();
      const txHashMatch = rawOutput.match(/0x[a-fA-F0-9]{64}/);
      if (txHashMatch) {
        txRef = txHashMatch[0];
      } else if (rawOutput.length > 0) {
        txRef = rawOutput;
      }
    }
    const message =
      typeof parsed.message === "string" && parsed.message.trim().length > 0
        ? parsed.message.trim()
        : `Signer returned ${status}.`;
    const ok = parsed.ok === false ? false : status !== "failed";
    return {
      ok,
      status,
      txRef: typeof txRef === "string" ? txRef : "",
      message,
    };
  } catch {
    if (/^0x[a-fA-F0-9]{64}$/.test(text)) {
      return {
        ok: true,
        status: "executed",
        txRef: text,
        message: "Signer returned a transaction hash.",
      };
    }
    return {
      ok: true,
      status: "submitted",
      txRef: text,
      message: "Signer output accepted as transfer reference.",
    };
  }
}

function runSigner(filePath) {
  if (!signerCommand.trim()) {
    return {
      ok: false,
      status: "failed",
      message:
        "AUTOMATON_VULTISIG_SIGNER_CMD is empty. Provide a signer command that accepts the outbox file path and outputs JSON.",
    };
  }

  const shellCommand = `${signerCommand} ${shellQuote(filePath)}`;
  const run = spawnSync("bash", ["-lc", shellCommand], {
    encoding: "utf8",
    timeout: signerTimeoutMs,
  });

  if (run.error) {
    return {
      ok: false,
      status: "failed",
      message: run.error.message,
    };
  }

  if (run.status !== 0) {
    const stderr = (run.stderr || "").trim();
    const stdout = (run.stdout || "").trim();
    return {
      ok: false,
      status: "failed",
      message: `Signer command failed (${run.status}): ${stderr || stdout || "no output"}`,
    };
  }

  return parseSignerOutput((run.stdout || "").trim());
}

function getIntentStatus(intentId) {
  const show = runCli(["treasury", "show", intentId]);
  if (!show.ok) {
    return {
      ok: false,
      status: null,
      message: show.stderr || show.stdout || show.error || "treasury show failed",
    };
  }

  try {
    const parsed = JSON.parse(show.stdout);
    return {
      ok: true,
      status: parsed.status || null,
      message: "",
    };
  } catch {
    return {
      ok: false,
      status: null,
      message: "Unable to parse treasury show JSON output.",
    };
  }
}

function handleIntent(filePath) {
  const parsed = readIntentEnvelope(filePath);
  if (parsed.error) {
    return {
      ok: false,
      message: parsed.error,
    };
  }

  const { intentId } = parsed;
  console.log(`\n[worker] processing intent ${intentId} from ${filePath}`);

  const statusResult = getIntentStatus(intentId);
  if (!statusResult.ok) {
    return {
      ok: false,
      message: `Cannot inspect intent status: ${statusResult.message}`,
    };
  }

  const currentStatus = statusResult.status;
  if (currentStatus === "executed" || currentStatus === "failed" || currentStatus === "rejected") {
    return {
      ok: true,
      message: `Intent already terminal (${currentStatus}); archiving outbox file.`,
    };
  }

  if (currentStatus === "pending_approval") {
    if (!autoApprove) {
      return {
        ok: false,
        message:
          "Intent is pending approval and AUTOMATON_VULTISIG_WORKER_AUTO_APPROVE=false.",
      };
    }

    const approve = runCli([
      "treasury",
      "approve",
      intentId,
      "--by",
      workerActor,
      "--note",
      "approved by vultisig worker",
    ]);
    if (!approve.ok) {
      return {
        ok: false,
        message: `Failed to approve intent: ${approve.stderr || approve.stdout || approve.error}`,
      };
    }
  }

  if (dryRun) {
    return {
      ok: true,
      message: "Dry-run mode enabled; skipping signer and status update.",
      archive: false,
    };
  }

  const signer = runSigner(filePath);
  if (!signer.ok || signer.status === "failed") {
    const reason = signer.message || "Signer returned failure";
    const failArgs = ["treasury", "fail", intentId, "--reason", reason, "--by", workerActor];
    if (signer.txRef) {
      failArgs.push("--tx", signer.txRef);
    }
    const fail = runCli(failArgs);
    if (!fail.ok) {
      return {
        ok: false,
        message: `Signer failed and treasury fail command also failed: ${fail.stderr || fail.stdout || fail.error}`,
      };
    }
    return {
      ok: true,
      message: `Marked intent as failed: ${reason}`,
    };
  }

  const status = signer.status === "submitted" ? "submitted" : "executed";
  const txRef = signer.txRef || `worker-ref-${intentId}`;
  const confirm = runCli([
    "treasury",
    "confirm",
    intentId,
    "--status",
    status,
    "--tx",
    txRef,
    "--message",
    signer.message || `Signer returned ${status}.`,
    "--by",
    workerActor,
  ]);
  if (!confirm.ok) {
    return {
      ok: false,
      message: `Confirm command failed: ${confirm.stderr || confirm.stdout || confirm.error}`,
    };
  }

  return {
    ok: true,
    message: `Intent ${intentId} confirmed as ${status} (${txRef}).`,
  };
}

function main() {
  if (!fs.existsSync(cliEntry)) {
    console.error(`[worker] CLI entry not found: ${cliEntry}`);
    process.exit(1);
  }

  if (!fs.existsSync(outboxDir)) {
    ensureDir(outboxDir);
    console.log(
      `[worker] outbox directory initialized: ${outboxDir} (no queued intents yet)`,
    );
    process.exit(0);
  }

  const files = fs
    .readdirSync(outboxDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(outboxDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log("[worker] no queued outbox intents.");
    process.exit(0);
  }

  console.log(
    `[worker] ${files.length} outbox file(s). dryRun=${dryRun} autoApprove=${autoApprove} signerConfigured=${Boolean(
      signerCommand.trim(),
    )}`,
  );

  let failures = 0;
  for (const filePath of files) {
    const result = handleIntent(filePath);
    if (result.ok) {
      console.log(`[worker] ok: ${result.message}`);
      if (result.archive === false) {
        continue;
      }

      const archivedPath = archiveFile(filePath, processedDir, "processed");
      console.log(`[worker] archived -> ${archivedPath}`);
      continue;
    }

    failures += 1;
    const archivedPath = archiveFile(filePath, failedDir, "failed");
    console.error(`[worker] failed: ${result.message}`);
    console.error(`[worker] archived -> ${archivedPath}`);
  }

  if (failures > 0) {
    process.exit(2);
  }
}

main();
