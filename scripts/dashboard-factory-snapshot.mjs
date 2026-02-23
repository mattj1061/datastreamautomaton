import { performance } from "node:perf_hooks";

import { loadConfig, resolvePath } from "../dist/config.js";
import { createDatabase } from "../dist/state/database.js";
import { getSynthesisIntegrationConfig } from "../dist/heartbeat/synthesis-integration.js";

const FACTORY_INTERNAL_SNAPSHOT_PATH = "/v1/internal/factory/snapshot";
const FACTORY_INTERNAL_WEBHOOK_ATTEMPTS_PATH = "/v1/internal/signals/webhooks/delivery-attempts";
const FACTORY_WEBHOOK_ATTEMPTS_LIMIT = 25;
const FACTORY_PRODUCT_SNAPSHOT_CACHE_TTL_MS = 60_000;
const FACTORY_REQUIRED_STREAM_FAMILIES = [
  "market_microstructure",
  "onchain_flow",
  "macro_news_risk",
];
const FACTORY_SYNTHESIS_HEARTBEAT_TASKS = [
  "check_pipeline_health",
  "check_profitability",
  "check_customer_demand",
  "check_source_quality",
  "evaluate_expansion",
];

let productFactorySnapshotCache = null;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value, fallback = null) {
  return typeof value === "string" ? value : fallback;
}

function asFiniteNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function toIso(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function safeParseJson(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "empty", value: null };
  }
  try {
    return { ok: true, error: null, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      value: null,
    };
  }
}

function readJsonKv(db, key) {
  const raw = db.getKV(key);
  if (typeof raw === "undefined") {
    return { key, present: false, raw: null, ok: true, value: null, parseError: null };
  }
  const parsed = safeParseJson(raw);
  return {
    key,
    present: true,
    raw,
    ok: parsed.ok,
    value: parsed.value,
    parseError: parsed.ok ? null : parsed.error,
  };
}

