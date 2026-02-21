/**
 * Built-in Heartbeat Tasks
 *
 * These tasks run on the heartbeat schedule even while the agent sleeps.
 * They can trigger the agent to wake up if needed.
 */

import type {
  AutomatonConfig,
  AutomatonDatabase,
  ConwayClient,
  AutomatonIdentity,
  SocialClientInterface,
} from "../types.js";
import { getSurvivalTier } from "../conway/credits.js";
import { getUsdcBalance } from "../conway/x402.js";
import {
  evaluateExpansionViaApi,
  fetchProductsCatalog,
  fetchInternalMetrics,
  fetchServiceHealth,
  getSynthesisIntegrationConfig,
  getUptime7dPercent,
  readLastMetrics,
  recordHealthSample,
  registerStreamViaApi,
  repriceViaApi,
  round,
  runSynthesisViaApi,
  writeLastMetrics,
} from "./synthesis-integration.js";
import { processProductPatchQueue } from "./patch-pipeline.js";

export interface HeartbeatTaskContext {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  db: AutomatonDatabase;
  conway: ConwayClient;
  social?: SocialClientInterface;
}

export type HeartbeatTaskFn = (
  ctx: HeartbeatTaskContext,
) => Promise<{ shouldWake: boolean; message?: string }>;

/**
 * Registry of built-in heartbeat tasks.
 */
