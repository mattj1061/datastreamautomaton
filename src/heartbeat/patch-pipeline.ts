import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { AutomatonDatabase } from "../types.js";

interface ProductPatchPipelineConfig {
  enabled: boolean;
  repoPath: string;
  queueDir: string;
  appliedDir: string;
  failedDir: string;
  pipelineScript: string;
  timeoutMs: number;
  autoCommit: boolean;
}

export interface PatchQueueResult {
  executed: boolean;
  success: boolean;
  message: string;
  patchFile?: string;
  appliedPath?: string;
  failedPath?: string;
}

function readBooleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPipelineConfig(): ProductPatchPipelineConfig {
  const repoPath =
    process.env.AUTOMATON_PRODUCT_REPO_PATH || "/root/new-project-service";
  const queueDir =
    process.env.AUTOMATON_PRODUCT_PATCH_QUEUE_DIR ||
    path.join(repoPath, "infra/automaton/patch-queue/incoming");
  const appliedDir =
    process.env.AUTOMATON_PRODUCT_PATCH_APPLIED_DIR ||
    path.join(repoPath, "infra/automaton/patch-queue/applied");
  const failedDir =
    process.env.AUTOMATON_PRODUCT_PATCH_FAILED_DIR ||
    path.join(repoPath, "infra/automaton/patch-queue/failed");
  const pipelineScript =
    process.env.AUTOMATON_PRODUCT_PIPELINE_SCRIPT ||
    path.join(repoPath, "scripts/autonomy-patch-pipeline.sh");

  return {
    enabled: readBooleanEnv("AUTOMATON_AUTONOMY_PIPELINE_ENABLED", false),
    repoPath,
    queueDir,
    appliedDir,
    failedDir,
    pipelineScript,
    timeoutMs: Math.max(30_000, readNumberEnv("AUTOMATON_PRODUCT_PATCH_TIMEOUT_MS", 20 * 60 * 1000)),
    autoCommit: readBooleanEnv("AUTOMATON_PRODUCT_PATCH_AUTO_COMMIT", true),
  };
}

function listPendingPatchFiles(queueDir: string): string[] {
  if (!fs.existsSync(queueDir)) return [];
  const entries = fs.readdirSync(queueDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".diff") || entry.name.endsWith(".patch")))
    .map((entry) => path.join(queueDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function archivePatchFile(
  sourcePath: string,
  targetDir: string,
  statusPrefix: "applied" | "failed",
): string {
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const base = path.basename(sourcePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(targetDir, `${statusPrefix}-${stamp}-${base}`);
  fs.renameSync(sourcePath, destination);
  return destination;
}

function writePatchKv(db: AutomatonDatabase, payload: Record<string, unknown>): void {
  db.setKV(
    "synthesis.patch_pipeline.last",
    JSON.stringify({
      ...payload,
      recordedAt: new Date().toISOString(),
    }),
  );
}

export function processProductPatchQueue(db: AutomatonDatabase): PatchQueueResult {
  const cfg = getPipelineConfig();
  if (!cfg.enabled) {
    return {
      executed: false,
      success: true,
      message: "Product patch pipeline disabled.",
    };
  }

  if (!fs.existsSync(cfg.repoPath)) {
    const message = `Product repo path not found: ${cfg.repoPath}`;
    writePatchKv(db, {
      ok: false,
      message,
      repoPath: cfg.repoPath,
    });
    return {
      executed: true,
      success: false,
      message,
    };
  }

  const pending = listPendingPatchFiles(cfg.queueDir);
  if (pending.length === 0) {
    return {
      executed: false,
      success: true,
      message: "No queued product patch files.",
    };
  }

  const patchFile = pending[0];
  if (!fs.existsSync(cfg.pipelineScript)) {
    const failedPath = archivePatchFile(patchFile, cfg.failedDir, "failed");
    const message = `Pipeline script not found: ${cfg.pipelineScript}`;
    writePatchKv(db, {
      ok: false,
      message,
      patchFile,
      failedPath,
      pipelineScript: cfg.pipelineScript,
    });
    return {
      executed: true,
      success: false,
      message,
      patchFile,
      failedPath,
    };
  }

  const run = spawnSync(cfg.pipelineScript, [patchFile], {
    cwd: cfg.repoPath,
    env: {
      ...process.env,
      AUTO_COMMIT: cfg.autoCommit ? "true" : "false",
    },
    encoding: "utf8",
    timeout: cfg.timeoutMs,
  });

  const stdout = (run.stdout || "").slice(-4000);
  const stderr = (run.stderr || "").slice(-4000);
  if (run.status === 0) {
    const appliedPath = archivePatchFile(patchFile, cfg.appliedDir, "applied");
    const message = `Applied product patch ${path.basename(patchFile)} via guarded pipeline.`;
    writePatchKv(db, {
      ok: true,
      message,
      patchFile,
      appliedPath,
      stdout,
      stderr,
    });
    return {
      executed: true,
      success: true,
      message,
      patchFile,
      appliedPath,
    };
  }

  const failedPath = archivePatchFile(patchFile, cfg.failedDir, "failed");
  const failureMessage =
    (run.error && run.error.message) ||
    `Guarded pipeline failed with status ${run.status ?? "unknown"}.`;
  writePatchKv(db, {
    ok: false,
    message: failureMessage,
    patchFile,
    failedPath,
    status: run.status,
    signal: run.signal,
    stdout,
    stderr,
  });

  return {
    executed: true,
    success: false,
    message: `Failed product patch ${path.basename(patchFile)}: ${failureMessage}`,
    patchFile,
    failedPath,
  };
}
