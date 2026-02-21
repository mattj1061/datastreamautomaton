#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

const AUTOMATON_HOME =
  process.env.AUTOMATON_HOME || path.join(os.homedir(), ".automaton");
const HEARTBEAT_PATH =
  process.env.AUTOMATON_HEARTBEAT_PATH ||
  path.join(AUTOMATON_HOME, "heartbeat.yml");
const AUTOMATON_CONFIG_PATH = path.join(AUTOMATON_HOME, "automaton.json");

const INTEGRATION_ENTRIES = [
  {
    name: "check_pipeline_health",
    schedule: "*/5 * * * *",
    task: "check_pipeline_health",
    enabled: true,
  },
  {
    name: "check_profitability",
    schedule: "*/15 * * * *",
    task: "check_profitability",
    enabled: true,
  },
  {
    name: "check_customer_demand",
    schedule: "*/15 * * * *",
    task: "check_customer_demand",
    enabled: true,
  },
  {
    name: "check_source_quality",
    schedule: "*/10 * * * *",
    task: "check_source_quality",
    enabled: true,
  },
  {
    name: "evaluate_expansion",
    schedule: "0 * * * *",
    task: "evaluate_expansion",
    enabled: true,
  },
  {
    name: "process_service_patch_queue",
    schedule: "*/10 * * * *",
    task: "process_service_patch_queue",
    enabled: true,
  },
];

function parseYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  return YAML.parse(raw) || {};
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function upsertEntries(currentEntries, entriesToUpsert) {
  const current = Array.isArray(currentEntries) ? currentEntries : [];
  const byName = new Map();

  for (const entry of current) {
    if (!entry || typeof entry.name !== "string") continue;
    byName.set(entry.name, { ...entry });
  }

  for (const entry of entriesToUpsert) {
    const existing = byName.get(entry.name);
    byName.set(entry.name, {
      ...existing,
      ...entry,
      enabled: entry.enabled !== false,
    });
  }

  return Array.from(byName.values());
}

function writeHeartbeatConfig() {
  ensureDir(HEARTBEAT_PATH);
  const parsed = parseYamlFile(HEARTBEAT_PATH);

  const updated = {
    defaultIntervalMs: parsed.defaultIntervalMs || 60_000,
    lowComputeMultiplier: parsed.lowComputeMultiplier || 4,
    entries: upsertEntries(parsed.entries, INTEGRATION_ENTRIES),
  };

  fs.writeFileSync(HEARTBEAT_PATH, YAML.stringify(updated), {
    mode: 0o600,
  });

  console.log(`[configure-synthesis-controller] heartbeat updated: ${HEARTBEAT_PATH}`);
}

