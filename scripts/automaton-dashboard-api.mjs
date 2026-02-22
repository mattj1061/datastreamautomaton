#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { loadConfig, resolvePath } from "../dist/config.js";
import { createConwayClient } from "../dist/conway/client.js";
import { createDatabase } from "../dist/state/database.js";
import {
  approveTransferIntent,
  getTransferIntentById,
  listTransferIntents,
  rejectTransferIntent,
  getExecutedSpendLast24hCents,
} from "../dist/treasury/intent-queue.js";
import { executeApprovedTransferIntent } from "../dist/treasury/executor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH =
  process.env.AUTOMATON_ENV_FILE || path.resolve(SCRIPT_DIR, "../.env.synthesis");
const TREASURY_SETTINGS_CONFIRMATION_PHRASE = "APPLY TREASURY SETTINGS";
const TREASURY_SETTINGS_EDITABLE_KEYS = [
  "AUTOMATON_TREASURY_REQUIRE_ALLOWLIST",
  "AUTOMATON_TREASURY_ALLOWLIST",
  "AUTOMATON_TREASURY_MIN_RESERVE_CENTS",
  "AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS",
  "AUTOMATON_TREASURY_HARD_PER_TRANSFER_CENTS",
  "AUTOMATON_TREASURY_HARD_DAILY_LIMIT_CENTS",
  "AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED",
];

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

loadEnvFileIfPresent(ENV_FILE_PATH);

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

function readStringEnv(name, fallback = "") {
  const raw = process.env[name];
  return typeof raw === "string" ? raw : fallback;
}

function isValidEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function parseAllowlistValues(input) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value || "").trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = String(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function normalizeInteger(value, options) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${options.label} must be a number.`);
  }
  const n = Math.floor(parsed);
  if (typeof options.min === "number" && n < options.min) {
    throw new Error(`${options.label} must be >= ${options.min}.`);
  }
  if (typeof options.max === "number" && n > options.max) {
    throw new Error(`${options.label} must be <= ${options.max}.`);
  }
  return n;
}

function readTreasurySettingsValues() {
  return {
    requireAllowlist: readBooleanEnv("AUTOMATON_TREASURY_REQUIRE_ALLOWLIST", true),
    allowlist: uniqueValues(
      parseAllowlistValues(readStringEnv("AUTOMATON_TREASURY_ALLOWLIST", "")),
    ),
    minReserveCents: Math.max(0, Math.floor(readNumberEnv("AUTOMATON_TREASURY_MIN_RESERVE_CENTS", 500))),
    autoApproveMaxCents: Math.max(
      0,
      Math.floor(readNumberEnv("AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS", 100)),
    ),
    hardPerTransferCents: Math.max(
      1,
      Math.floor(readNumberEnv("AUTOMATON_TREASURY_HARD_PER_TRANSFER_CENTS", 5000)),
    ),
    hardDailyLimitCents: Math.max(
      1,
      Math.floor(readNumberEnv("AUTOMATON_TREASURY_HARD_DAILY_LIMIT_CENTS", 10_000)),
    ),
    autoExecuteApproved: readBooleanEnv(
      "AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED",
      false,
    ),
  };
}

function buildTreasurySettingsResponseBody(extra = {}) {
  let fileStat = null;
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      const stat = fs.statSync(ENV_FILE_PATH);
      fileStat = {
        exists: true,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
      };
    } else {
      fileStat = { exists: false, sizeBytes: 0, mtime: null };
    }
  } catch {
    fileStat = { exists: false, sizeBytes: 0, mtime: null };
  }

  return {
    ok: true,
    settings: {
      envFilePath: ENV_FILE_PATH,
      editableKeys: TREASURY_SETTINGS_EDITABLE_KEYS,
      confirmationPhrase: TREASURY_SETTINGS_CONFIRMATION_PHRASE,
      file: fileStat,
      values: readTreasurySettingsValues(),
      notes: {
        localDashboardApiAppliedImmediately: true,
        restartOtherProcessesRecommended: true,
        restartTargets: [
          "automaton runtime process",
          "treasury worker process",
          "telegram command worker (if it reads treasury env behavior)",
        ],
      },
    },
    ...extra,
  };
}

function serializeEnvAssignmentValue(value) {
  if (typeof value !== "string") {
    value = String(value ?? "");
  }
  if (value === "") return "";
  if (/[#\s]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function writeEnvAssignments(envFilePath, assignments) {
  const existingRaw = fs.existsSync(envFilePath)
    ? fs.readFileSync(envFilePath, "utf8")
    : "";
  const hadTrailingNewline = existingRaw.endsWith("\n");
  const lines = existingRaw.length > 0 ? existingRaw.split(/\r?\n/) : [];
  const pending = new Map(
    Object.entries(assignments).map(([key, value]) => [
      key,
      `${key}=${serializeEnvAssignmentValue(value)}`,
    ]),
  );

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = line.indexOf("=");
    if (eq <= 0) return line;
    const key = line.slice(0, eq).trim();
    if (!pending.has(key)) return line;
    const replacement = pending.get(key);
    pending.delete(key);
    return replacement;
  });

  if (pending.size > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push("# Treasury policy settings updated from dashboard");
    for (const replacement of pending.values()) {
      nextLines.push(replacement);
    }
  }

  const output = nextLines.join("\n") + (hadTrailingNewline || nextLines.length > 0 ? "\n" : "");
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.writeFileSync(envFilePath, output, "utf8");
}

function coerceTreasurySettingsPayload(body) {
  const raw = body?.settings && typeof body.settings === "object" ? body.settings : body || {};

  const allowlist = uniqueValues(parseAllowlistValues(raw.allowlist ?? raw.allowlistText));
  const invalidAllowlist = allowlist.filter((value) => !isValidEvmAddress(value));
  if (invalidAllowlist.length > 0) {
    throw new Error(
      `Invalid allowlist address(es): ${invalidAllowlist.slice(0, 3).join(", ")}`,
    );
  }

  const values = {
    requireAllowlist:
      typeof raw.requireAllowlist === "boolean"
        ? raw.requireAllowlist
        : readBooleanEnv("AUTOMATON_TREASURY_REQUIRE_ALLOWLIST", true),
    allowlist,
    minReserveCents: normalizeInteger(raw.minReserveCents, {
      label: "Min reserve (cents)",
      min: 0,
      max: 100_000_000,
    }),
    autoApproveMaxCents: normalizeInteger(raw.autoApproveMaxCents, {
      label: "Auto-approve max (cents)",
      min: 0,
      max: 100_000_000,
    }),
    hardPerTransferCents: normalizeInteger(raw.hardPerTransferCents, {
      label: "Hard per-transfer cap (cents)",
      min: 1,
      max: 100_000_000,
    }),
    hardDailyLimitCents: normalizeInteger(raw.hardDailyLimitCents, {
      label: "Hard daily limit (cents)",
      min: 1,
      max: 100_000_000,
    }),
    autoExecuteApproved:
      typeof raw.autoExecuteApproved === "boolean"
        ? raw.autoExecuteApproved
        : readBooleanEnv("AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED", false),
  };

  if (values.autoApproveMaxCents > values.hardPerTransferCents) {
    throw new Error(
      "Auto-approve max must be <= hard per-transfer cap.",
    );
  }

  return values;
}

function handleGetTreasurySettings() {
  return {
    statusCode: 200,
    body: buildTreasurySettingsResponseBody(),
  };
}

function handleUpdateTreasurySettings(body) {
  const confirmationPhrase =
    typeof body?.confirmationPhrase === "string" ? body.confirmationPhrase.trim() : "";
  if (confirmationPhrase !== TREASURY_SETTINGS_CONFIRMATION_PHRASE) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        error: `Confirmation phrase mismatch. Enter exactly: ${TREASURY_SETTINGS_CONFIRMATION_PHRASE}`,
      },
    };
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return {
      statusCode: 400,
      body: { ok: false, error: "Change reason is required." },
    };
  }

  const actor =
    typeof body?.actor === "string" && body.actor.trim()
      ? body.actor.trim()
      : "dashboard-ui-human";

  try {
    const values = coerceTreasurySettingsPayload(body);
    const assignments = {
      AUTOMATON_TREASURY_REQUIRE_ALLOWLIST: values.requireAllowlist ? "true" : "false",
      AUTOMATON_TREASURY_ALLOWLIST: values.allowlist.join(","),
      AUTOMATON_TREASURY_MIN_RESERVE_CENTS: String(values.minReserveCents),
      AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS: String(values.autoApproveMaxCents),
      AUTOMATON_TREASURY_HARD_PER_TRANSFER_CENTS: String(values.hardPerTransferCents),
      AUTOMATON_TREASURY_HARD_DAILY_LIMIT_CENTS: String(values.hardDailyLimitCents),
      AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED: values.autoExecuteApproved ? "true" : "false",
    };

    writeEnvAssignments(ENV_FILE_PATH, assignments);
    for (const [key, value] of Object.entries(assignments)) {
      process.env[key] = value;
    }

    console.log(
      `[dashboard-api] treasury settings updated by ${actor}: ${reason}`,
    );

    return {
      statusCode: 200,
      body: buildTreasurySettingsResponseBody({
        updated: {
          actor,
          reason,
          at: new Date().toISOString(),
          changedKeys: Object.keys(assignments),
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin":
      process.env.AUTOMATON_DASHBOARD_API_ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function readExplorerTxUrlTemplate() {
  const raw = process.env.AUTOMATON_TREASURY_TX_EXPLORER_TX_URL_TEMPLATE || "";
  return raw.trim();
}

function buildTxUrl(txRef) {
  if (typeof txRef !== "string" || txRef.trim().length === 0) return null;
  const ref = txRef.trim();
  const template = readExplorerTxUrlTemplate();
  if (template.includes("{tx}")) {
    return template.replace("{tx}", encodeURIComponent(ref));
  }
  if (/^https?:\/\//i.test(ref)) {
    return ref;
  }
  return null;
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", (error) => reject(error));
  });
}

function summarizeTurn(turn) {
  return {
    id: turn.id,
    timestamp: turn.timestamp,
    state: turn.state,
    inputSource: turn.inputSource || null,
    thinkingPreview:
      typeof turn.thinking === "string" ? turn.thinking.slice(0, 180) : "",
    toolCalls: Array.isArray(turn.toolCalls)
      ? turn.toolCalls.map((tc) => ({
          name: tc.name,
          error: tc.error || null,
          durationMs: tc.durationMs || 0,
        }))
      : [],
    costCents: Number(turn.costCents || 0),
    tokenUsage: turn.tokenUsage || null,
  };
}

function summarizeTransaction(txn) {
  return {
    id: txn.id,
    type: txn.type,
    amountCents: txn.amountCents ?? null,
    balanceAfterCents: txn.balanceAfterCents ?? null,
    description: txn.description,
    timestamp: txn.timestamp,
  };
}

function summarizeHeartbeat(entry) {
  return {
    name: entry.name,
    task: entry.task,
    enabled: Boolean(entry.enabled),
    schedule: entry.schedule,
    lastRun: entry.lastRun || null,
    nextRun: entry.nextRun || null,
  };
}

function summarizeIntent(intent) {
  const txRef = intent.execution?.transactionRef || null;
  return {
    id: intent.id,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    source: intent.source,
    requestedBy: intent.requestedBy,
    toAddress: intent.toAddress,
    amountCents: intent.amountCents,
    reason: intent.reason || null,
    status: intent.status,
    policy: intent.policy || null,
    approvals: Array.isArray(intent.approvals) ? intent.approvals : [],
    rejection: intent.rejection || null,
    execution: intent.execution
      ? {
          backend: intent.execution.backend,
          transactionRef: txRef,
          transactionUrl: buildTxUrl(txRef),
          message: intent.execution.message || null,
          executedBy: intent.execution.executedBy,
          executedAt: intent.execution.executedAt,
        }
      : null,
  };
}

function countsByStatus(intents) {
  const counts = {
    pending_approval: 0,
    approved: 0,
    rejected: 0,
    submitted: 0,
    executed: 0,
    failed: 0,
  };
  for (const intent of intents) {
    if (intent && typeof intent.status === "string" && intent.status in counts) {
      counts[intent.status] += 1;
    }
  }
  return counts;
}

function buildSnapshot() {
  const started = performance.now();
  const config = loadConfig();
  if (!config) {
    return {
      ok: false,
      error: "No automaton configuration found (~/.automaton/automaton.json).",
      generatedAt: new Date().toISOString(),
    };
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);
  try {
    const heartbeats = db.getHeartbeatEntries();
    const turns = db.getRecentTurns(20);
    const txns = db.getRecentTransactions(20);
    const intents = listTransferIntents(db, { limit: 50 });
    const statusCounts = countsByStatus(intents);

    const lastTurn = turns[0] || null;
    const pendingApprovals = statusCounts.pending_approval;
    const failedIntents = statusCounts.failed;
    const enabledHeartbeats = heartbeats.filter((h) => h.enabled).length;

    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const heapUsedMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
    const heapTotalMb = Math.round(process.memoryUsage().heapTotal / (1024 * 1024));

    const roughHealth =
      failedIntents > 0
        ? "warning"
        : pendingApprovals > 0
          ? "attention"
          : "nominal";

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      snapshotMs: Math.round(performance.now() - started),
      config: {
        name: config.name,
        walletAddress: config.walletAddress,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        inferenceModel: config.inferenceModel,
        dbPath,
        version: config.version,
      },
      status: {
        agentState: db.getAgentState(),
        turnCount: db.getTurnCount(),
        installedToolsCount: db.getInstalledTools().length,
        heartbeatTotal: heartbeats.length,
        heartbeatEnabled: enabledHeartbeats,
        roughHealth,
        lastTurnAt: lastTurn?.timestamp || null,
      },
      heartbeats: heartbeats.map(summarizeHeartbeat),
      treasury: {
        counts: statusCounts,
        pendingApprovalCount: pendingApprovals,
        executedSpendLast24hCents: getExecutedSpendLast24hCents(db),
        txExplorerTxUrlTemplate: readExplorerTxUrlTemplate() || null,
        recentIntents: intents.slice(0, 20).map(summarizeIntent),
      },
      activity: {
        recentTurns: turns.map(summarizeTurn),
        recentTransactions: txns.map(summarizeTransaction),
      },
      telemetry: {
        serverUptimeSeconds: Math.round(process.uptime()),
        nodeRssMb: rssMb,
        nodeHeapUsedMb: heapUsedMb,
        nodeHeapTotalMb: heapTotalMb,
      },
    };
  } finally {
    db.close();
  }
}

function parseLimitParam(url, fallback = 50, max = 500) {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function parseStatusFilter(url) {
  const raw = (url.searchParams.get("status") || "").trim().toLowerCase();
  if (!raw || raw === "all") return undefined;
  const allowed = new Set([
    "pending_approval",
    "approved",
    "rejected",
    "submitted",
    "executed",
    "failed",
  ]);
  return allowed.has(raw) ? raw : undefined;
}

function parseTreasuryIntentsQuery(url) {
  return {
    status: parseStatusFilter(url),
    limit: parseLimitParam(url, 100, 1000),
    q: (url.searchParams.get("q") || "").trim().toLowerCase(),
  };
}

function handleListTreasuryIntents(url) {
  const config = loadConfig();
  if (!config) {
    return { statusCode: 500, body: { ok: false, error: "No automaton configuration found." } };
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const { status, limit, q } = parseTreasuryIntentsQuery(url);
    let intents = listTransferIntents(db, {
      status,
      limit: Math.max(limit * 2, limit),
    });
    if (q) {
      intents = intents.filter((intent) => {
        const hay = [
          intent.id,
          intent.toAddress,
          intent.reason || "",
          intent.status,
          intent.execution?.transactionRef || "",
          intent.execution?.message || "",
          intent.rejection?.reason || "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    intents = intents.slice(0, limit);
    return {
      statusCode: 200,
      body: {
        ok: true,
        filters: { status: status || "all", limit, q: q || "" },
        counts: countsByStatus(listTransferIntents(db, { limit: 1000 })),
        intents: intents.map(summarizeIntent),
      },
    };
  } finally {
    db.close();
  }
}

function createConwayClientForExecution(config) {
  return createConwayClient({
    apiUrl: config.conwayApiUrl,
    apiKey: config.conwayApiKey || "",
    sandboxId: config.sandboxId,
  });
}

function applyChildFundingIfNeeded(db, previousStatus, intent) {
  if (!intent?.childId) return;
  if (previousStatus === "executed") return;
  if (intent.status !== "executed") return;
  const child = db.getChildById(intent.childId);
  if (!child) return;
  db.updateChildFunding(
    child.id,
    Math.max(0, Number(child.fundedAmountCents || 0) + Number(intent.amountCents || 0)),
  );
}

async function handleApproveIntent(id, body) {
  const config = loadConfig();
  if (!config) {
    return { statusCode: 500, body: { ok: false, error: "No automaton configuration found." } };
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const actor =
      typeof body?.actor === "string" && body.actor.trim()
        ? body.actor.trim()
        : "dashboard-ui";
    const note =
      typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
    const shouldExecute = Boolean(body?.execute);

    const approved = approveTransferIntent(db, id, actor, note);
    if (!approved) {
      return {
        statusCode: 404,
        body: { ok: false, error: `Transfer intent ${id} not found.` },
      };
    }

    let updated = approved;
    if (shouldExecute) {
      const previousStatus = approved.status;
      const conway = createConwayClientForExecution(config);
      updated = await executeApprovedTransferIntent(db, conway, id, {
        executedBy: actor,
      });
      applyChildFundingIfNeeded(db, previousStatus, updated);
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        intent: summarizeIntent(updated),
        snapshot: buildSnapshot(),
      },
    };
  } catch (error) {
    const intent = getTransferIntentById(db, id);
    return {
      statusCode: 500,
      body: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        intent: intent ? summarizeIntent(intent) : null,
      },
    };
  } finally {
    db.close();
  }
}

async function handleRejectIntent(id, body) {
  const config = loadConfig();
  if (!config) {
    return { statusCode: 500, body: { ok: false, error: "No automaton configuration found." } };
  }

  const reason =
    typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "";
  if (!reason) {
    return { statusCode: 400, body: { ok: false, error: "Reject requires a reason." } };
  }

  const actor =
    typeof body?.actor === "string" && body.actor.trim()
      ? body.actor.trim()
      : "dashboard-ui";

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const rejected = rejectTransferIntent(db, id, {
      rejectedBy: actor,
      reason,
      at: new Date().toISOString(),
    });
    if (!rejected) {
      return {
        statusCode: 404,
        body: { ok: false, error: `Transfer intent ${id} not found.` },
      };
    }
    return {
      statusCode: 200,
      body: {
        ok: true,
        intent: summarizeIntent(rejected),
        snapshot: buildSnapshot(),
      },
    };
  } finally {
    db.close();
  }
}

function startServer() {
  const port = Math.max(1, Math.min(65535, readNumberEnv("AUTOMATON_DASHBOARD_API_PORT", 8787)));
  const host = process.env.AUTOMATON_DASHBOARD_API_HOST || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      if (req.method === "OPTIONS") {
        jsonResponse(res, 204, {});
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        jsonResponse(res, 200, { ok: true, now: new Date().toISOString() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        jsonResponse(res, 200, buildSnapshot());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/treasury/intents") {
        const result = handleListTreasuryIntents(url);
        jsonResponse(res, result.statusCode, result.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/treasury/settings") {
        const result = handleGetTreasurySettings();
        jsonResponse(res, result.statusCode, result.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/treasury/settings") {
        const body = await readJsonBody(req);
        const result = handleUpdateTreasurySettings(body);
        jsonResponse(res, result.statusCode, result.body);
        return;
      }

      const actionMatch = url.pathname.match(
        /^\/api\/treasury\/intents\/([^/]+)\/(approve|reject)$/,
      );
      if (req.method === "POST" && actionMatch) {
        const [, encodedId, action] = actionMatch;
        const id = decodeURIComponent(encodedId);
        const body = await readJsonBody(req);
        const result =
          action === "approve"
            ? await handleApproveIntent(id, body)
            : await handleRejectIntent(id, body);
        jsonResponse(res, result.statusCode, result.body);
        return;
      }

      jsonResponse(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      jsonResponse(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        generatedAt: new Date().toISOString(),
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`[dashboard-api] listening on http://${host}:${port}`);
  });
}

startServer();