function round(value, decimals = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function computeUptime7dFromHealthSamples(rawSamples) {
  if (!Array.isArray(rawSamples)) {
    return { percent: null, sampleCount: 0, lastSampleAt: null };
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const retained = rawSamples.filter((sample) => {
    if (!isRecord(sample)) return false;
    const checkedAt = typeof sample.checkedAt === "string" ? Date.parse(sample.checkedAt) : NaN;
    return Number.isFinite(checkedAt) && checkedAt >= cutoff;
  });
  if (retained.length === 0) {
    return { percent: null, sampleCount: 0, lastSampleAt: null };
  }
  const healthyCount = retained.filter((sample) => asBoolean(sample.healthy, false)).length;
  const lastSample = retained
    .map((sample) => toIso(sample.checkedAt))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || null;
  return {
    percent: round((healthyCount / retained.length) * 100, 2),
    sampleCount: retained.length,
    lastSampleAt: lastSample,
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

function normalizeFactoryInternalSnapshot(payload) {
  let root = payload;
  if (isRecord(payload) && payload.ok === true && isRecord(payload.factory)) {
    root = payload.factory;
  } else if (isRecord(payload) && payload.ok === true && isRecord(payload.snapshot)) {
    root = payload.snapshot;
  }
  if (!isRecord(root)) {
    throw new Error("Factory snapshot response is not an object.");
  }
  if (root.ok === false) {
    throw new Error(asString(root.error, "Factory snapshot endpoint returned ok=false"));
  }

  const streams = isRecord(root.streams) ? root.streams : {};
  const pipeline = isRecord(root.pipeline) ? root.pipeline : {};
  const products = isRecord(root.products) ? root.products : {};
  const service = isRecord(root.service) ? root.service : {};
  const economics = isRecord(root.economics) ? root.economics : {};

  const streamFamiliesRaw = Array.isArray(streams.families) ? streams.families : [];
  const streamItemsRaw = Array.isArray(streams.items) ? streams.items : [];
  const stageItemsRaw = Array.isArray(pipeline.stages) ? pipeline.stages : [];
  const productItemsRaw = Array.isArray(products.items) ? products.items : [];

  const families = streamFamiliesRaw
    .filter(isRecord)
    .map((family) => ({
      family: asString(family.family, "unknown"),
      total: Math.max(0, Math.floor(asFiniteNumber(family.total, 0) || 0)),
      active: Math.max(0, Math.floor(asFiniteNumber(family.active, 0) || 0)),
      medianFreshnessSeconds: asFiniteNumber(family.medianFreshnessSeconds, null),
      qualityAvg: asFiniteNumber(family.qualityAvg, null),
    }));

  const streamsItems = streamItemsRaw
    .filter(isRecord)
    .map((item) => ({
      id: asString(item.id, "unknown-stream"),
      name: asString(item.name, asString(item.id, "Unnamed stream")),
      family: asString(item.family, "unknown"),
      status: asString(item.status, "unknown"),
      sourceRef: asString(item.sourceRef, ""),
      pollingIntervalSeconds: asFiniteNumber(item.pollingIntervalSeconds, null),
      qualityScore: asFiniteNumber(item.qualityScore, null),
      lastObservedAt: toIso(item.lastObservedAt),
      freshnessSeconds: asFiniteNumber(item.freshnessSeconds, null),
      observationsLastHour: asFiniteNumber(item.observationsLastHour, null),
      errorCount24h: asFiniteNumber(item.errorCount24h, null),
      costPerMonthUsd: asFiniteNumber(item.costPerMonthUsd, null),
    }));

  const stages = stageItemsRaw
    .filter(isRecord)
    .map((stage) => ({
      stage: asString(stage.stage, "unknown"),
      status: asString(stage.status, "unknown"),
      cadenceSeconds: asFiniteNumber(stage.cadenceSeconds, null),
      lastSuccessAt: toIso(stage.lastSuccessAt),
      lastRunAt: toIso(stage.lastRunAt),
      lastDurationMs: asFiniteNumber(stage.lastDurationMs, null),
      backlogCount: asFiniteNumber(stage.backlogCount, null),
      errorCount24h: asFiniteNumber(stage.errorCount24h, null),
    }));

  const productItems = productItemsRaw
    .filter(isRecord)
    .map((item) => {
      const pricing = isRecord(item.pricing) ? item.pricing : {};
      const usage = isRecord(item.usage) ? item.usage : {};
      const itemEcon = isRecord(item.economics) ? item.economics : {};
      const quality = isRecord(item.quality) ? item.quality : {};
      return {
        productId: asString(item.productId, "unknown-product"),
        status: asString(item.status, "unknown"),
        latestPublishAt: toIso(item.latestPublishAt),
        freshnessMinutes: asFiniteNumber(item.freshnessMinutes, null),
        latestScore: asFiniteNumber(item.latestScore, null),
        latestConfidence: asFiniteNumber(item.latestConfidence, null),
        latestRegime: asString(item.latestRegime, null),
        pricing: {
          latestPriceUsdc: asFiniteNumber(pricing.latestPriceUsdc, asFiniteNumber(pricing.latest, null)),
          historyBasePriceUsdc: asFiniteNumber(pricing.historyBasePriceUsdc, asFiniteNumber(pricing.historyBase, null)),
        },
        usage: {
          calls24h: asFiniteNumber(usage.calls24h, null),
          paidCalls24h: asFiniteNumber(usage.paidCalls24h, null),
        },
        economics: {
          revenue24h: asFiniteNumber(itemEcon.revenue24h, null),
          revenue7d: asFiniteNumber(itemEcon.revenue7d, null),
        },
        quality: {
          qualityScore: asFiniteNumber(quality.qualityScore, null),
          medianConfidence24h: asFiniteNumber(quality.medianConfidence24h, null),
        },
      };
    });

  return {
    generatedAt: toIso(root.generatedAt) || new Date().toISOString(),
    service: {
      status: asString(service.status, "unknown"),
      version: asString(service.version, null),
      lastFeatureAt: toIso(service.lastFeatureAt),
      lastPublishAt: toIso(service.lastPublishAt),
    },
    streams: {
      total: Math.max(0, Math.floor(asFiniteNumber(streams.total, streamsItems.length) || 0)),
      active: Math.max(0, Math.floor(asFiniteNumber(streams.active, streamsItems.filter((s) => String(s.status || "").toLowerCase() === "active").length) || 0)),
      families,
      items: streamsItems,
    },
    pipeline: {
      stages,
    },
    products: {
      total: Math.max(0, Math.floor(asFiniteNumber(products.total, productItems.length) || 0)),
      active: Math.max(0, Math.floor(asFiniteNumber(products.active, productItems.filter((p) => ["active", "live", "enabled"].includes(String(p.status).toLowerCase())).length) || 0)),
      items: productItems,
    },
    economics: {
      revenuePerDay: asFiniteNumber(economics.revenuePerDay, null),
      costPerDay: asFiniteNumber(economics.costPerDay, null),
      grossMargin: asFiniteNumber(economics.grossMargin, null),
      customerRetention: asFiniteNumber(economics.customerRetention, null),
      paidCustomers7d: asFiniteNumber(economics.paidCustomers7d, null),
      signalQualityScore: asFiniteNumber(economics.signalQualityScore, null),
    },
  };
}

function normalizeWebhookAttemptsSnapshot(payload) {
  if (!isRecord(payload)) {
    throw new Error("Webhook delivery attempts response is not an object.");
  }

  const attemptsRaw = Array.isArray(payload.attempts) ? payload.attempts : [];
  const statusCountsRaw = isRecord(payload.statusCounts) ? payload.statusCounts : {};

  const attempts = attemptsRaw
    .filter(isRecord)
    .map((attempt) => ({
      id: asString(attempt.id, "unknown-attempt"),
      subscriptionId: asString(attempt.subscriptionId, "unknown-subscription"),
      productId: asString(attempt.productId, "unknown-product"),
      customerId: asString(attempt.customerId, "unknown-customer"),
      triggerType: asString(attempt.triggerType, "unknown"),
      triggerEventId: asString(attempt.triggerEventId, null),
      triggerEventCreatedAt: toIso(attempt.triggerEventCreatedAt),
      attemptNumber: asFiniteNumber(attempt.attemptNumber, null),
      terminal: Boolean(attempt.terminal),
      status: asString(attempt.status, "unknown"),
      httpStatus: asFiniteNumber(attempt.httpStatus, null),
      errorMessage: asString(attempt.errorMessage, null),
      signalPointId: asString(attempt.signalPointId, null),
      signalBucketAt: toIso(attempt.signalBucketAt),
      requestHeaders: isRecord(attempt.requestHeaders) ? attempt.requestHeaders : {},
      responseMetadata: isRecord(attempt.responseMetadata) ? attempt.responseMetadata : {},
      nextRetryAt: toIso(attempt.nextRetryAt),
      createdAt: toIso(attempt.createdAt),
    }));

  return {
    generatedAt: toIso(payload.generatedAt) || new Date().toISOString(),
    total: Math.max(0, Math.floor(asFiniteNumber(payload.total, attempts.length) || 0)),
    persistenceBackend: asString(payload.persistenceBackend, "unknown"),
    filters: isRecord(payload.filters) ? payload.filters : {},
    statusCounts: {
      delivered: Math.max(0, Math.floor(asFiniteNumber(statusCountsRaw.delivered, 0) || 0)),
      failed: Math.max(0, Math.floor(asFiniteNumber(statusCountsRaw.failed, 0) || 0)),
      deadLettered: Math.max(0, Math.floor(asFiniteNumber(statusCountsRaw.dead_lettered, 0) || 0)),
    },
    attempts,
  };
}

function buildInternalFactorySnapshotUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new Error("Missing synthesis product API base URL.");
  }
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}${FACTORY_INTERNAL_SNAPSHOT_PATH}`;
}

function buildInternalWebhookAttemptsUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new Error("Missing synthesis product API base URL.");
  }
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}${FACTORY_INTERNAL_WEBHOOK_ATTEMPTS_PATH}?limit=${FACTORY_WEBHOOK_ATTEMPTS_LIMIT}`;
}

async function fetchJsonWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      const snippet = text.slice(0, 300).replace(/\s+/g, " ").trim();
      throw new Error(`HTTP ${response.status} from ${url}: ${snippet}`);
    }
    if (!text.trim()) return {};
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFactoryProductSnapshot(integration) {
  const url = buildInternalFactorySnapshotUrl(integration.apiBaseUrl);
  const timeoutMs = Math.max(1500, Math.min(20_000, Number(integration.requestTimeoutMs || 10_000)));
  const payload = await fetchJsonWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "x-internal-token": integration.internalToken || "",
      },
    },
    timeoutMs,
  );

  const normalized = normalizeFactoryInternalSnapshot(payload);
  return {
    url,
    fetchedAt: new Date().toISOString(),
    snapshot: normalized,
  };
}

async function fetchFactoryWebhookDeliveryAttempts(integration) {
  const url = buildInternalWebhookAttemptsUrl(integration.apiBaseUrl);
  const timeoutMs = Math.max(1500, Math.min(20_000, Number(integration.requestTimeoutMs || 10_000)));
  const payload = await fetchJsonWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "x-internal-token": integration.internalToken || "",
      },
    },
    timeoutMs,
  );

  return {
    url,
    fetchedAt: new Date().toISOString(),
    snapshot: normalizeWebhookAttemptsSnapshot(payload),
  };
}

function getCachedProductSnapshot() {
  if (!productFactorySnapshotCache) return null;
  const fetchedMs = Date.parse(productFactorySnapshotCache.fetchedAt);
  const ageMs = Number.isFinite(fetchedMs) ? Math.max(0, Date.now() - fetchedMs) : null;
  if (ageMs == null) return null;
  return {
    ...productFactorySnapshotCache,
    ageMs,
    stale: ageMs > FACTORY_PRODUCT_SNAPSHOT_CACHE_TTL_MS,
  };
}

function cacheProductSnapshot(entry) {
  productFactorySnapshotCache = entry;
}