function writeEnvTemplate() {
  const target = path.join(process.cwd(), ".env.synthesis.example");
  const content = `# Enable synthesis service integration heartbeat tasks
AUTOMATON_SYNTHESIS_INTEGRATION_ENABLED=true

# Product service URL + internal admin token
AUTOMATON_PRODUCT_API_BASE_URL=http://127.0.0.1:3001
AUTOMATON_INTERNAL_TOKEN=dev-internal-token

# Wake thresholds
AUTOMATON_PIPELINE_FRESHNESS_MAX_MINUTES=20
AUTOMATON_MARGIN_MIN=0.20
AUTOMATON_RETENTION_MIN=0.20
AUTOMATON_SIGNAL_QUALITY_MIN=0.62
AUTOMATON_SIGNAL_QUALITY_DRIFT_MAX=0.08
AUTOMATON_DEMAND_CUSTOMER_DELTA_TRIGGER=1
AUTOMATON_DEMAND_REVENUE_GROWTH_TRIGGER=0.20
AUTOMATON_MIN_PAID_CUSTOMERS=1
AUTOMATON_NEXT_SOURCE_MONTHLY_COST=100
AUTOMATON_INTERNAL_REQUEST_TIMEOUT_MS=10000

# Treasury policy and execution controls
AUTOMATON_TREASURY_POLICY_ENABLED=true
AUTOMATON_TREASURY_REQUIRE_ALLOWLIST=true
AUTOMATON_TREASURY_ALLOWLIST=
AUTOMATON_TREASURY_MIN_RESERVE_CENTS=500
AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS=100
AUTOMATON_TREASURY_HARD_PER_TRANSFER_CENTS=5000
AUTOMATON_TREASURY_HARD_DAILY_LIMIT_CENTS=500
AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED=false
AUTOMATON_TREASURY_EXECUTION_BACKEND=vultisig
AUTOMATON_TREASURY_TELEGRAM_ALERTS_ENABLED=true
AUTOMATON_TREASURY_TELEGRAM_BOT_TOKEN=
AUTOMATON_TREASURY_TELEGRAM_CHAT_ID=
AUTOMATON_TREASURY_TELEGRAM_USERNAME=
AUTOMATON_TREASURY_TELEGRAM_OFFSET_FILE=~/.automaton/treasury-telegram-offset.json
AUTOMATON_TREASURY_TELEGRAM_COMMAND_POLL_TIMEOUT_SEC=20
AUTOMATON_TREASURY_TX_EXPLORER_TX_URL_TEMPLATE=https://basescan.org/tx/{tx}

# Vultisig broker scaffolding
AUTOMATON_VULTISIG_BROKER_MODE=outbox
AUTOMATON_VULTISIG_OUTBOX_DIR=~/.automaton/vultisig-outbox
AUTOMATON_VULTISIG_BROKER_URL=
AUTOMATON_VULTISIG_BROKER_TOKEN=
AUTOMATON_VULTISIG_BROKER_TIMEOUT_MS=10000
AUTOMATON_VULTISIG_VAULT_POLICY_PROFILE=secure
AUTOMATON_VULTISIG_PROCESSED_DIR=~/.automaton/vultisig-outbox/processed
AUTOMATON_VULTISIG_FAILED_DIR=~/.automaton/vultisig-outbox/failed
AUTOMATON_VULTISIG_WORKER_AUTO_APPROVE=true
AUTOMATON_VULTISIG_WORKER_DRY_RUN=true
AUTOMATON_VULTISIG_WORKER_ACTOR=vultisig-worker
AUTOMATON_VULTISIG_SIGNER_CMD=node scripts/treasury-vultisig-send-signer.mjs
AUTOMATON_VULTISIG_SIGNER_TIMEOUT_MS=120000
AUTOMATON_VULTISIG_CLI_TIMEOUT_MS=30000
AUTOMATON_VULTISIG_NODE22_PATH=
AUTOMATON_VULTISIG_NODE22_DISCOVERY_TIMEOUT_MS=45000
AUTOMATON_VULTISIG_CLI_ENTRY=
AUTOMATON_VULTISIG_AUTO_INSTALL_CLI=true
AUTOMATON_VULTISIG_CLI_VERSION=0.5.0
AUTOMATON_VULTISIG_CLI_INSTALL_TIMEOUT_MS=180000
AUTOMATON_VULTISIG_SEND_CHAIN=base
AUTOMATON_VULTISIG_SEND_TOKEN=
AUTOMATON_VULTISIG_SEND_AMOUNT_DIVISOR=100
AUTOMATON_VULTISIG_SEND_MEMO=automaton treasury intent {intent_id}
AUTOMATON_VULTISIG_SEND_TIMEOUT_MS=120000
AUTOMATON_VULTISIG_VAULT=
AUTOMATON_VULTISIG_PASSWORD=

# Product code-change pipeline (guarded patch apply)
AUTOMATON_AUTONOMY_PIPELINE_ENABLED=false
AUTOMATON_PRODUCT_REPO_PATH=/root/new-project-service
AUTOMATON_PRODUCT_PATCH_QUEUE_DIR=/root/new-project-service/infra/automaton/patch-queue/incoming
AUTOMATON_PRODUCT_PATCH_APPLIED_DIR=/root/new-project-service/infra/automaton/patch-queue/applied
AUTOMATON_PRODUCT_PATCH_FAILED_DIR=/root/new-project-service/infra/automaton/patch-queue/failed
AUTOMATON_PRODUCT_PIPELINE_SCRIPT=/root/new-project-service/scripts/autonomy-patch-pipeline.sh
AUTOMATON_PRODUCT_PATCH_TIMEOUT_MS=1200000
AUTOMATON_PRODUCT_PATCH_AUTO_COMMIT=true
`;

  fs.writeFileSync(target, content, "utf8");
  console.log(`[configure-synthesis-controller] env template written: ${target}`);
}

function patchAutomatonConfigHint() {
  if (!fs.existsSync(AUTOMATON_CONFIG_PATH)) {
    console.log(
      `[configure-synthesis-controller] automaton.json not found yet (${AUTOMATON_CONFIG_PATH}). Run automaton setup first.`,
    );
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(AUTOMATON_CONFIG_PATH, "utf8"));
    if (!parsed.heartbeatConfigPath) {
      parsed.heartbeatConfigPath = "~/.automaton/heartbeat.yml";
      fs.writeFileSync(
        AUTOMATON_CONFIG_PATH,
        JSON.stringify(parsed, null, 2),
        { mode: 0o600 },
      );
      console.log(
        `[configure-synthesis-controller] patched heartbeatConfigPath in ${AUTOMATON_CONFIG_PATH}`,
      );
    }
  } catch (err) {
    console.error(
      `[configure-synthesis-controller] failed to read ${AUTOMATON_CONFIG_PATH}: ${err.message}`,
    );
  }
}

writeHeartbeatConfig();
writeEnvTemplate();
patchAutomatonConfigHint();

console.log(
  "[configure-synthesis-controller] done. Start automaton with env from .env.synthesis.example (or your own .env.synthesis).",
);