export const BUILTIN_TASKS: Record<string, HeartbeatTaskFn> = {
  heartbeat_ping: async (ctx) => {
    const credits = await ctx.conway.getCreditsBalance();
    const state = ctx.db.getAgentState();
    const startTime =
      ctx.db.getKV("start_time") || new Date().toISOString();
    const uptimeMs = Date.now() - new Date(startTime).getTime();

    const tier = getSurvivalTier(credits);

    const payload = {
      name: ctx.config.name,
      address: ctx.identity.address,
      state,
      creditsCents: credits,
      uptimeSeconds: Math.floor(uptimeMs / 1000),
      version: ctx.config.version,
      sandboxId: ctx.identity.sandboxId,
      timestamp: new Date().toISOString(),
      tier,
    };

    ctx.db.setKV("last_heartbeat_ping", JSON.stringify(payload));

    // If critical or dead, record a distress signal
    if (tier === "critical" || tier === "dead") {
      const distressPayload = {
        level: tier,
        name: ctx.config.name,
        address: ctx.identity.address,
        creditsCents: credits,
        fundingHint:
          "Use credit transfer API from a creator runtime to top this wallet up.",
        timestamp: new Date().toISOString(),
      };
      ctx.db.setKV("last_distress", JSON.stringify(distressPayload));

      return {
        shouldWake: true,
        message: `Distress: ${tier}. Credits: $${(credits / 100).toFixed(2)}. Need funding.`,
      };
    }

    return { shouldWake: false };
  },

  check_credits: async (ctx) => {
    const credits = await ctx.conway.getCreditsBalance();
    const tier = getSurvivalTier(credits);

    ctx.db.setKV("last_credit_check", JSON.stringify({
      credits,
      tier,
      timestamp: new Date().toISOString(),
    }));

    // Wake the agent if credits dropped to a new tier
    const prevTier = ctx.db.getKV("prev_credit_tier");
    ctx.db.setKV("prev_credit_tier", tier);

    if (prevTier && prevTier !== tier && (tier === "critical" || tier === "dead")) {
      return {
        shouldWake: true,
        message: `Credits dropped to ${tier} tier: $${(credits / 100).toFixed(2)}`,
      };
    }

    return { shouldWake: false };
  },

  check_usdc_balance: async (ctx) => {
    const balance = await getUsdcBalance(ctx.identity.address);

    ctx.db.setKV("last_usdc_check", JSON.stringify({
      balance,
      timestamp: new Date().toISOString(),
    }));

    // If we have USDC but low credits, wake up to potentially convert
    const credits = await ctx.conway.getCreditsBalance();
    if (balance > 0.5 && credits < 500) {
      return {
        shouldWake: true,
        message: `Have ${balance.toFixed(4)} USDC but only $${(credits / 100).toFixed(2)} credits. Consider buying credits.`,
      };
    }

    return { shouldWake: false };
  },

  check_social_inbox: async (ctx) => {
    if (!ctx.social) return { shouldWake: false };

    const cursor = ctx.db.getKV("social_inbox_cursor") || undefined;
    const { messages, nextCursor } = await ctx.social.poll(cursor);

    if (messages.length === 0) return { shouldWake: false };

    // Persist to inbox_messages table for deduplication
    let newCount = 0;
    for (const msg of messages) {
      const existing = ctx.db.getKV(`inbox_seen_${msg.id}`);
      if (!existing) {
        ctx.db.insertInboxMessage(msg);
        ctx.db.setKV(`inbox_seen_${msg.id}`, "1");
        newCount++;
      }
    }

    if (nextCursor) ctx.db.setKV("social_inbox_cursor", nextCursor);

    if (newCount === 0) return { shouldWake: false };

    return {
      shouldWake: true,
      message: `${newCount} new message(s) from: ${messages.map((m) => m.from.slice(0, 10)).join(", ")}`,
    };
  },

  check_for_updates: async (ctx) => {
    try {
      const { checkUpstream, getRepoInfo } = await import("../self-mod/upstream.js");
      const repo = getRepoInfo();
      const upstream = checkUpstream();
      ctx.db.setKV("upstream_status", JSON.stringify({
        ...upstream,
        ...repo,
        checkedAt: new Date().toISOString(),
      }));
      if (upstream.behind > 0) {
        return {
          shouldWake: true,
          message: `${upstream.behind} new commit(s) on origin/main. Review with review_upstream_changes, then cherry-pick what you want with pull_upstream.`,
        };
      }
      return { shouldWake: false };
    } catch (err: any) {
      // Not a git repo or no remote — silently skip
      ctx.db.setKV("upstream_status", JSON.stringify({
        error: err.message,
        checkedAt: new Date().toISOString(),
      }));
      return { shouldWake: false };
    }
  },

  check_pipeline_health: async (ctx) => {
    const integration = getSynthesisIntegrationConfig();
    if (!integration.enabled) {
      return { shouldWake: false };
    }

    try {
      const snapshot = await fetchServiceHealth(integration);
      const freshness =
        typeof snapshot.freshnessMinutes === "number"
          ? snapshot.freshnessMinutes
          : null;
      const freshnessOk =
        freshness !== null &&
        freshness <= integration.pipelineFreshnessMaxMinutes;
      const isHealthy = snapshot.healthy && freshnessOk;
      const uptime7d = round(
        recordHealthSample(ctx.db, isHealthy, freshness),
        2,
      );

      ctx.db.setKV(
        "synthesis.pipeline.last",
        JSON.stringify({
          ...snapshot,
          uptime7d,
        }),
      );

      if (!snapshot.healthy) {
        return {
          shouldWake: true,
          message: `Pipeline health check failed (status=${snapshot.status || "unknown"}).`,
        };
      }

      if (freshness === null) {
        return {
          shouldWake: true,
          message:
            "Pipeline freshness unknown: health payload did not include lastPublishAt/lastFeatureAt.",
        };
      }

      if (freshness > integration.pipelineFreshnessMaxMinutes) {
        return {
          shouldWake: true,
          message: `Pipeline freshness breach: ${round(freshness, 2)}m > ${integration.pipelineFreshnessMaxMinutes}m.`,
        };
      }

      return { shouldWake: false };
    } catch (err: any) {
      const uptime7d = round(recordHealthSample(ctx.db, false, null), 2);
      ctx.db.setKV(
        "synthesis.pipeline.last_error",
        JSON.stringify({
          error: err?.message || String(err),
          checkedAt: new Date().toISOString(),
          uptime7d,
        }),
      );

      return {
        shouldWake: true,
        message: `Pipeline health task failed: ${err?.message || String(err)}`,
      };
    }
  },

  check_profitability: async (ctx) => {
    const integration = getSynthesisIntegrationConfig();
    if (!integration.enabled) {
      return { shouldWake: false };
    }

    try {
      const metrics = await fetchInternalMetrics(integration);
      writeLastMetrics(ctx.db, metrics);
      ctx.db.setKV("synthesis.profitability.last", JSON.stringify(metrics));

      if (metrics.grossMargin < integration.marginFloor) {
        return {
          shouldWake: true,
          message: `Gross margin below threshold: ${round(metrics.grossMargin, 4)} < ${integration.marginFloor}.`,
        };
      }

      if (
        metrics.revenuePerDay < metrics.costPerDay &&
        metrics.paidCustomers7d >= integration.minPaidCustomers
      ) {
        return {
          shouldWake: true,
          message: `Unit economics negative: revenue/day ${round(metrics.revenuePerDay, 4)} < cost/day ${round(metrics.costPerDay, 4)}.`,
        };
      }

      return { shouldWake: false };
    } catch (err: any) {
      return {
        shouldWake: true,
        message: `Profitability check failed: ${err?.message || String(err)}`,
      };
    }
  },

  check_customer_demand: async (ctx) => {
    const integration = getSynthesisIntegrationConfig();
    if (!integration.enabled) {
      return { shouldWake: false };
    }

    try {
      const previous = readLastMetrics(ctx.db);
      const metrics = await fetchInternalMetrics(integration);
      writeLastMetrics(ctx.db, metrics);
      ctx.db.setKV("synthesis.customer_demand.last", JSON.stringify(metrics));

      if (!previous) {
        return { shouldWake: false };
      }

      const customerDelta = metrics.paidCustomers7d - previous.paidCustomers7d;
      const revenueGrowth =
        previous.revenuePerDay > 0
          ? (metrics.revenuePerDay - previous.revenuePerDay) /
            previous.revenuePerDay
          : 0;
      const demandTriggered =
        customerDelta >= integration.demandCustomerIncreaseTrigger ||
        revenueGrowth >= integration.demandRevenueGrowthTrigger;

      if (demandTriggered && integration.autoRepriceEnabled) {
        const catalog = await fetchProductsCatalog(integration);
        const product = catalog.products.find(
          (entry) => entry.id === integration.autoRepriceProductId,
        );

        if (!product) {
          return {
            shouldWake: true,
            message: `Customer demand increased but auto-reprice target ${integration.autoRepriceProductId} was not found.`,
          };
        }

        const currentPrice =
          integration.autoRepriceAccessMode === "history"
            ? product.pricing.historyBase
            : product.pricing.latest;
        const nextPrice = Math.min(
          integration.autoRepriceMaxUsdc,
          round(
            currentPrice * (1 + integration.autoRepriceStepPct),
            6,
          ),
        );

        if (nextPrice <= currentPrice) {
          return {
            shouldWake: true,
            message: `Customer demand increased but repricing is capped at ${integration.autoRepriceMaxUsdc} USDC.`,
          };
        }

        await repriceViaApi(integration, {
          productId: integration.autoRepriceProductId,
          accessMode: integration.autoRepriceAccessMode,
          basePriceUsdc: nextPrice,
          reason: `auto-demand-trigger customersDelta=${customerDelta} revenueGrowth=${round(revenueGrowth, 6)}`,
        });

        ctx.db.setKV(
          "synthesis.autoreprice.last",
          JSON.stringify({
            triggeredAt: new Date().toISOString(),
            productId: integration.autoRepriceProductId,
            accessMode: integration.autoRepriceAccessMode,
            oldPriceUsdc: currentPrice,
            newPriceUsdc: nextPrice,
            customerDelta,
            revenueGrowth,
          }),
        );

        return {
          shouldWake: true,
          message: `Customer demand increased; repriced ${integration.autoRepriceProductId}:${integration.autoRepriceAccessMode} from ${currentPrice} to ${nextPrice} USDC.`,
        };
      }

      if (demandTriggered) {
        return {
          shouldWake: true,
          message: `Customer demand increased (customers +${customerDelta}, revenue growth ${round(revenueGrowth * 100, 2)}%).`,
        };
      }

      if (
        metrics.customerRetention < integration.retentionFloor &&
        metrics.paidCustomers7d >= integration.minPaidCustomers
      ) {
        return {
          shouldWake: true,
          message: `Customer retention dropped below floor: ${round(metrics.customerRetention, 4)} < ${integration.retentionFloor}.`,
        };
      }

      return { shouldWake: false };
    } catch (err: any) {
      return {
        shouldWake: true,
        message: `Customer demand check failed: ${err?.message || String(err)}`,
      };
    }
  },

  check_source_quality: async (ctx) => {
    const integration = getSynthesisIntegrationConfig();
    if (!integration.enabled) {
      return { shouldWake: false };
    }

    try {
      const previous = readLastMetrics(ctx.db);
      const metrics = await fetchInternalMetrics(integration);
      writeLastMetrics(ctx.db, metrics);
      ctx.db.setKV("synthesis.source_quality.last", JSON.stringify(metrics));

      if (metrics.signalQualityScore < integration.signalQualityMin) {
        return {
          shouldWake: true,
          message: `Signal quality below minimum: ${round(metrics.signalQualityScore, 4)} < ${integration.signalQualityMin}.`,
        };
      }

      if (previous) {
        const drift = previous.signalQualityScore - metrics.signalQualityScore;
        if (drift >= integration.signalQualityDriftMax) {
          return {
            shouldWake: true,
            message: `Signal quality drift detected: -${round(drift, 4)} (max allowed ${integration.signalQualityDriftMax}).`,
          };
        }
      }

      return { shouldWake: false };
    } catch (err: any) {
      return {
        shouldWake: true,
        message: `Source quality check failed: ${err?.message || String(err)}`,
      };
    }
  },

  evaluate_expansion: async (ctx) => {
    const integration = getSynthesisIntegrationConfig();
    if (!integration.enabled) {
      return { shouldWake: false };
    }

    try {
      const metrics = await fetchInternalMetrics(integration);
      writeLastMetrics(ctx.db, metrics);

      const uptime7d = round(getUptime7dPercent(ctx.db), 2);
      const payload = {
        revenue7d: round(metrics.revenuePerDay * 7, 6),
        variableCost7d: round(metrics.costPerDay * 7, 6),
        uptime7d,
        medianConfidence: round(metrics.signalQualityScore, 6),
        paidCustomers: Math.max(0, Math.round(metrics.paidCustomers7d)),
        nextSourceMonthlyCost: integration.nextSourceMonthlyCost,
      };

      const decision = await evaluateExpansionViaApi(integration, payload);
      ctx.db.setKV(
        "synthesis.expansion.last",
        JSON.stringify({
          checkedAt: new Date().toISOString(),
          payload,
          decision,
        }),
      );

      const accepted =
        (typeof decision.status === "string" &&
          decision.status.toLowerCase() === "accepted") ||
        decision.shouldAddSource === true;

      if (accepted && integration.autoExpansionApplyEnabled) {
        const decisionId =
          typeof decision.id === "string" ? decision.id : undefined;
        const lastAppliedDecisionId = ctx.db.getKV(
          "synthesis.expansion.last_applied_decision_id",
        );
        if (
          decisionId &&
          lastAppliedDecisionId &&
          decisionId === lastAppliedDecisionId
        ) {
          return { shouldWake: false };
        }

        const streamName = `${integration.autoExpansionNamePrefix} ${new Date().toISOString().slice(0, 16)}`;
        const registered = await registerStreamViaApi(integration, {
          name: streamName,
          family: integration.autoExpansionFamily,
          sourceRef: integration.autoExpansionSourceRef,
          pollingIntervalSeconds:
            integration.autoExpansionPollingIntervalSeconds,
          qualityScore: integration.autoExpansionQualityScore,
        });

        if (integration.autoExpansionRunSynthesis) {
          const payload = integration.autoExpansionTargetProductIds.length > 0
            ? { productIds: integration.autoExpansionTargetProductIds }
            : undefined;
          await runSynthesisViaApi(integration, payload);
        }

        if (decisionId) {
          ctx.db.setKV(
            "synthesis.expansion.last_applied_decision_id",
            decisionId,
          );
        }

        ctx.db.setKV(
          "synthesis.expansion.last_applied",
          JSON.stringify({
            appliedAt: new Date().toISOString(),
            decisionId: decisionId || null,
            streamId: registered.id,
            streamName,
            family: integration.autoExpansionFamily,
            sourceRef: integration.autoExpansionSourceRef,
            runSynthesis: integration.autoExpansionRunSynthesis,
            targetProductIds: integration.autoExpansionTargetProductIds,
          }),
        );

        return {
          shouldWake: true,
          message: `Expansion accepted and applied: registered ${registered.id}${integration.autoExpansionRunSynthesis ? " and triggered synthesis refresh" : ""}.`,
        };
      }

      if (accepted) {
        return {
          shouldWake: true,
          message: `Expansion trigger accepted: ${decision.reason || "criteria met"}.`,
        };
      }

      return { shouldWake: false };
    } catch (err: any) {
      return {
        shouldWake: true,
        message: `Expansion evaluation failed: ${err?.message || String(err)}`,
      };
    }
  },

  process_service_patch_queue: async (ctx) => {
    const integration = getSynthesisIntegrationConfig();
    if (!integration.enabled) {
      return { shouldWake: false };
    }

    const result = processProductPatchQueue(ctx.db);
    if (!result.executed) {
      return { shouldWake: false };
    }
    if (result.success) {
      return {
        shouldWake: true,
        message: result.message,
      };
    }
    return {
      shouldWake: true,
      message: result.message,
    };
  },

  health_check: async (ctx) => {
    // Check that the sandbox is healthy
    try {
      const result = await ctx.conway.exec("echo alive", 5000);
      if (result.exitCode !== 0) {
        return {
          shouldWake: true,
          message: "Health check failed: sandbox exec returned non-zero",
        };
      }
    } catch (err: any) {
      return {
        shouldWake: true,
        message: `Health check failed: ${err.message}`,
      };
    }

    ctx.db.setKV("last_health_check", new Date().toISOString());
    return { shouldWake: false };
  },

};