function getLatestMetricsCandidate(...candidates) {
  const valid = candidates
    .filter(isRecord)
    .map((entry) => ({
      entry,
      generatedAt: toIso(entry.generatedAt),
    }))
    .sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
  return valid[0]?.entry || null;
}

function buildDefaultPipelineStages(pipelineHealth) {
  const lastFeatureAt = toIso(pipelineHealth?.lastFeatureAt) || null;
  const lastPublishAt = toIso(pipelineHealth?.lastPublishAt) || null;
  const fresh = typeof pipelineHealth?.freshnessMinutes === "number" ? pipelineHealth.freshnessMinutes : null;
  return [
    {
      stage: "ingestion",
      status: pipelineHealth?.healthy === false ? "degraded" : "unknown",
      cadenceSeconds: 60,
      lastSuccessAt: lastFeatureAt || lastPublishAt,
      lastRunAt: lastFeatureAt || lastPublishAt,
      lastDurationMs: null,
      backlogCount: null,
      errorCount24h: null,
    },
    {
      stage: "feature_compute",
      status: pipelineHealth?.healthy === false ? "degraded" : (lastFeatureAt ? "ok" : "unknown"),
      cadenceSeconds: 300,
      lastSuccessAt: lastFeatureAt,
      lastRunAt: lastFeatureAt,
      lastDurationMs: null,
      backlogCount: null,
      errorCount24h: null,
    },
    {
      stage: "signal_publish",
      status:
        pipelineHealth?.healthy === false
          ? "degraded"
          : (fresh != null && fresh <= 15 ? "ok" : (lastPublishAt ? "stale" : "unknown")),
      cadenceSeconds: 600,
      lastSuccessAt: lastPublishAt,
      lastRunAt: lastPublishAt,
      lastDurationMs: null,
      backlogCount: null,
      errorCount24h: null,
    },
  ];
}

function makeEmptyFamilies() {
  return FACTORY_REQUIRED_STREAM_FAMILIES.map((family) => ({
    family,
    total: 0,
    active: 0,
    healthyCount: 0,
    medianFreshnessSeconds: null,
    qualityAvg: null,
  }));
}

function normalizeStreamFamilies(streamsItems, upstreamFamilies = []) {
  const familyMap = new Map();
  for (const entry of upstreamFamilies) {
    if (!isRecord(entry)) continue;
    const family = asString(entry.family, "unknown");
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        family,
        total: Math.max(0, Math.floor(asFiniteNumber(entry.total, 0) || 0)),
        active: Math.max(0, Math.floor(asFiniteNumber(entry.active, 0) || 0)),
        healthyCount: 0,
        medianFreshnessSeconds: asFiniteNumber(entry.medianFreshnessSeconds, null),
        qualityAvg: asFiniteNumber(entry.qualityAvg, null),
      });
    }
  }

  const computed = new Map();
  for (const stream of streamsItems) {
    const family = asString(stream.family, "unknown") || "unknown";
    if (!computed.has(family)) {
      computed.set(family, {
        family,
        total: 0,
        active: 0,
        healthyCount: 0,
        freshnessValues: [],
        qualityValues: [],
      });
    }
    const bucket = computed.get(family);
    bucket.total += 1;
    const active = ["active", "ok", "enabled", "live"].includes(String(stream.status || "").toLowerCase());
    if (active) bucket.active += 1;
    const streamHealthy = active && ((stream.errorCount24h ?? 0) <= 0);
    if (streamHealthy) bucket.healthyCount += 1;
    if (Number.isFinite(stream.freshnessSeconds)) bucket.freshnessValues.push(Number(stream.freshnessSeconds));
    if (Number.isFinite(stream.qualityScore)) bucket.qualityValues.push(Number(stream.qualityScore));
  }

  for (const [family, bucket] of computed.entries()) {
    const existing = familyMap.get(family) || {
      family,
      total: 0,
      active: 0,
      healthyCount: 0,
      medianFreshnessSeconds: null,
      qualityAvg: null,
    };
    const sortedFreshness = bucket.freshnessValues.slice().sort((a, b) => a - b);
    const medianFreshness =
      sortedFreshness.length === 0
        ? existing.medianFreshnessSeconds
        : sortedFreshness[Math.floor(sortedFreshness.length / 2)];
    const qualityAvg =
      bucket.qualityValues.length === 0
        ? existing.qualityAvg
        : round(bucket.qualityValues.reduce((acc, v) => acc + v, 0) / bucket.qualityValues.length, 4);
    familyMap.set(family, {
      family,
      total: Math.max(existing.total, bucket.total),
      active: Math.max(existing.active, bucket.active),
      healthyCount: Math.max(existing.healthyCount || 0, bucket.healthyCount),
      medianFreshnessSeconds: Number.isFinite(medianFreshness) ? medianFreshness : null,
      qualityAvg,
    });
  }

  for (const family of FACTORY_REQUIRED_STREAM_FAMILIES) {
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        family,
        total: 0,
        active: 0,
        healthyCount: 0,
        medianFreshnessSeconds: null,
        qualityAvg: null,
      });
    }
  }

  return Array.from(familyMap.values()).sort((a, b) => a.family.localeCompare(b.family));
}

function readFactoryRuntimeState(db) {
  const kvKeys = [
    "synthesis.pipeline.last",
    "synthesis.pipeline.last_error",
    "synthesis.profitability.last",
    "synthesis.customer_demand.last",
    "synthesis.source_quality.last",
    "synthesis.autoreprice.last",
    "synthesis.expansion.last",
    "synthesis.expansion.last_applied",
    "synthesis.patch_pipeline.last",
    "synthesis.metrics.last.v1",
    "synthesis.health.samples.v1",
  ];

  const kv = {};
  const kvErrors = [];
  for (const key of kvKeys) {
    const parsed = readJsonKv(db, key);
    kv[key] = parsed;
    if (parsed.present && !parsed.ok) {
      kvErrors.push({ key, error: parsed.parseError || "parse_error" });
    }
  }

  return { kv, kvErrors };
}

