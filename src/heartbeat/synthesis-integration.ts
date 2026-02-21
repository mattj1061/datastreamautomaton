import type { AutomatonDatabase } from "../types.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const SYNTHESIS_HEALTH_SAMPLES_KV = "synthesis.health.samples.v1";
export const SYNTHESIS_LAST_METRICS_KV = "synthesis.metrics.last.v1";

export interface SynthesisIntegrationConfig {
  enabled: boolean;
  apiBaseUrl: string;
  internalToken: string;
  pipelineFreshnessMaxMinutes: number;
  marginFloor: number;
  retentionFloor: number;
  signalQualityMin: number;
  signalQualityDriftMax: number;
  demandCustomerIncreaseTrigger: number;
  demandRevenueGrowthTrigger: number;
  minPaidCustomers: number;
  nextSourceMonthlyCost: number;
  autoRepriceEnabled: boolean;
  autoRepriceProductId: string;
  autoRepriceAccessMode: "latest" | "history";
  autoRepriceStepPct: number;
  autoRepriceMaxUsdc: number;
  autoExpansionApplyEnabled: boolean;
  autoExpansionFamily:
    | "market_microstructure"
    | "onchain_flow"
    | "macro_news_risk";
  autoExpansionSourceRef: string;
  autoExpansionPollingIntervalSeconds: number;
  autoExpansionQualityScore: number;
  autoExpansionNamePrefix: string;
  autoExpansionRunSynthesis: boolean;
  autoExpansionTargetProductIds: string[];
  requestTimeoutMs: number;
}

export interface ServiceHealthSnapshot {
  checkedAt: string;
  healthy: boolean;
  status?: string;
  lastPublishAt?: string;
  lastFeatureAt?: string;
  freshnessMinutes?: number;
}

export interface InternalMetricsSnapshot {
  generatedAt: string;
  revenuePerDay: number;
  costPerDay: number;
  grossMargin: number;
  signalQualityScore: number;
  customerRetention: number;
  paidCustomers7d: number;
}

export interface ExpansionEvaluatePayload {
  revenue7d: number;
  variableCost7d: number;
  uptime7d: number;
  medianConfidence: number;
  paidCustomers: number;
  nextSourceMonthlyCost: number;
}

export interface ExpansionDecisionSnapshot {
  status?: string;
  reason?: string;
  expansionBudget?: number;
  shouldAddSource?: boolean;
  [key: string]: unknown;
}

export interface ProductCatalogItem {
  id: string;
  status?: string;
  pricing: {
    latest: number;
    historyBase: number;
  };
}

export interface ProductCatalogSnapshot {
  generatedAt: string;
  products: ProductCatalogItem[];
}

export interface RepricePayload {
  productId: string;
  accessMode: "latest" | "history";
  basePriceUsdc: number;
  historyWindowMultiplier?: number;
  reason: string;
}

export interface RepriceResult {
  id?: string;
  productId?: string;
  accessMode?: "latest" | "history";
  basePriceUsdc?: number;
  historyWindowMultiplier?: number;
  [key: string]: unknown;
}

export interface RegisterStreamPayload {
  name: string;
  family: "market_microstructure" | "onchain_flow" | "macro_news_risk";
  sourceRef: string;
  pollingIntervalSeconds?: number;
  qualityScore?: number;
}

export interface RegisterStreamResult {
  id: string;
  name?: string;
  family?: string;
  status?: string;
  sourceRef?: string;
  [key: string]: unknown;
}

export interface RunSynthesisPayload {
  productIds?: string[];
}

