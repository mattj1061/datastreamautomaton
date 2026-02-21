import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolContext } from "../types.js";
import { createBuiltinTools, executeTool } from "../agent/tools.js";
import { executeApprovedTransferIntent } from "../treasury/executor.js";
import {
  getTransferIntentById,
  listTransferIntents,
} from "../treasury/intent-queue.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";
import type { AutomatonDatabase } from "../types.js";

describe("Treasury intent + policy flow", () => {
  let db: AutomatonDatabase;
  let conway: MockConwayClient;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
    setEnv("AUTOMATON_TREASURY_TELEGRAM_ALERTS_ENABLED", "false");
  });

  afterEach(() => {
    db.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (const key of Object.keys(originalEnv)) {
      delete originalEnv[key];
    }
  });

  function setEnv(name: string, value: string): void {
    if (!(name in originalEnv)) {
      originalEnv[name] = process.env[name];
    }
    process.env[name] = value;
  }

  function context(): ToolContext {
    return {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
  }

  it("queues pending approval intent when recipient is not allowlisted", async () => {
    setEnv("AUTOMATON_TREASURY_POLICY_ENABLED", "true");
    setEnv("AUTOMATON_TREASURY_REQUIRE_ALLOWLIST", "true");
    setEnv("AUTOMATON_TREASURY_ALLOWLIST", "");
    setEnv("AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED", "false");

    const tools = createBuiltinTools("test-sandbox");
    const result = await executeTool(
      "transfer_credits",
      {
        to_address: "0x1111111111111111111111111111111111111111",
        amount_cents: 50,
        reason: "test transfer",
      },
      tools,
      context(),
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toContain("pending human approval");

    const intents = listTransferIntents(db);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.status).toBe("pending_approval");
  });

  it("requires a human-facing reason when approval is needed", async () => {
    setEnv("AUTOMATON_TREASURY_POLICY_ENABLED", "true");
    setEnv("AUTOMATON_TREASURY_REQUIRE_ALLOWLIST", "true");
    setEnv("AUTOMATON_TREASURY_ALLOWLIST", "");
    setEnv("AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED", "false");

    const tools = createBuiltinTools("test-sandbox");
    const result = await executeTool(
      "transfer_credits",
      {
        to_address: "0x1111111111111111111111111111111111111111",
        amount_cents: 50,
      },
      tools,
      context(),
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toContain("Blocked: human approval is required");
    expect(listTransferIntents(db)).toHaveLength(0);
  });

  it("supports manual execution of approved intents through conway backend", async () => {
    setEnv("AUTOMATON_TREASURY_POLICY_ENABLED", "true");
    setEnv("AUTOMATON_TREASURY_REQUIRE_ALLOWLIST", "true");
    setEnv(
      "AUTOMATON_TREASURY_ALLOWLIST",
      "0x1111111111111111111111111111111111111111",
    );
    setEnv("AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS", "100");
    setEnv("AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED", "false");
    setEnv("AUTOMATON_TREASURY_EXECUTION_BACKEND", "conway");

    const tools = createBuiltinTools("test-sandbox");
    const result = await executeTool(
      "transfer_credits",
      {
        to_address: "0x1111111111111111111111111111111111111111",
        amount_cents: 50,
        reason: "manual execute",
      },
      tools,
      context(),
    );

    expect(result.result).toContain("auto-approved");

    const intent = listTransferIntents(db)[0];
    expect(intent?.status).toBe("approved");
    expect(intent?.id).toBeTruthy();

    const executed = await executeApprovedTransferIntent(
      db,
      conway,
      intent!.id,
      {
        executedBy: "test-human",
      },
    );

    expect(["submitted", "executed"]).toContain(executed.status);
    expect(executed.execution?.backend).toBe("conway");
  });

  it("auto-executes approved intents via vultisig outbox broker", async () => {
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "vultisig-outbox-"));

    setEnv("AUTOMATON_TREASURY_POLICY_ENABLED", "true");
    setEnv("AUTOMATON_TREASURY_REQUIRE_ALLOWLIST", "true");
    setEnv(
      "AUTOMATON_TREASURY_ALLOWLIST",
      "0x1111111111111111111111111111111111111111",
    );
    setEnv("AUTOMATON_TREASURY_AUTO_APPROVE_MAX_CENTS", "100");
    setEnv("AUTOMATON_TREASURY_AUTO_EXECUTE_APPROVED", "true");
    setEnv("AUTOMATON_TREASURY_EXECUTION_BACKEND", "vultisig");
    setEnv("AUTOMATON_VULTISIG_BROKER_MODE", "outbox");
    setEnv("AUTOMATON_VULTISIG_OUTBOX_DIR", outbox);

    const tools = createBuiltinTools("test-sandbox");
    const result = await executeTool(
      "transfer_credits",
      {
        to_address: "0x1111111111111111111111111111111111111111",
        amount_cents: 25,
        reason: "auto vultisig test",
      },
      tools,
      context(),
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toContain("processed via vultisig");

    const intent = listTransferIntents(db)[0];
    expect(intent).toBeTruthy();
    const persisted = getTransferIntentById(db, intent!.id);
    expect(["executed", "submitted"]).toContain(persisted?.status || "");

    const outboxFiles = fs.readdirSync(outbox);
    expect(outboxFiles.length).toBeGreaterThanOrEqual(1);
  });
});