function buildFactoryDataSources({
  runtimeDbPath,
  kvErrors,
  productFetch,
  webhookAttemptsFetch,
  cacheInfo,
  usedCachedProductSnapshot,
}) {
  const dataSources = [];
  dataSources.push({
    name: "runtime_db",
    status: "ok",
    reachable: true,
    stale: false,
    staleAgeSeconds: null,
    used: true,
    lastFetchedAt: new Date().toISOString(),
    path: runtimeDbPath || null,
    message: runtimeDbPath ? `SQLite state at ${runtimeDbPath}` : "SQLite state available",
    error: null,
  });

  dataSources.push({
    name: "runtime_kv",
    status: kvErrors.length > 0 ? "degraded" : "ok",
    reachable: true,
    stale: false,
    staleAgeSeconds: null,
    used: true,
    lastFetchedAt: new Date().toISOString(),
    path: null,
    message: kvErrors.length > 0 ? `${kvErrors.length} KV parse issue(s)` : "Runtime synthesis KV telemetry parsed",
    error: kvErrors.length > 0 ? kvErrors.map((e) => `${e.key}: ${e.error}`).join("; ") : null,
  });

  const productStatus = productFetch.success
    ? "ok"
    : usedCachedProductSnapshot
      ? "degraded"
      : "offline";

  dataSources.push({
    name: "product_service_internal_factory_snapshot",
    status: productStatus,
    reachable: productFetch.success,
    stale: usedCachedProductSnapshot,
    staleAgeSeconds: usedCachedProductSnapshot && cacheInfo ? round((cacheInfo.ageMs || 0) / 1000, 2) : null,
    used: productFetch.success || usedCachedProductSnapshot,
    lastFetchedAt: productFetch.success
      ? productFetch.fetchedAt
      : (usedCachedProductSnapshot ? cacheInfo?.fetchedAt || null : null),
    path: productFetch.url || null,
    message: productFetch.success
      ? "Live product-service factory snapshot"
      : usedCachedProductSnapshot
        ? "Using cached product-service factory snapshot"
        : "Product-service factory snapshot unavailable",
    error: productFetch.success ? null : (productFetch.error || null),
  });

  dataSources.push({
    name: "product_service_internal_webhook_delivery_attempts",
    status: webhookAttemptsFetch?.success ? "ok" : "degraded",
    reachable: Boolean(webhookAttemptsFetch?.success),
    stale: false,
    staleAgeSeconds: null,
    used: Boolean(webhookAttemptsFetch?.success),
    lastFetchedAt: webhookAttemptsFetch?.fetchedAt || null,
    path: webhookAttemptsFetch?.url || null,
    message: webhookAttemptsFetch?.success
      ? `Webhook delivery attempts loaded (${webhookAttemptsFetch.snapshot?.total ?? 0} records)`
      : "Webhook delivery attempts endpoint unavailable (optional)",
    error: webhookAttemptsFetch?.success ? null : (webhookAttemptsFetch?.error || null),
  });

  if (cacheInfo) {
    dataSources.push({
      name: "product_service_cache",
      status: cacheInfo.stale ? "stale" : "ok",
      reachable: true,
      stale: cacheInfo.stale,
      staleAgeSeconds: round((cacheInfo.ageMs || 0) / 1000, 2),
      used: Boolean(usedCachedProductSnapshot),
      lastFetchedAt: cacheInfo.fetchedAt || null,
      path: null,
      message: cacheInfo.stale ? "Cached snapshot expired" : "Cached snapshot available",
      error: null,
    });
  }

  return dataSources;
}

function pickCurrentEconomics(productSnapshot, runtimeSignals) {
  const kv = runtimeSignals.kv;
  const metricsLast = kv["synthesis.metrics.last.v1"]?.value;
  const profitabilityLast = kv["synthesis.profitability.last"]?.value;
  const demandLast = kv["synthesis.customer_demand.last"]?.value;
  const qualityLast = kv["synthesis.source_quality.last"]?.value;

  const latestMetrics = getLatestMetricsCandidate(metricsLast, profitabilityLast, demandLast, qualityLast);
  const econ = isRecord(productSnapshot?.economics) ? productSnapshot.economics : {};

  return {
    revenuePerDay: asFiniteNumber(econ.revenuePerDay, asFiniteNumber(latestMetrics?.revenuePerDay, null)),
    costPerDay: asFiniteNumber(econ.costPerDay, asFiniteNumber(latestMetrics?.costPerDay, null)),
    grossMargin: asFiniteNumber(econ.grossMargin, asFiniteNumber(latestMetrics?.grossMargin, null)),
    customerRetention: asFiniteNumber(econ.customerRetention, asFiniteNumber(latestMetrics?.customerRetention, null)),
    paidCustomers7d: asFiniteNumber(econ.paidCustomers7d, asFiniteNumber(latestMetrics?.paidCustomers7d, null)),
    signalQualityScore: asFiniteNumber(econ.signalQualityScore, asFiniteNumber(latestMetrics?.signalQualityScore, null)),
    metricsGeneratedAt: toIso(econ.generatedAt) || toIso(latestMetrics?.generatedAt),
  };
}

function buildReinvestmentChecklist(integration, economics, expansionDecision) {
  const revenuePerDay = asFiniteNumber(economics?.revenuePerDay, null);
  const costPerDay = asFiniteNumber(economics?.costPerDay, null);
  const uptime7d = asFiniteNumber(economics?.uptime7dPercent, null);
  const confidence = asFiniteNumber(economics?.signalQualityScore, null);
  const paidCustomers7d = asFiniteNumber(economics?.paidCustomers7d, null);

  const revenue7d = revenuePerDay == null ? null : revenuePerDay * 7;
  const cost7d = costPerDay == null ? null : costPerDay * 7;
  const netProfit7d = revenue7d == null || cost7d == null ? null : (revenue7d - cost7d);
  const decisionBudget = isRecord(expansionDecision?.decision)
    ? asFiniteNumber(expansionDecision.decision.expansionBudget, null)
    : null;
  const expansionBudget = decisionBudget != null
    ? decisionBudget
    : (netProfit7d != null ? Math.max(0, netProfit7d * 0.5) : null);
  const nextSourceMonthlyCost = asFiniteNumber(integration?.nextSourceMonthlyCost, null);
  const requiredBudget = nextSourceMonthlyCost == null ? null : nextSourceMonthlyCost * 1.5;

  return {
    netProfit7d,
    expansionBudget,
    requiredBudget,
    items: [
      {
        key: "uptime_7d",
        label: "Uptime >= 99.0%",
        pass: uptime7d == null ? null : uptime7d >= 99,
        actual: uptime7d,
        target: 99,
        unit: "%",
      },
      {
        key: "median_confidence",
        label: "Median confidence >= 0.62",
        pass: confidence == null ? null : confidence >= 0.62,
        actual: confidence,
        target: 0.62,
        unit: "",
      },
      {
        key: "paid_customers",
        label: `Paid customers >= ${integration.minPaidCustomers}`,
        pass: paidCustomers7d == null ? null : paidCustomers7d >= integration.minPaidCustomers,
        actual: paidCustomers7d,
        target: integration.minPaidCustomers,
        unit: "",
      },
      {
        key: "expansion_budget",
        label: "Expansion budget >= 1.5x next source cost",
        pass: expansionBudget == null || requiredBudget == null ? null : expansionBudget >= requiredBudget,
        actual: expansionBudget,
        target: requiredBudget,
        unit: "usd",
      },
    ],
  };
}

