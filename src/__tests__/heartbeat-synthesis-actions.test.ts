import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import {
  MockConwayClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";
import type { AutomatonDatabase } from "../types.js";
import { writeLastMetrics } from "../heartbeat/synthesis-integration.js";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("Heartbeat synthesis action tasks", () => {
  let db: AutomatonDatabase;
  let conway: MockConwayClient;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  function setEnv(key: string, value: string): void {
    if (!(key in originalEnv)) {
      originalEnv[key] = process.env[key];
    }
    process.env[key] = value;
  }

  it("auto-reprices when customer demand trigger is met", async () => {
    setEnv("AUTOMATON_SYNTHESIS_INTEGRATION_ENABLED", "true");
    setEnv("AUTOMATON_PRODUCT_API_BASE_URL", "http://127.0.0.1:3001");
    setEnv("AUTOMATON_INTERNAL_TOKEN", "internal-token");
    setEnv("AUTOMATON_DEMAND_CUSTOMER_DELTA_TRIGGER", "1");
    setEnv("AUTOMATON_DEMAND_REVENUE_GROWTH_TRIGGER", "0.2");
    setEnv("AUTOMATON_AUTO_REPRICE_ENABLED", "true");
    setEnv("AUTOMATON_AUTO_REPRICE_PRODUCT_ID", "crossdomain_risk_nowcast_v1");
    setEnv("AUTOMATON_AUTO_REPRICE_ACCESS_MODE", "latest");
    setEnv("AUTOMATON_AUTO_REPRICE_STEP_PCT", "0.1");
    setEnv("AUTOMATON_AUTO_REPRICE_MAX_USDC", "0.05");

    writeLastMetrics(db, {
      generatedAt: "2026-02-19T00:00:00.000Z",
      revenuePerDay: 1,
      costPerDay: 0.2,
      grossMargin: 0.8,
      signalQualityScore: 0.7,
      customerRetention: 0.5,
      paidCustomers7d: 1,
    });

    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });

      if (url.endsWith("/v1/internal/metrics")) {
        return jsonResponse({
          generatedAt: "2026-02-20T00:00:00.000Z",
          revenuePerDay: 1.6,
          costPerDay: 0.25,
          grossMargin: 0.84375,
          signalQualityScore: 0.72,
          customerRetention: 0.52,
          paidCustomers7d: 3,
        });
      }

      if (url.endsWith("/v1/products")) {
        return jsonResponse({
          generatedAt: "2026-02-20T00:00:01.000Z",
          products: [
            {
              id: "crossdomain_risk_nowcast_v1",
              pricing: {
                latest: 0.01,
                historyBase: 0.02,
              },
            },
          ],
        });
      }

      if (url.endsWith("/v1/internal/pricing/reprice")) {
        return jsonResponse({
          id: "price-rule-1",
          productId: "crossdomain_risk_nowcast_v1",
          accessMode: "latest",
          basePriceUsdc: 0.011,
        });
      }

      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await BUILTIN_TASKS.check_customer_demand({
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
    });

    expect(result.shouldWake).toBe(true);
    expect(result.message).toContain("repriced");
    const repriceCall = calls.find((call) =>
      call.url.endsWith("/v1/internal/pricing/reprice"),
    );
    expect(repriceCall).toBeTruthy();
    const repriceBody = JSON.parse(String(repriceCall?.init?.body));
    expect(repriceBody.basePriceUsdc).toBe(0.011);

    const audit = db.getKV("synthesis.autoreprice.last");
    expect(audit).toBeTruthy();
  });

  it("auto-registers expansion source and triggers synthesis refresh when decision accepted", async () => {
    setEnv("AUTOMATON_SYNTHESIS_INTEGRATION_ENABLED", "true");
    setEnv("AUTOMATON_PRODUCT_API_BASE_URL", "http://127.0.0.1:3001");
    setEnv("AUTOMATON_INTERNAL_TOKEN", "internal-token");
    setEnv("AUTOMATON_AUTO_EXPANSION_APPLY_ENABLED", "true");
    setEnv("AUTOMATON_AUTO_EXPANSION_FAMILY", "onchain_flow");
    setEnv(
      "AUTOMATON_AUTO_EXPANSION_SOURCE_REF",
      "connector://onchain/blockstream-mempool",
    );
    setEnv("AUTOMATON_AUTO_EXPANSION_RUN_SYNTHESIS", "true");
    setEnv(
      "AUTOMATON_AUTO_EXPANSION_TARGET_PRODUCT_IDS",
      "crossdomain_risk_nowcast_v1",
    );

    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });

      if (url.endsWith("/v1/internal/metrics")) {
        return jsonResponse({
          generatedAt: "2026-02-20T00:00:00.000Z",
          revenuePerDay: 2.5,
          costPerDay: 0.4,
          grossMargin: 0.84,
          signalQualityScore: 0.74,
          customerRetention: 0.56,
          paidCustomers7d: 4,
        });
      }

      if (url.endsWith("/v1/internal/expansion/evaluate")) {
        return jsonResponse({
          id: "decision_001",
          status: "accepted",
          reason: "criteria met",
          expansionBudget: 42.5,
        });
      }

      if (url.endsWith("/v1/internal/streams/register")) {
        return jsonResponse({
          id: "stream_auto_001",
          status: "active",
        });
      }

      if (url.endsWith("/v1/internal/synthesis/run")) {
        return jsonResponse({
          ok: true,
        });
      }

      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await BUILTIN_TASKS.evaluate_expansion({
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
    });

    expect(first.shouldWake).toBe(true);
    expect(first.message).toContain("registered stream_auto_001");
    expect(
      calls.some((call) => call.url.endsWith("/v1/internal/streams/register")),
    ).toBe(true);
    expect(
      calls.some((call) => call.url.endsWith("/v1/internal/synthesis/run")),
    ).toBe(true);

    const second = await BUILTIN_TASKS.evaluate_expansion({
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
    });

    expect(second.shouldWake).toBe(false);
    const registerCalls = calls.filter((call) =>
      call.url.endsWith("/v1/internal/streams/register"),
    );
    expect(registerCalls).toHaveLength(1);
  });
});