interface HealthSample {
  checkedAt: string;
  healthy: boolean;
  freshnessMinutes: number | null;
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

function readCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function findFirstValueByKeys(
  root: unknown,
  keys: ReadonlySet<string>,
): unknown {
  if (!isRecord(root) && !Array.isArray(root)) return undefined;

  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findFirstValueByKeys(entry, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, value] of Object.entries(root)) {
    if (keys.has(key)) {
      return value;
    }
    const found = findFirstValueByKeys(value, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function readTextSafely(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getSynthesisIntegrationConfig(): SynthesisIntegrationConfig {
  const autoRepriceAccessModeRaw = (
    process.env.AUTOMATON_AUTO_REPRICE_ACCESS_MODE || "latest"
  ).toLowerCase();
  const autoRepriceAccessMode =
    autoRepriceAccessModeRaw === "history" ? "history" : "latest";

  const autoExpansionFamilyRaw = (
    process.env.AUTOMATON_AUTO_EXPANSION_FAMILY || "market_microstructure"
  ).toLowerCase();
  const autoExpansionFamily =
    autoExpansionFamilyRaw === "onchain_flow" ||
    autoExpansionFamilyRaw === "macro_news_risk"
      ? autoExpansionFamilyRaw
      : "market_microstructure";

  return {
    enabled: readBooleanEnv("AUTOMATON_SYNTHESIS_INTEGRATION_ENABLED", false),
    apiBaseUrl: trimTrailingSlash(
      process.env.AUTOMATON_PRODUCT_API_BASE_URL || "http://127.0.0.1:3001",
    ),
    internalToken:
      process.env.AUTOMATON_INTERNAL_TOKEN || "dev-internal-token",
    pipelineFreshnessMaxMinutes: readNumberEnv(
      "AUTOMATON_PIPELINE_FRESHNESS_MAX_MINUTES",
      20,
    ),
    marginFloor: readNumberEnv("AUTOMATON_MARGIN_MIN", 0.2),
    retentionFloor: readNumberEnv("AUTOMATON_RETENTION_MIN", 0.2),
    signalQualityMin: readNumberEnv("AUTOMATON_SIGNAL_QUALITY_MIN", 0.62),
    signalQualityDriftMax: readNumberEnv(
      "AUTOMATON_SIGNAL_QUALITY_DRIFT_MAX",
      0.08,
    ),
    demandCustomerIncreaseTrigger: readNumberEnv(
      "AUTOMATON_DEMAND_CUSTOMER_DELTA_TRIGGER",
      1,
    ),
    demandRevenueGrowthTrigger: readNumberEnv(
      "AUTOMATON_DEMAND_REVENUE_GROWTH_TRIGGER",
      0.2,
    ),
    minPaidCustomers: readNumberEnv("AUTOMATON_MIN_PAID_CUSTOMERS", 1),
    nextSourceMonthlyCost: readNumberEnv(
      "AUTOMATON_NEXT_SOURCE_MONTHLY_COST",
      100,
    ),
    autoRepriceEnabled: readBooleanEnv("AUTOMATON_AUTO_REPRICE_ENABLED", false),
    autoRepriceProductId:
      process.env.AUTOMATON_AUTO_REPRICE_PRODUCT_ID ||
      "crossdomain_risk_nowcast_v1",
    autoRepriceAccessMode,
    autoRepriceStepPct: Math.max(
      0.01,
      readNumberEnv("AUTOMATON_AUTO_REPRICE_STEP_PCT", 0.1),
    ),
    autoRepriceMaxUsdc: Math.max(
      0.000001,
      readNumberEnv("AUTOMATON_AUTO_REPRICE_MAX_USDC", 0.05),
    ),
    autoExpansionApplyEnabled: readBooleanEnv(
      "AUTOMATON_AUTO_EXPANSION_APPLY_ENABLED",
      false,
    ),
    autoExpansionFamily,
    autoExpansionSourceRef:
      process.env.AUTOMATON_AUTO_EXPANSION_SOURCE_REF ||
      "connector://market/binance-book-ticker?symbol=ETHUSDT",
    autoExpansionPollingIntervalSeconds: Math.max(
      10,
      Math.round(
        readNumberEnv(
          "AUTOMATON_AUTO_EXPANSION_POLLING_INTERVAL_SECONDS",
          60,
        ),
      ),
    ),
    autoExpansionQualityScore: Math.max(
      0,
      Math.min(1, readNumberEnv("AUTOMATON_AUTO_EXPANSION_QUALITY_SCORE", 0.72)),
    ),
    autoExpansionNamePrefix:
      process.env.AUTOMATON_AUTO_EXPANSION_NAME_PREFIX ||
      "Auto Expansion Source",
    autoExpansionRunSynthesis: readBooleanEnv(
      "AUTOMATON_AUTO_EXPANSION_RUN_SYNTHESIS",
      true,
    ),
    autoExpansionTargetProductIds: readCsvEnv(
      "AUTOMATON_AUTO_EXPANSION_TARGET_PRODUCT_IDS",
    ),
    requestTimeoutMs: readNumberEnv(
      "AUTOMATON_INTERNAL_REQUEST_TIMEOUT_MS",
      10000,
    ),
  };
}

function buildUrl(baseUrl: string, path: string): string {
  if (path.startsWith("/")) {
    return `${baseUrl}${path}`;
  }
  return `${baseUrl}/${path}`;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const bodyText = await response.text();
    if (!response.ok) {
      const snippet = bodyText.slice(0, 300).replace(/\s+/g, " ").trim();
      throw new Error(`HTTP ${response.status} from ${url}: ${snippet}`);
    }
    if (!bodyText) {
      return {} as T;
    }
    return JSON.parse(bodyText) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchServiceHealth(
  config: SynthesisIntegrationConfig,
): Promise<ServiceHealthSnapshot> {
  const payload = await fetchJson<Record<string, unknown>>(
    buildUrl(config.apiBaseUrl, "/v1/health"),
    { method: "GET" },
    config.requestTimeoutMs,
  );

  const statusRaw =
    (isRecord(payload) ? payload.status : undefined) ||
    findFirstValueByKeys(payload, new Set(["status", "state"]));
  const status = readTextSafely(statusRaw);

  const lastPublishAt = toIsoTimestamp(
    findFirstValueByKeys(payload, new Set(["lastPublishAt", "last_publish_at"])),
  );
  const lastFeatureAt = toIsoTimestamp(
    findFirstValueByKeys(payload, new Set(["lastFeatureAt", "last_feature_at"])),
  );

  const referenceTs = lastPublishAt || lastFeatureAt;
  const freshnessMinutes = referenceTs
    ? Math.max(
        0,
        (Date.now() - new Date(referenceTs).getTime()) / (60 * 1000),
      )
    : undefined;

  let healthy = true;
  if (status) {
    healthy = new Set(["ok", "healthy", "up"]).has(status.toLowerCase());
  }

  return {
    checkedAt: new Date().toISOString(),
    healthy,
    status,
    lastPublishAt,
    lastFeatureAt,
    freshnessMinutes,
  };
}

export async function fetchInternalMetrics(
  config: SynthesisIntegrationConfig,
): Promise<InternalMetricsSnapshot> {
  const payload = await fetchJson<Record<string, unknown>>(
    buildUrl(config.apiBaseUrl, "/v1/internal/metrics"),
    {
      method: "GET",
      headers: {
        "x-internal-token": config.internalToken,
      },
    },
    config.requestTimeoutMs,
  );

  return {
    generatedAt:
      toIsoTimestamp(payload.generatedAt) || new Date().toISOString(),
    revenuePerDay: toFiniteNumber(payload.revenuePerDay),
    costPerDay: toFiniteNumber(payload.costPerDay),
    grossMargin: toFiniteNumber(payload.grossMargin),
    signalQualityScore: toFiniteNumber(payload.signalQualityScore),
    customerRetention: toFiniteNumber(payload.customerRetention),
    paidCustomers7d: toFiniteNumber(payload.paidCustomers7d),
  };
}

export async function evaluateExpansionViaApi(
  config: SynthesisIntegrationConfig,
  payload: ExpansionEvaluatePayload,
): Promise<ExpansionDecisionSnapshot> {
  return fetchJson<ExpansionDecisionSnapshot>(
    buildUrl(config.apiBaseUrl, "/v1/internal/expansion/evaluate"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": config.internalToken,
      },
      body: JSON.stringify(payload),
    },
    config.requestTimeoutMs,
  );
}

export async function fetchProductsCatalog(
  config: SynthesisIntegrationConfig,
): Promise<ProductCatalogSnapshot> {
  const payload = await fetchJson<Record<string, unknown>>(
    buildUrl(config.apiBaseUrl, "/v1/products"),
    { method: "GET" },
    config.requestTimeoutMs,
  );

  const productsRaw = Array.isArray(payload.products) ? payload.products : [];
  const products: ProductCatalogItem[] = [];

  for (const productRaw of productsRaw) {
    if (!isRecord(productRaw)) {
      continue;
    }
    const id = readTextSafely(productRaw.id);
    if (!id) {
      continue;
    }

    const pricingRaw = isRecord(productRaw.pricing)
      ? productRaw.pricing
      : {};
    const latest = toFiniteNumber(pricingRaw.latest);
    const historyBase = toFiniteNumber(pricingRaw.historyBase);
    products.push({
      id,
      status: readTextSafely(productRaw.status),
      pricing: {
        latest: round(Math.max(0, latest), 6),
        historyBase: round(Math.max(0, historyBase), 6),
      },
    });
  }

  return {
    generatedAt:
      toIsoTimestamp(payload.generatedAt) || new Date().toISOString(),
    products,
  };
}

export async function repriceViaApi(
  config: SynthesisIntegrationConfig,
  payload: RepricePayload,
): Promise<RepriceResult> {
  const response = await fetchJson<unknown>(
    buildUrl(config.apiBaseUrl, "/v1/internal/pricing/reprice"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": config.internalToken,
      },
      body: JSON.stringify(payload),
    },
    config.requestTimeoutMs,
  );

  if (!isRecord(response)) {
    return {};
  }
  return response as RepriceResult;
}

export async function registerStreamViaApi(
  config: SynthesisIntegrationConfig,
  payload: RegisterStreamPayload,
): Promise<RegisterStreamResult> {
  const response = await fetchJson<unknown>(
    buildUrl(config.apiBaseUrl, "/v1/internal/streams/register"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": config.internalToken,
      },
      body: JSON.stringify(payload),
    },
    config.requestTimeoutMs,
  );

  if (!isRecord(response)) {
    throw new Error("Unexpected stream registration response payload.");
  }

  const id = readTextSafely(response.id);
  if (!id) {
    throw new Error("Internal stream registration response missing id.");
  }

  return {
    ...response,
    id,
  } as RegisterStreamResult;
}

export async function runSynthesisViaApi(
  config: SynthesisIntegrationConfig,
  payload?: RunSynthesisPayload,
): Promise<Record<string, unknown>> {
  const response = await fetchJson<unknown>(
    buildUrl(config.apiBaseUrl, "/v1/internal/synthesis/run"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": config.internalToken,
      },
      body: JSON.stringify(payload || {}),
    },
    config.requestTimeoutMs,
  );

  if (!isRecord(response)) {
    return {};
  }
  return response;
}

export function readLastMetrics(
  db: AutomatonDatabase,
): InternalMetricsSnapshot | null {
  return parseJson<InternalMetricsSnapshot>(db.getKV(SYNTHESIS_LAST_METRICS_KV));
}

export function writeLastMetrics(
  db: AutomatonDatabase,
  metrics: InternalMetricsSnapshot,
): void {
  db.setKV(SYNTHESIS_LAST_METRICS_KV, JSON.stringify(metrics));
}

function readHealthSamples(db: AutomatonDatabase): HealthSample[] {
  return (
    parseJson<HealthSample[]>(db.getKV(SYNTHESIS_HEALTH_SAMPLES_KV)) || []
  );
}

function writeHealthSamples(db: AutomatonDatabase, samples: HealthSample[]): void {
  db.setKV(SYNTHESIS_HEALTH_SAMPLES_KV, JSON.stringify(samples));
}

export function recordHealthSample(
  db: AutomatonDatabase,
  healthy: boolean,
  freshnessMinutes: number | null,
): number {
  const nowMs = Date.now();
  const cutoffMs = nowMs - SEVEN_DAYS_MS;

  const next = readHealthSamples(db)
    .filter((sample) => {
      const ms = Date.parse(sample.checkedAt);
      return Number.isFinite(ms) && ms >= cutoffMs;
    })
    .concat({
      checkedAt: new Date(nowMs).toISOString(),
      healthy,
      freshnessMinutes,
    });

  writeHealthSamples(db, next);

  const healthyCount = next.filter((sample) => sample.healthy).length;
  if (next.length === 0) return 0;
  return (healthyCount / next.length) * 100;
}

export function getUptime7dPercent(db: AutomatonDatabase): number {
  const nowMs = Date.now();
  const cutoffMs = nowMs - SEVEN_DAYS_MS;
  const retained = readHealthSamples(db).filter((sample) => {
    const ms = Date.parse(sample.checkedAt);
    return Number.isFinite(ms) && ms >= cutoffMs;
  });

  writeHealthSamples(db, retained);
  if (retained.length === 0) return 0;
  const healthyCount = retained.filter((sample) => sample.healthy).length;
  return (healthyCount / retained.length) * 100;
}

export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