function normalizeAutonomySection({ integration, kv, economics }) {
  const lastAutoReprice = kv["synthesis.autoreprice.last"]?.value;
  const lastExpansionEval = kv["synthesis.expansion.last"]?.value;
  const lastExpansionApplied = kv["synthesis.expansion.last_applied"]?.value;
  const patchPipeline = kv["synthesis.patch_pipeline.last"]?.value;

  const reinvestment = buildReinvestmentChecklist(integration, economics, lastExpansionEval);

  return {
    lastAutoReprice: isRecord(lastAutoReprice) ? lastAutoReprice : null,
    lastExpansionEvaluation: isRecord(lastExpansionEval) ? lastExpansionEval : null,
    lastExpansionApplied: isRecord(lastExpansionApplied) ? lastExpansionApplied : null,
    patchPipeline: isRecord(patchPipeline) ? patchPipeline : null,
    nextSourceCandidate: {
      family: integration.autoExpansionFamily,
      sourceRef: integration.autoExpansionSourceRef,
      pollingIntervalSeconds: integration.autoExpansionPollingIntervalSeconds,
      qualityScore: integration.autoExpansionQualityScore,
      targetProductIds: Array.isArray(integration.autoExpansionTargetProductIds)
        ? integration.autoExpansionTargetProductIds
        : [],
      autoApplyEnabled: Boolean(integration.autoExpansionApplyEnabled),
      runSynthesisAfterApply: Boolean(integration.autoExpansionRunSynthesis),
    },
    autoRepriceConfig: {
      enabled: Boolean(integration.autoRepriceEnabled),
      productId: integration.autoRepriceProductId,
      accessMode: integration.autoRepriceAccessMode,
      stepPct: integration.autoRepriceStepPct,
      maxUsdc: integration.autoRepriceMaxUsdc,
    },
    reinvestment,
  };
}

function buildFactoryAlerts({ integration, sources, outputs, pipeline, economics, autonomy, delivery, productFetch, webhookAttemptsFetch, usedCachedProductSnapshot, kvErrors }) {
  const alerts = [];
  const nowIso = new Date().toISOString();

  function pushAlert(code, severity, message, extra = {}) {
    alerts.push({
      code,
      severity,
      message,
      firstSeenAt: extra.firstSeenAt || nowIso,
      lastSeenAt: extra.lastSeenAt || nowIso,
      relatedEntity: extra.relatedEntity || null,
      details: extra.details || null,
    });
  }

  if (!productFetch.success) {
    pushAlert(
      "product_service_unreachable",
      "high",
      usedCachedProductSnapshot
        ? "Product-service factory snapshot fetch failed; using cached snapshot."
        : "Product-service factory snapshot fetch failed; running in runtime-only degraded mode.",
      {
        details: { error: productFetch.error || null },
      },
    );
  }

  for (const kvErr of kvErrors || []) {
    pushAlert("runtime_kv_parse_error", "medium", `Failed to parse runtime KV ${kvErr.key}`, {
      relatedEntity: { type: "kv", id: kvErr.key },
      details: { error: kvErr.error },
    });
  }

  const freshness = asFiniteNumber(pipeline?.health?.freshnessMinutes, null);
  const freshnessMax = asFiniteNumber(pipeline?.health?.freshnessThresholdMinutes, null);
  if (freshness == null) {
    pushAlert("pipeline_freshness_unknown", "medium", "Pipeline freshness is unknown (missing lastPublishAt/lastFeatureAt).", {
      relatedEntity: { type: "pipeline", id: "signal_publish" },
    });
  } else if (freshnessMax != null && freshness > freshnessMax) {
    pushAlert("pipeline_freshness_breach", "high", `Pipeline freshness breach: ${round(freshness, 2)}m > ${freshnessMax}m.`, {
      relatedEntity: { type: "pipeline", id: "signal_publish" },
      details: { freshnessMinutes: freshness, thresholdMinutes: freshnessMax },
    });
  }

  if (typeof economics?.signalQualityScore === "number") {
    if (economics.signalQualityScore < integration.signalQualityMin) {
      pushAlert("signal_quality_below_floor", "high", `Signal quality below floor: ${round(economics.signalQualityScore, 4)} < ${integration.signalQualityMin}.`, {
        relatedEntity: { type: "metric", id: "signal_quality" },
      });
    }
  }

  const prevQuality = asFiniteNumber(economics?.previousSignalQualityScore, null);
  if (prevQuality != null && typeof economics?.signalQualityScore === "number") {
    const drift = prevQuality - economics.signalQualityScore;
    if (drift >= integration.signalQualityDriftMax) {
      pushAlert("signal_quality_drift_breach", "high", `Signal quality drift detected: -${round(drift, 4)} (max ${integration.signalQualityDriftMax}).`, {
        relatedEntity: { type: "metric", id: "signal_quality" },
        details: { drift, previous: prevQuality, current: economics.signalQualityScore },
      });
    }
  }

  if (typeof economics?.grossMargin === "number" && economics.grossMargin < integration.marginFloor) {
    pushAlert("gross_margin_below_floor", "high", `Gross margin below floor: ${round(economics.grossMargin, 4)} < ${integration.marginFloor}.`, {
      relatedEntity: { type: "metric", id: "gross_margin" },
    });
  }

  if (
    typeof economics?.customerRetention === "number" &&
    economics.customerRetention < integration.retentionFloor &&
    (economics.paidCustomers7d ?? 0) >= integration.minPaidCustomers
  ) {
    pushAlert("retention_below_floor", "medium", `Customer retention below floor: ${round(economics.customerRetention, 4)} < ${integration.retentionFloor}.`, {
      relatedEntity: { type: "metric", id: "customer_retention" },
    });
  }

  const requiredFamilies = new Set(FACTORY_REQUIRED_STREAM_FAMILIES);
  for (const family of requiredFamilies) {
    const familySummary = (sources.families || []).find((f) => f.family === family);
    if (!familySummary || (familySummary.active || 0) <= 0) {
      pushAlert("missing_stream_family_coverage", "medium", `No active input streams in family ${family}.`, {
        relatedEntity: { type: "stream_family", id: family },
      });
    }
  }

  for (const stream of sources.items || []) {
    const active = ["active", "ok", "enabled", "live"].includes(String(stream.status || "").toLowerCase());
    const polling = asFiniteNumber(stream.pollingIntervalSeconds, null);
    const freshnessSeconds = asFiniteNumber(stream.freshnessSeconds, null);
    if (active && freshnessSeconds != null) {
      const thresholdSec = Math.max((polling || 60) * 3, 300);
      if (freshnessSeconds > thresholdSec) {
        pushAlert("stream_stale", "medium", `Stream ${stream.name || stream.id} is stale (${round(freshnessSeconds, 1)}s > ${thresholdSec}s).`, {
          relatedEntity: { type: "stream", id: stream.id },
          details: { freshnessSeconds, thresholdSec },
        });
      }
    }
    if (active && (asFiniteNumber(stream.errorCount24h, 0) || 0) > 0) {
      pushAlert("stream_error_rate_high", "medium", `Stream ${stream.name || stream.id} has errors in the last 24h (${stream.errorCount24h}).`, {
        relatedEntity: { type: "stream", id: stream.id },
      });
    }
  }

  for (const product of outputs.items || []) {
    const freshnessMinutes = asFiniteNumber(product.freshnessMinutes, null);
    if (freshnessMinutes != null && freshnessMinutes > 20) {
      pushAlert("product_stale_output", "high", `Product ${product.productId} output is stale (${round(freshnessMinutes, 2)}m).`, {
        relatedEntity: { type: "product", id: product.productId },
      });
    }
  }

  const expansionEval = autonomy?.lastExpansionEvaluation;
  const expansionApplied = autonomy?.lastExpansionApplied;
  if (isRecord(expansionEval)) {
    const decision = isRecord(expansionEval.decision) ? expansionEval.decision : null;
    const accepted =
      (typeof decision?.status === "string" && decision.status.toLowerCase() === "accepted") ||
      decision?.shouldAddSource === true;
    if (accepted) {
      const evalDecisionId = asString(decision?.id, null);
      const appliedDecisionId = asString(expansionApplied?.decisionId, null);
      if (!expansionApplied || (evalDecisionId && appliedDecisionId && evalDecisionId !== appliedDecisionId) || (evalDecisionId && !appliedDecisionId)) {
        pushAlert("expansion_accepted_pending_apply", "info", `Expansion accepted${asString(decision?.reason, "") ? `: ${decision.reason}` : ""}.`, {
          relatedEntity: { type: "expansion_decision", id: evalDecisionId || "latest" },
        });
      }
    }
  }

  const patchPipeline = autonomy?.patchPipeline;
  if (isRecord(patchPipeline) && patchPipeline.ok === false) {
    pushAlert("patch_pipeline_failure", "medium", asString(patchPipeline.message, "Product patch pipeline failure."), {
      relatedEntity: { type: "patch_pipeline", id: "synthesis.patch_pipeline.last" },
    });
  }

  const autoReprice = autonomy?.lastAutoReprice;
  if (isRecord(autoReprice) && toIso(autoReprice.triggeredAt)) {
    const triggeredAtMs = Date.parse(autoReprice.triggeredAt);
    if (Number.isFinite(triggeredAtMs) && Date.now() - triggeredAtMs <= 24 * 60 * 60 * 1000) {
      pushAlert("recent_auto_reprice", "info", `Auto-reprice triggered for ${asString(autoReprice.productId, "product")}.`, {
        relatedEntity: { type: "product", id: asString(autoReprice.productId, "unknown") },
      });
    }
  }

  const webhookSummary = isRecord(delivery?.webhooks) ? delivery.webhooks : null;
  const webhookStatusCounts = isRecord(webhookSummary?.statusCounts) ? webhookSummary.statusCounts : null;
  const deadLetteredCount = asFiniteNumber(webhookStatusCounts?.deadLettered, 0) || 0;
  const failedCount = asFiniteNumber(webhookStatusCounts?.failed, 0) || 0;
  if (webhookAttemptsFetch && webhookAttemptsFetch.success === false && integration.enabled) {
    pushAlert(
      "webhook_attempts_endpoint_unavailable",
      "info",
      "Webhook delivery attempts operator endpoint is unavailable; delivery observability is reduced.",
      {
        relatedEntity: { type: "delivery_channel", id: "webhooks" },
        details: { error: webhookAttemptsFetch.error || null },
      },
    );
  }
  if (deadLetteredCount > 0) {
    pushAlert(
      "webhook_dead_lettered_attempts_present",
      "high",
      `Webhook dead-letter attempts present: ${deadLetteredCount}.`,
      {
        relatedEntity: { type: "delivery_channel", id: "webhooks" },
        details: { deadLetteredCount },
      },
    );
  }
  if (failedCount > 0) {
    pushAlert(
      "webhook_failed_attempts_recent",
      "medium",
      `Webhook failed attempts present in recent operator window: ${failedCount}.`,
      {
        relatedEntity: { type: "delivery_channel", id: "webhooks" },
        details: { failedCount },
      },
    );
  }

  const severityRank = { high: 0, medium: 1, info: 2, low: 3 };
  alerts.sort((a, b) => {
    const r = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    if (r !== 0) return r;
    return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
  });

  return alerts;
}

function deriveFactoryStatusFromAlerts(alerts, integrationEnabled, productServiceReachability) {
  if (!integrationEnabled) return "degraded";
  const severities = new Set((alerts || []).map((a) => a.severity));
  if (productServiceReachability === "offline") return "degraded";
  if (productServiceReachability === "degraded") return severities.has("high") ? "warning" : "attention";
  if (severities.has("high")) return "warning";
  if (severities.has("medium")) return "attention";
  return "nominal";
}

function mapPipelineAutomationHeartbeats(heartbeats) {
  const heartbeatsByTask = new Map((heartbeats || []).map((hb) => [hb.task, hb]));
  return FACTORY_SYNTHESIS_HEARTBEAT_TASKS.map((task) => {
    const hb = heartbeatsByTask.get(task);
    const lastRun = hb?.lastRun || null;
    const nextRun = hb?.nextRun || null;
    const enabled = Boolean(hb?.enabled);
    let status = "disabled";
    if (enabled) {
      status = "scheduled";
      const nextMs = nextRun ? Date.parse(nextRun) : NaN;
      if (Number.isFinite(nextMs) && nextMs < Date.now()) status = "due";
      if (!Number.isFinite(nextMs) && !lastRun) status = "unknown";
    }
    return {
      task,
      name: hb?.name || task,
      enabled,
      schedule: hb?.schedule || null,
      lastRun,
      nextRun,
      status,
    };
  });
}

async function tryLoadProductServiceFactorySnapshot(integration) {
  const result = {
    success: false,
    url: null,
    fetchedAt: null,
    snapshot: null,
    error: null,
  };

  try {
    const fetched = await fetchFactoryProductSnapshot(integration);
    cacheProductSnapshot(fetched);
    return {
      success: true,
      url: fetched.url,
      fetchedAt: fetched.fetchedAt,
      snapshot: fetched.snapshot,
      error: null,
    };
  } catch (error) {
    const cached = getCachedProductSnapshot();
    result.url = (() => {
      try {
        return buildInternalFactorySnapshotUrl(integration.apiBaseUrl);
      } catch {
        return null;
      }
    })();
    result.error = error instanceof Error ? error.message : String(error);
    if (cached && !cached.stale && cached.snapshot) {
      return {
        ...result,
        snapshot: cached.snapshot,
        fetchedAt: cached.fetchedAt,
        cacheUsed: true,
      };
    }
    return result;
  }
}

async function tryLoadProductServiceWebhookAttempts(integration) {
  const result = {
    success: false,
    url: null,
    fetchedAt: null,
    snapshot: null,
    error: null,
  };

  try {
    const fetched = await fetchFactoryWebhookDeliveryAttempts(integration);
    return {
      success: true,
      url: fetched.url,
      fetchedAt: fetched.fetchedAt,
      snapshot: fetched.snapshot,
      error: null,
    };
  } catch (error) {
    result.url = (() => {
      try {
        return buildInternalWebhookAttemptsUrl(integration.apiBaseUrl);
      } catch {
        return null;
      }
    })();
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

export async function handleGetFactorySnapshot() {
  const started = performance.now();
  const config = loadConfig();
  if (!config) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error: "No automaton configuration found (~/.automaton/automaton.json).",
        generatedAt: new Date().toISOString(),
      },
    };
  }

  const integration = getSynthesisIntegrationConfig();
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  try {
    const heartbeats = db.getHeartbeatEntries().map(summarizeHeartbeat);
    const runtimeSignals = readFactoryRuntimeState(db);
    const kv = runtimeSignals.kv;
    const kvErrors = runtimeSignals.kvErrors;

    const pipelineLast = kv["synthesis.pipeline.last"]?.value;
    const pipelineLastError = kv["synthesis.pipeline.last_error"]?.value;
    const healthSamplesRaw = kv["synthesis.health.samples.v1"]?.value;
    const healthSampleStats = computeUptime7dFromHealthSamples(healthSamplesRaw);

    const productFetch = integration.enabled
      ? await tryLoadProductServiceFactorySnapshot(integration)
      : { success: false, url: null, fetchedAt: null, snapshot: null, error: "Synthesis integration disabled", cacheUsed: false };
    const webhookAttemptsFetch = integration.enabled
      ? await tryLoadProductServiceWebhookAttempts(integration)
      : { success: false, url: null, fetchedAt: null, snapshot: null, error: "Synthesis integration disabled" };
    const cacheInfo = getCachedProductSnapshot();
    const usedCachedProductSnapshot = Boolean(productFetch.cacheUsed === true);
    const productSnapshot = productFetch.snapshot || null;

    const pipelineHealth = {
      checkedAt: toIso(pipelineLast?.checkedAt) || toIso(pipelineLast?.generatedAt) || toIso(pipelineLastError?.checkedAt),
      healthy:
        typeof pipelineLast?.healthy === "boolean"
          ? pipelineLast.healthy
          : (typeof productSnapshot?.service?.status === "string"
              ? ["ok", "healthy", "up"].includes(String(productSnapshot.service.status).toLowerCase())
              : null),
      status: asString(productSnapshot?.service?.status, asString(pipelineLast?.status, null)),
      lastFeatureAt: toIso(productSnapshot?.service?.lastFeatureAt) || toIso(pipelineLast?.lastFeatureAt),
      lastPublishAt: toIso(productSnapshot?.service?.lastPublishAt) || toIso(pipelineLast?.lastPublishAt),
      freshnessMinutes: asFiniteNumber(pipelineLast?.freshnessMinutes, null),
      freshnessThresholdMinutes: asFiniteNumber(integration.pipelineFreshnessMaxMinutes, 20),
      uptime7dPercent:
        asFiniteNumber(pipelineLast?.uptime7d, null) ??
        asFiniteNumber(pipelineLastError?.uptime7d, null) ??
        healthSampleStats.percent,
      uptime7dSampleCount: healthSampleStats.sampleCount,
      lastError: isRecord(pipelineLastError)
        ? {
            checkedAt: toIso(pipelineLastError.checkedAt),
            error: asString(pipelineLastError.error, null),
          }
        : null,
    };

    const streamsItems = Array.isArray(productSnapshot?.streams?.items)
      ? productSnapshot.streams.items.map((stream) => ({
          ...stream,
          status: asString(stream.status, "unknown"),
          name: asString(stream.name, asString(stream.id, "Unnamed stream")),
          id: asString(stream.id, "unknown-stream"),
          family: asString(stream.family, "unknown"),
          sourceRef: asString(stream.sourceRef, ""),
          pollingIntervalSeconds: asFiniteNumber(stream.pollingIntervalSeconds, null),
          qualityScore: asFiniteNumber(stream.qualityScore, null),
          lastObservedAt: toIso(stream.lastObservedAt),
          freshnessSeconds: asFiniteNumber(stream.freshnessSeconds, null),
          observationsLastHour: asFiniteNumber(stream.observationsLastHour, null),
          errorCount24h: asFiniteNumber(stream.errorCount24h, null),
          costPerMonthUsd: asFiniteNumber(stream.costPerMonthUsd, null),
        }))
      : [];

    const sourceFamilies = normalizeStreamFamilies(streamsItems, productSnapshot?.streams?.families || []);
    const sourcesSection = {
      totalStreams:
        asFiniteNumber(productSnapshot?.streams?.total, streamsItems.length) ?? streamsItems.length,
      activeStreams:
        asFiniteNumber(productSnapshot?.streams?.active, streamsItems.filter((s) => ["active", "ok", "enabled", "live"].includes(String(s.status).toLowerCase())).length) ?? 0,
      families: sourceFamilies,
      items: streamsItems,
    };

    const productItems = Array.isArray(productSnapshot?.products?.items)
      ? productSnapshot.products.items.map((product) => {
          const badges = [];
          const freshness = asFiniteNumber(product.freshnessMinutes, null);
          const status = asString(product.status, "unknown");
          if (freshness != null && freshness > 20) badges.push("stale");
          if (asFiniteNumber(product.quality?.qualityScore, null) != null && product.quality.qualityScore < integration.signalQualityMin) {
            badges.push("quality_drift");
          }
          if (status && ["inactive", "disabled", "paused"].includes(status.toLowerCase())) {
            badges.push("inactive");
          }
          const pricingChangedRecent = false;
          if (pricingChangedRecent) badges.push("pricing_changed_recently");
          return {
            ...product,
            productId: asString(product.productId, "unknown-product"),
            status,
            latestPublishAt: toIso(product.latestPublishAt),
            freshnessMinutes: freshness,
            latestScore: asFiniteNumber(product.latestScore, null),
            latestConfidence: asFiniteNumber(product.latestConfidence, null),
            latestRegime: asString(product.latestRegime, null),
            pricing: {
              latestPriceUsdc: asFiniteNumber(product.pricing?.latestPriceUsdc, null),
              historyBasePriceUsdc: asFiniteNumber(product.pricing?.historyBasePriceUsdc, null),
            },
            usage: {
              calls24h: asFiniteNumber(product.usage?.calls24h, null),
              paidCalls24h: asFiniteNumber(product.usage?.paidCalls24h, null),
            },
            economics: {
              revenue24h: asFiniteNumber(product.economics?.revenue24h, null),
              revenue7d: asFiniteNumber(product.economics?.revenue7d, null),
            },
            quality: {
              qualityScore: asFiniteNumber(product.quality?.qualityScore, null),
              medianConfidence24h: asFiniteNumber(product.quality?.medianConfidence24h, null),
            },
            badges,
          };
        })
      : [];

    const outputsSection = {
      totalProducts: asFiniteNumber(productSnapshot?.products?.total, productItems.length) ?? productItems.length,
      activeProducts:
        asFiniteNumber(productSnapshot?.products?.active, productItems.filter((p) => ["active", "live", "enabled"].includes(String(p.status).toLowerCase())).length) ?? 0,
      items: productItems,
    };

    const webhookAttemptsSnapshot = webhookAttemptsFetch.success ? webhookAttemptsFetch.snapshot : null;
    const webhookAttemptsItems = Array.isArray(webhookAttemptsSnapshot?.attempts)
      ? webhookAttemptsSnapshot.attempts.map((attempt) => ({
          id: asString(attempt.id, "unknown-attempt"),
          subscriptionId: asString(attempt.subscriptionId, "unknown-subscription"),
          productId: asString(attempt.productId, "unknown-product"),
          customerId: asString(attempt.customerId, "unknown-customer"),
          triggerType: asString(attempt.triggerType, "unknown"),
          triggerEventId: asString(attempt.triggerEventId, null),
          triggerEventCreatedAt: toIso(attempt.triggerEventCreatedAt),
          attemptNumber: asFiniteNumber(attempt.attemptNumber, null),
          terminal: Boolean(attempt.terminal),
          status: asString(attempt.status, "unknown"),
          httpStatus: asFiniteNumber(attempt.httpStatus, null),
          errorMessage: asString(attempt.errorMessage, null),
          signalPointId: asString(attempt.signalPointId, null),
          signalBucketAt: toIso(attempt.signalBucketAt),
          nextRetryAt: toIso(attempt.nextRetryAt),
          createdAt: toIso(attempt.createdAt),
        }))
      : [];
    const deliverySection = {
      webhooks: {
        available: Boolean(webhookAttemptsFetch.success),
        endpointReachability: webhookAttemptsFetch.success ? "connected" : "degraded",
        fetchedAt: webhookAttemptsFetch.fetchedAt || null,
        persistenceBackend: asString(webhookAttemptsSnapshot?.persistenceBackend, null),
        totalAttempts: asFiniteNumber(webhookAttemptsSnapshot?.total, webhookAttemptsItems.length) ?? webhookAttemptsItems.length,
        statusCounts: {
          delivered: asFiniteNumber(webhookAttemptsSnapshot?.statusCounts?.delivered, 0) ?? 0,
          failed: asFiniteNumber(webhookAttemptsSnapshot?.statusCounts?.failed, 0) ?? 0,
          deadLettered: asFiniteNumber(webhookAttemptsSnapshot?.statusCounts?.deadLettered, 0) ?? 0,
        },
        attempts: webhookAttemptsItems,
        error: webhookAttemptsFetch.success ? null : (webhookAttemptsFetch.error || null),
      },
    };

    const stages = Array.isArray(productSnapshot?.pipeline?.stages) && productSnapshot.pipeline.stages.length > 0
      ? productSnapshot.pipeline.stages.map((stage) => ({
          stage: asString(stage.stage, "unknown"),
          status: asString(stage.status, "unknown"),
          cadenceSeconds: asFiniteNumber(stage.cadenceSeconds, null),
          lastSuccessAt: toIso(stage.lastSuccessAt),
          lastRunAt: toIso(stage.lastRunAt),
          lastDurationMs: asFiniteNumber(stage.lastDurationMs, null),
          backlogCount: asFiniteNumber(stage.backlogCount, null),
          errorCount24h: asFiniteNumber(stage.errorCount24h, null),
        }))
      : buildDefaultPipelineStages(pipelineHealth);

    const pipelineSection = {
      health: pipelineHealth,
      stages,
      automationHeartbeats: mapPipelineAutomationHeartbeats(heartbeats),
    };

    const previousQuality = asFiniteNumber(kv["synthesis.source_quality.last"]?.value?.signalQualityScore, null);
    const economicsBase = pickCurrentEconomics(productSnapshot, runtimeSignals);
    const economicsSection = {
      ...economicsBase,
      previousSignalQualityScore: previousQuality,
      revenue7d: economicsBase.revenuePerDay == null ? null : round(economicsBase.revenuePerDay * 7, 6),
      cost7d: economicsBase.costPerDay == null ? null : round(economicsBase.costPerDay * 7, 6),
      netProfit7d:
        economicsBase.revenuePerDay == null || economicsBase.costPerDay == null
          ? null
          : round((economicsBase.revenuePerDay - economicsBase.costPerDay) * 7, 6),
      uptime7dPercent: pipelineHealth.uptime7dPercent,
    };

    const autonomySection = normalizeAutonomySection({
      integration,
      kv,
      economics: economicsSection,
    });

    const integrationSummary = {
      enabled: Boolean(integration.enabled),
      apiBaseUrl: integration.apiBaseUrl,
      internalSnapshotPath: FACTORY_INTERNAL_SNAPSHOT_PATH,
      productServiceReachability: productFetch.success
        ? (usedCachedProductSnapshot ? "degraded" : "connected")
        : (usedCachedProductSnapshot ? "degraded" : "offline"),
      pipelineFreshnessMaxMinutes: integration.pipelineFreshnessMaxMinutes,
      thresholds: {
        marginFloor: integration.marginFloor,
        retentionFloor: integration.retentionFloor,
        signalQualityMin: integration.signalQualityMin,
        signalQualityDriftMax: integration.signalQualityDriftMax,
        minPaidCustomers: integration.minPaidCustomers,
        nextSourceMonthlyCost: integration.nextSourceMonthlyCost,
      },
      autoReprice: {
        enabled: Boolean(integration.autoRepriceEnabled),
        productId: integration.autoRepriceProductId,
        accessMode: integration.autoRepriceAccessMode,
        stepPct: integration.autoRepriceStepPct,
        maxUsdc: integration.autoRepriceMaxUsdc,
      },
      autoExpansion: {
        applyEnabled: Boolean(integration.autoExpansionApplyEnabled),
        family: integration.autoExpansionFamily,
        sourceRef: integration.autoExpansionSourceRef,
        pollingIntervalSeconds: integration.autoExpansionPollingIntervalSeconds,
        qualityScore: integration.autoExpansionQualityScore,
        namePrefix: integration.autoExpansionNamePrefix,
        runSynthesis: Boolean(integration.autoExpansionRunSynthesis),
        targetProductIds: Array.isArray(integration.autoExpansionTargetProductIds)
          ? integration.autoExpansionTargetProductIds
          : [],
      },
    };

    const alerts = buildFactoryAlerts({
      integration,
      sources: sourcesSection,
      outputs: outputsSection,
      pipeline: pipelineSection,
      economics: economicsSection,
      autonomy: autonomySection,
      delivery: deliverySection,
      productFetch,
      webhookAttemptsFetch,
      usedCachedProductSnapshot,
      kvErrors,
    });

    integrationSummary.factoryStatus = deriveFactoryStatusFromAlerts(
      alerts,
      integrationSummary.enabled,
      integrationSummary.productServiceReachability,
    );

    const dataSources = buildFactoryDataSources({
      runtimeDbPath: dbPath,
      kvErrors,
      productFetch,
      webhookAttemptsFetch,
      cacheInfo,
      usedCachedProductSnapshot,
    });

    const mode = !integration.enabled
      ? "offline"
      : (productFetch.success || usedCachedProductSnapshot)
        ? "live"
        : "degraded_runtime_only";

    const factorySnapshot = {
      generatedAt: new Date().toISOString(),
      snapshotMs: Math.round(performance.now() - started),
      mode,
      integration: integrationSummary,
      sources: sourcesSection,
      pipeline: pipelineSection,
      outputs: outputsSection,
      delivery: deliverySection,
      economics: economicsSection,
      autonomy: autonomySection,
      alerts,
      dataSources,
    };

    return {
      statusCode: 200,
      body: {
        ok: true,
        factory: factorySnapshot,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        generatedAt: new Date().toISOString(),
      },
    };
  } finally {
    db.close();
  }
}
