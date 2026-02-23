import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Blocks,
  CircleDollarSign,
  Database,
  Factory as FactoryIcon,
  Filter,
  Gauge,
  Radar,
  RefreshCcw,
  Server,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useFactorySnapshot } from '../hooks/useFactorySnapshot';
import type {
  AutomatonDashboardRuntime,
  FactoryAlert,
  FactoryAutomationHeartbeatStatus,
  FactoryDataSourceStatus,
  FactoryInputFamilySummary,
  FactoryInputStream,
  FactoryOutputProduct,
  FactoryPipelineStageStatus,
  FactorySettlementReconciliationException,
  FactoryWebhookDeliveryAttempt,
} from '../types/automaton';

type FamilyFilter = 'all' | 'market_microstructure' | 'onchain_flow' | 'macro_news_risk';
type ProductStatusFilter = 'all' | 'active' | 'paused' | 'stale' | 'degraded';

interface FactoryViewProps {
  runtime: AutomatonDashboardRuntime;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function relativeTime(value: string | null | undefined): string {
  const ms = toMs(value);
  if (ms == null) return '—';
  const delta = Math.floor((Date.now() - ms) / 1000);
  const abs = Math.abs(delta);
  const sign = delta < 0 ? '-' : '';
  if (abs < 60) return `${sign}${abs}s`;
  if (abs < 3600) return `${sign}${Math.floor(abs / 60)}m`;
  if (abs < 86400) return `${sign}${Math.floor(abs / 3600)}h`;
  return `${sign}${Math.floor(abs / 86400)}d`;
}

function formatTimestamp(value: string | null | undefined): string {
  const ms = toMs(value);
  if (ms == null) return '—';
  return new Date(ms).toLocaleString();
}

function formatUsd(value: number | null | undefined, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `$${Number(value || 0).toFixed(digits)}`;
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function formatPctPoints(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value || 0).toFixed(digits)}%`;
}

function formatNum(value: number | null | undefined, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / (1024 ** 2)).toFixed(1)} MiB`;
  return `${(n / (1024 ** 3)).toFixed(2)} GiB`;
}

function formatMaybeMinutes(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value || 0).toFixed(1)}m`;
}

function formatMaybeSeconds(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  if ((value || 0) >= 60) return `${(Number(value || 0) / 60).toFixed(1)}m`;
  return `${Number(value || 0).toFixed(0)}s`;
}

function formatMaybeMs(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${Math.round(n)}ms`;
}

function formatMaybeHours(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value || 0);
  if (n < 1) return `${(n * 60).toFixed(1)}m`;
  return `${n.toFixed(1)}h`;
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (['ok', 'healthy', 'active', 'enabled', 'live', 'nominal', 'connected'].includes(s)) return 'border-green-500/30 bg-green-500/10 text-green-300';
  if (['attention', 'due', 'degraded'].includes(s)) return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300';
  if (['warning', 'error', 'failed', 'offline', 'stale'].includes(s)) return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (['info'].includes(s)) return 'border-neonCyan/30 bg-neonCyan/10 text-neonCyan';
  return 'border-gray-700 bg-black/20 text-gray-300';
}

function severityBadgeClass(severity: string): string {
  return statusBadgeClass(severity);
}

function classifyFactorySource(apiBaseUrl: string | null | undefined): { kind: 'local' | 'sandbox' | 'remote' | 'unknown'; label: string; host: string } {
  if (!apiBaseUrl) return { kind: 'unknown', label: 'UNKNOWN', host: '—' };
  try {
    const url = new URL(apiBaseUrl);
    const host = url.host || url.hostname || apiBaseUrl;
    const hostname = (url.hostname || '').toLowerCase();
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return { kind: 'local', label: 'LOCAL', host };
    }
    if (hostname.endsWith('.life.conway.tech')) {
      return { kind: 'sandbox', label: 'SANDBOX', host };
    }
    return { kind: 'remote', label: 'REMOTE', host };
  } catch {
    return { kind: 'unknown', label: 'UNKNOWN', host: apiBaseUrl };
  }
}

function factorySourceBadgeClass(kind: 'local' | 'sandbox' | 'remote' | 'unknown'): string {
  if (kind === 'local') return 'border-neonCyan/30 text-neonCyan bg-neonCyan/10';
  if (kind === 'sandbox') return 'border-green-500/30 text-green-300 bg-green-500/10';
  if (kind === 'remote') return 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10';
  return 'border-gray-700 text-gray-300 bg-black/20';
}

function humanizeStatus(status: string | null | undefined): string {
  if (!status) return 'UNKNOWN';
  return status.replace(/_/g, ' ').toUpperCase();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(obj: Record<string, unknown> | null, key: string): string | null {
  const v = obj?.[key];
  return typeof v === 'string' ? v : null;
}

function readNumber(obj: Record<string, unknown> | null, key: string): number | null {
  const v = obj?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const p = Number(v);
    if (Number.isFinite(p)) return p;
  }
  return null;
}


function jsonSnippet(value: unknown, max = 280): string {
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return String(value);
  }
}

function matchesSearch(hayParts: Array<string | number | null | undefined>, q: string): boolean {
  if (!q) return true;
  const hay = hayParts.map((v) => (v == null ? '' : String(v))).join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

function productMatchesStatusFilter(product: FactoryOutputProduct, filter: ProductStatusFilter): boolean {
  if (filter === 'all') return true;
  const status = String(product.status || '').toLowerCase();
  const badges = Array.isArray(product.badges) ? product.badges.map((b) => String(b).toLowerCase()) : [];
  if (filter === 'active') return ['active', 'enabled', 'live', 'ok'].includes(status);
  if (filter === 'paused') return ['paused', 'inactive', 'disabled'].includes(status) || badges.includes('inactive');
  if (filter === 'stale') return badges.includes('stale') || ((product.freshnessMinutes ?? 0) > 20);
  if (filter === 'degraded') return ['degraded', 'warning', 'error'].includes(status) || badges.includes('quality_drift');
  return true;
}

function KpiCard({ title, value, subtitle, icon, tone = 'default' }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; tone?: 'default' | 'cyan' | 'green' | 'yellow' | 'red'; }) {
  const toneClass =
    tone === 'cyan'
      ? 'text-neonCyan border-neonCyan/20'
      : tone === 'green'
        ? 'text-green-300 border-green-500/20'
        : tone === 'yellow'
          ? 'text-yellow-300 border-yellow-500/20'
          : tone === 'red'
            ? 'text-red-300 border-red-500/20'
            : 'text-white border-gray-800';

  return (
    <div className={`border ${toneClass} bg-black/30 rounded-xl p-4 min-h-[92px]`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[10px] font-mono tracking-widest text-gray-500">{title}</div>
        <div className="text-gray-400">{icon}</div>
      </div>
      <div className="text-lg font-mono text-white leading-tight">{value}</div>
      {subtitle ? <div className="text-[11px] text-gray-500 mt-1">{subtitle}</div> : null}
    </div>
  );
}

function SectionShell({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode; }) {
  return (
    <div className="border border-panelBorder bg-panelBg rounded-xl p-4 flex flex-col min-h-[220px]">
      <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-gray-800">
        <h3 className="font-mono text-xs tracking-widest text-gray-400">{title}</h3>
        {right}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function FlowNodeCard({ title, icon, value, subtitle, status }: { title: string; icon: React.ReactNode; value: string; subtitle: string; status: string; }) {
  return (
    <div className="min-w-[180px] flex-1 border border-gray-800 rounded-xl p-3 bg-black/20">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[10px] font-mono tracking-widest text-gray-500">{title}</div>
        <div className="text-gray-400">{icon}</div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-base font-mono text-gray-100">{value}</div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(status)}`}>
          {humanizeStatus(status)}
        </span>
      </div>
      <div className="text-[11px] text-gray-500 mt-1">{subtitle}</div>
    </div>
  );
}

function FlowConnector() {
  return (
    <div className="hidden 2xl:flex items-center justify-center text-gray-600 px-1">
      <ArrowRight className="w-4 h-4" />
    </div>
  );
}

function AlertDigestStrip({ alerts }: { alerts: FactoryAlert[] }) {
  const counts = alerts.reduce(
    (acc, alert) => {
      const key = String(alert.severity || '').toLowerCase();
      if (key === 'high') acc.high += 1;
      else if (key === 'medium') acc.medium += 1;
      else if (key === 'info') acc.info += 1;
      else acc.other += 1;
      return acc;
    },
    { high: 0, medium: 0, info: 0, other: 0 }
  );
  const top = alerts.slice(0, 3);

  return (
    <div className="border border-panelBorder bg-panelBg rounded-xl p-4">
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-4">
        <div className="flex items-center gap-2 min-w-[180px]">
          <Gauge className="w-4 h-4 text-neonCyan" />
          <span className="font-mono text-xs tracking-widest text-gray-400">OPERATOR PRIORITIES</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-1 rounded border ${counts.high > 0 ? statusBadgeClass('warning') : statusBadgeClass('ok')}`}>HIGH {counts.high}</span>
          <span className={`text-[10px] font-mono px-2 py-1 rounded border ${counts.medium > 0 ? statusBadgeClass('attention') : statusBadgeClass('ok')}`}>MED {counts.medium}</span>
          <span className={`text-[10px] font-mono px-2 py-1 rounded border ${statusBadgeClass('info')}`}>INFO {counts.info}</span>
          <span className="text-[10px] font-mono px-2 py-1 rounded border border-gray-700 text-gray-400">TOTAL {alerts.length}</span>
        </div>
        <div className="flex-1 min-w-0">
          {top.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {top.map((alert) => (
                <span key={`${alert.code}-${alert.lastSeenAt}`} className={`max-w-full text-[10px] font-mono px-2 py-1 rounded border ${severityBadgeClass(alert.severity)}`} title={alert.message}>
                  {alert.code}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-green-300 font-mono">No active factory alerts.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageCard({ stage }: { stage: FactoryPipelineStageStatus }) {
  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-black/20">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="font-mono text-xs text-gray-200">{stage.stage}</div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(stage.status)}`}>{humanizeStatus(stage.status)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <MetricRow label="cadence" value={formatMaybeSeconds(stage.cadenceSeconds)} />
        <MetricRow label="duration" value={formatMaybeMs(stage.lastDurationMs)} />
        <MetricRow label="backlog" value={formatNum(stage.backlogCount, 0)} />
        <MetricRow label="errors24h" value={formatNum(stage.errorCount24h, 0)} />
        <MetricRow label="last success" value={relativeTime(stage.lastSuccessAt)} />
        <MetricRow label="last run" value={relativeTime(stage.lastRunAt)} />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-800 rounded px-2 py-1.5 bg-black/10">
      <div className="text-[10px] font-mono text-gray-500">{label}</div>
      <div className="text-[11px] font-mono text-gray-200 mt-0.5">{value}</div>
    </div>
  );
}

function HeartbeatRow({ hb }: { hb: FactoryAutomationHeartbeatStatus }) {
  return (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-2 items-center border border-gray-800 rounded px-2 py-2 text-[11px]">
      <div>
        <div className="font-mono text-gray-200 truncate">{hb.task}</div>
        <div className="text-gray-500 truncate">{hb.schedule || '—'}</div>
      </div>
      <div><span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(hb.status)}`}>{humanizeStatus(hb.status)}</span></div>
      <div className="font-mono text-gray-300">{relativeTime(hb.lastRun)}</div>
      <div className="font-mono text-gray-500">{relativeTime(hb.nextRun)}</div>
    </div>
  );
}

function StreamTable({ streams }: { streams: FactoryInputStream[] }) {
  if (streams.length === 0) {
    return <div className="text-sm text-gray-500 font-mono py-4">No streams match current filters.</div>;
  }
  return (
    <div className="space-y-2">
      {streams.map((stream) => (
        <div key={stream.id} className="border border-gray-800 rounded p-2 bg-black/20">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-100 font-mono truncate">{stream.name}</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(stream.status)}`}>{humanizeStatus(stream.status)}</span>
              </div>
              <div className="text-[11px] text-gray-500 font-mono break-all">{stream.id}</div>
              <div className="text-[11px] text-gray-400 mt-1 break-all">{stream.sourceRef || '—'}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 mt-2 text-[11px]">
            <MetricRow label="poll" value={formatMaybeSeconds(stream.pollingIntervalSeconds)} />
            <MetricRow label="quality" value={stream.qualityScore == null ? '—' : stream.qualityScore.toFixed(3)} />
            <MetricRow label="freshness" value={formatMaybeSeconds(stream.freshnessSeconds)} />
            <MetricRow label="obs1h" value={formatNum(stream.observationsLastHour, 0)} />
            <MetricRow label="err24h" value={formatNum(stream.errorCount24h, 0)} />
            <MetricRow label="cost/mo" value={formatUsd(stream.costPerMonthUsd)} />
          </div>
          <div className="mt-2 text-[11px] text-gray-500">last observed: {formatTimestamp(stream.lastObservedAt)}</div>
        </div>
      ))}
    </div>
  );
}

function ProductRow({ product }: { product: FactoryOutputProduct }) {
  return (
    <div className="border border-gray-800 rounded p-3 bg-black/20">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-100 font-mono truncate">{product.productId}</span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(product.status)}`}>{humanizeStatus(product.status)}</span>
            {product.badges.map((badge) => (
              <span key={`${product.productId}-${badge}`} className="text-[10px] font-mono px-2 py-0.5 rounded border border-gray-700 text-gray-300 bg-black/20">
                {badge}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">publish {relativeTime(product.latestPublishAt)} • freshness {formatMaybeMinutes(product.freshnessMinutes)}</div>
        </div>
        <div className="text-right text-[11px] font-mono">
          <div className="text-neonCyan">latest {product.pricing.latestPriceUsdc == null ? '—' : `${product.pricing.latestPriceUsdc.toFixed(6)} USDC`}</div>
          <div className="text-gray-400">history {product.pricing.historyBasePriceUsdc == null ? '—' : `${product.pricing.historyBasePriceUsdc.toFixed(6)} USDC`}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mt-3 text-[11px]">
        <MetricRow label="score" value={product.latestScore == null ? '—' : product.latestScore.toFixed(3)} />
        <MetricRow label="confidence" value={product.latestConfidence == null ? '—' : product.latestConfidence.toFixed(3)} />
        <MetricRow label="regime" value={product.latestRegime || '—'} />
        <MetricRow label="quality" value={product.quality.qualityScore == null ? '—' : product.quality.qualityScore.toFixed(3)} />
        <MetricRow label="calls24h" value={formatNum(product.usage.calls24h, 0)} />
        <MetricRow label="paid24h" value={formatNum(product.usage.paidCalls24h, 0)} />
        <MetricRow label="rev24h" value={formatUsd(product.economics.revenue24h, 4)} />
        <MetricRow label="rev7d" value={formatUsd(product.economics.revenue7d, 4)} />
      </div>
    </div>
  );
}

function WebhookAttemptRow({ attempt }: { attempt: FactoryWebhookDeliveryAttempt }) {
  return (
    <div className="border border-gray-800 rounded p-2 bg-black/20 text-[11px]">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(attempt.status)}`}>{humanizeStatus(attempt.status)}</span>
            {attempt.terminal ? <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-red-500/20 text-red-300">TERMINAL</span> : null}
            <span className="text-[10px] font-mono text-gray-500">#{attempt.attemptNumber ?? '—'}</span>
            {attempt.httpStatus != null ? <span className="text-[10px] font-mono text-gray-400">HTTP {attempt.httpStatus}</span> : null}
          </div>
          <div className="text-gray-200 font-mono mt-1 break-all">{attempt.productId} • {attempt.subscriptionId}</div>
          <div className="text-gray-500 mt-1 break-all">customer {attempt.customerId} • trigger {attempt.triggerType}</div>
          {attempt.errorMessage ? <div className="text-red-200 mt-1 break-words">{attempt.errorMessage}</div> : null}
        </div>
        <div className="text-right text-[10px] font-mono text-gray-500">
          <div>{relativeTime(attempt.createdAt)}</div>
          <div>{formatTimestamp(attempt.createdAt)}</div>
          {attempt.nextRetryAt ? <div className="text-yellow-300 mt-1">retry {relativeTime(attempt.nextRetryAt)}</div> : null}
        </div>
      </div>
    </div>
  );
}

function SettlementExceptionRow({ item }: { item: FactorySettlementReconciliationException }) {
  return (
    <div className="border border-gray-800 rounded p-2 bg-black/20 text-[11px]">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(item.status)}`}>{humanizeStatus(item.status)}</span>
            {item.flags.map((flag) => (
              <span key={`${item.paymentEventId}-${flag}`} className="text-[10px] font-mono px-2 py-0.5 rounded border border-yellow-500/20 text-yellow-300 bg-yellow-500/5">
                {flag}
              </span>
            ))}
          </div>
          <div className="text-gray-200 font-mono mt-1 break-all">{item.productId} • {item.paymentEventId}</div>
          {item.settlementTxHash ? <div className="text-gray-500 mt-1 break-all font-mono">tx {item.settlementTxHash}</div> : null}
          {item.reason ? <div className="text-yellow-100 mt-1 break-words">{item.reason}</div> : null}
        </div>
        <div className="text-right text-[10px] font-mono text-gray-500">
          <div>{relativeTime(item.createdAt)}</div>
          <div>{formatTimestamp(item.createdAt)}</div>
        </div>
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: FactoryAlert }) {
  return (
    <div className="border border-gray-800 rounded p-3 bg-black/20">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${severityBadgeClass(alert.severity)}`}>{humanizeStatus(alert.severity)}</span>
            <span className="text-[10px] font-mono text-gray-500">{alert.code}</span>
          </div>
          <div className="text-sm text-gray-200 mt-1">{alert.message}</div>
          {alert.relatedEntity ? (
            <div className="text-[11px] text-gray-500 mt-1">{alert.relatedEntity.type}:{alert.relatedEntity.id}</div>
          ) : null}
        </div>
        <div className="text-[10px] font-mono text-gray-500 text-right">
          <div>last {relativeTime(alert.lastSeenAt)}</div>
          <div>{formatTimestamp(alert.lastSeenAt)}</div>
        </div>
      </div>
    </div>
  );
}

function DataSourceRow({ source }: { source: FactoryDataSourceStatus }) {
  return (
    <div className="border border-gray-800 rounded p-2 bg-black/20 text-[11px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-gray-200 truncate">{source.name}</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(source.status)}`}>{humanizeStatus(source.status)}</span>
          {source.stale ? <span className="text-[10px] font-mono text-yellow-300">stale {source.staleAgeSeconds == null ? '' : `${source.staleAgeSeconds}s`}</span> : null}
          {!source.used ? <span className="text-[10px] font-mono text-gray-500">unused</span> : null}
        </div>
        <div className="text-gray-500 font-mono">{relativeTime(source.lastFetchedAt)}</div>
      </div>
      {source.message ? <div className="text-gray-400 mt-1">{source.message}</div> : null}
      {source.error ? <div className="text-red-300 mt-1 break-all">{source.error}</div> : null}
      {source.path ? <div className="text-gray-600 mt-1 break-all font-mono">{source.path}</div> : null}
    </div>
  );
}

export function FactoryView({ runtime }: FactoryViewProps) {
  const factory = useFactorySnapshot(15_000);
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all');
  const [productStatusFilter, setProductStatusFilter] = useState<ProductStatusFilter>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');

  const snapshot = factory.snapshot;
  const integration = snapshot?.integration;
  const sources = snapshot?.sources;
  const outputs = snapshot?.outputs;
  const delivery = snapshot?.delivery;
  const settlement = snapshot?.settlement;
  const backups = snapshot?.backups;
  const controlPlaneBackup = backups?.controlPlane;
  const pipeline = snapshot?.pipeline;
  const economics = snapshot?.economics;
  const autonomy = snapshot?.autonomy;
  const alerts = snapshot?.alerts || [];
  const dataSources = snapshot?.dataSources || [];

  const filteredStreams = useMemo(() => {
    const items = sources?.items || [];
    return items.filter((stream) => {
      if (familyFilter !== 'all' && stream.family !== familyFilter) return false;
      return matchesSearch(
        [stream.name, stream.id, stream.family, stream.sourceRef, stream.status],
        search.trim(),
      );
    });
  }, [sources?.items, familyFilter, search]);

  const filteredProducts = useMemo(() => {
    const items = outputs?.items || [];
    return items.filter((product) => {
      if (!productMatchesStatusFilter(product, productStatusFilter)) return false;
      return matchesSearch(
        [product.productId, product.status, product.latestRegime, ...(product.badges || [])],
        search.trim(),
      );
    });
  }, [outputs?.items, productStatusFilter, search]);

  const familySummariesByName = useMemo(() => {
    const map = new Map<string, FactoryInputFamilySummary>();
    for (const family of sources?.families || []) map.set(family.family, family);
    return map;
  }, [sources?.families]);

  const streamsByFamily = useMemo(() => {
    const grouped = new Map<string, FactoryInputStream[]>();
    for (const stream of filteredStreams) {
      if (!grouped.has(stream.family)) grouped.set(stream.family, []);
      grouped.get(stream.family)!.push(stream);
    }
    for (const family of sources?.families || []) {
      if (!grouped.has(family.family)) grouped.set(family.family, []);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredStreams, sources?.families]);

  const factoryStatusTone = (() => {
    const status = String(integration?.factoryStatus || '').toLowerCase();
    if (status === 'nominal') return 'green' as const;
    if (status === 'attention') return 'yellow' as const;
    if (status === 'warning') return 'red' as const;
    return 'yellow' as const;
  })();

  const runtimeName = runtime.snapshot?.config?.name || 'Automaton';
  const productServiceSource = dataSources.find((d) => d.name === 'product_service_internal_factory_snapshot') || null;
  const factorySource = classifyFactorySource(integration?.apiBaseUrl);

  const expansionEvalObj = readRecord(autonomy?.lastExpansionEvaluation);
  const expansionDecisionObj = readRecord(expansionEvalObj ? expansionEvalObj.decision : null);
  const patchPipelineObj = readRecord(autonomy?.patchPipeline);
  const autoRepriceObj = readRecord(autonomy?.lastAutoReprice);
  const lastExpansionAppliedObj = readRecord(autonomy?.lastExpansionApplied);

  const staleStreamCount = useMemo(() => {
    return (sources?.items || []).filter((stream) => {
      const freshnessSeconds = stream.freshnessSeconds ?? null;
      const polling = stream.pollingIntervalSeconds ?? 60;
      if (freshnessSeconds == null) return false;
      return freshnessSeconds > Math.max(polling * 3, 300);
    }).length;
  }, [sources?.items]);

  const staleProductCount = useMemo(() => {
    return (outputs?.items || []).filter((product) => {
      const badges = (product.badges || []).map((b) => String(b).toLowerCase());
      return badges.includes('stale') || ((product.freshnessMinutes ?? 0) > 20);
    }).length;
  }, [outputs?.items]);

  const settlementCoverageLabel = settlement?.summary?.txHashCoverageRate == null
    ? '—'
    : `${(settlement.summary.txHashCoverageRate * 100).toFixed(1)}%`;

  const controlPlaneBackupStatus = controlPlaneBackup?.available
    ? (controlPlaneBackup?.stale ? 'stale' : (controlPlaneBackup?.status || 'ok'))
    : (controlPlaneBackup?.status || 'degraded');

  const productRuntimeSurvival = backups?.productRuntime;
  const productRuntimeBackup = productRuntimeSurvival?.postgresBackup;
  const productRuntimeSignalHealth = productRuntimeSurvival?.signalBillingHealth;
  const productRuntimeSurvivalStatus = productRuntimeSurvival?.available ? (productRuntimeSurvival.endpointReachability || 'connected') : 'degraded';
  const productRuntimeBackupStatus = productRuntimeBackup?.available ? (productRuntimeBackup?.stale ? 'stale' : (productRuntimeBackup?.status || 'ok')) : (productRuntimeBackup?.status || 'degraded');
  const productRuntimeSignalHealthStatus = productRuntimeSignalHealth?.available ? (productRuntimeSignalHealth?.stale ? 'stale' : (productRuntimeSignalHealth?.status || 'ok')) : (productRuntimeSignalHealth?.status || 'degraded');

  return (
    <div className="h-full flex flex-col p-8 pt-12 animate-fade-in overflow-y-auto custom-scrollbar gap-6">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light font-mono flex items-center gap-3">
            <FactoryIcon className="w-6 h-6 text-neonCyan" />
            Data Stream <span className="text-neonCyan">Factory</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Monitor the automaton&apos;s input streams, synthesis pipeline, and sellable output products. Runtime: {runtimeName}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className={`text-xs font-mono px-2 py-1 rounded border ${runtime.connected ? 'border-green-500/30 text-green-300 bg-green-500/10' : 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10'}`}>
            RUNTIME {runtime.connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
          <span className={`text-xs font-mono px-2 py-1 rounded border ${factory.connected ? 'border-green-500/30 text-green-300 bg-green-500/10' : 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10'}`}>
            FACTORY API {factory.connected ? 'CONNECTED' : 'DEGRADED'}
          </span>
          <span className={`text-xs font-mono px-2 py-1 rounded border ${factorySourceBadgeClass(factorySource.kind)}`} title={integration?.apiBaseUrl || 'No product API URL configured'}>
            FACTORY SOURCE {factorySource.label} <span className="text-gray-400">{factorySource.host}</span>
          </span>
          <button
            onClick={() => { void factory.refresh(); }}
            className="text-xs font-mono border border-gray-700 px-3 py-2 rounded hover:border-neonCyan hover:text-neonCyan transition-colors inline-flex items-center gap-2"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> REFRESH FACTORY
          </button>
        </div>
      </div>

      {(factory.error || !snapshot) && (
        <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-xl p-4 text-sm text-yellow-200">
          <div className="font-mono text-xs tracking-widest mb-1">FACTORY SNAPSHOT STATUS</div>
          <div>{factory.error || 'Awaiting factory snapshot...'}</div>
          <div className="text-xs text-yellow-100/70 mt-2">The tab remains usable in degraded mode once `/api/factory` returns a runtime-only snapshot.</div>
        </div>
      )}

      {snapshot && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
            <KpiCard title="FACTORY STATUS" value={humanizeStatus(integration?.factoryStatus)} subtitle={snapshot.mode} icon={<Gauge className="w-4 h-4" />} tone={factoryStatusTone} />
            <KpiCard title="PRODUCT SERVICE" value={humanizeStatus(integration?.productServiceReachability)} subtitle={productServiceSource?.message || undefined} icon={<Server className="w-4 h-4" />} tone={String(integration?.productServiceReachability).toLowerCase() === 'connected' ? 'green' : 'yellow'} />
            <KpiCard title="LAST PUBLISH FRESHNESS" value={formatMaybeMinutes(pipeline?.health?.freshnessMinutes)} subtitle={`threshold ${formatMaybeMinutes(pipeline?.health?.freshnessThresholdMinutes)}`} icon={<Workflow className="w-4 h-4" />} tone={(pipeline?.health?.freshnessMinutes ?? 0) > (pipeline?.health?.freshnessThresholdMinutes ?? 1e9) ? 'red' : 'cyan'} />
            <KpiCard title="INPUT STREAMS" value={`${formatNum(sources?.activeStreams, 0)}/${formatNum(sources?.totalStreams, 0)}`} subtitle="active / total" icon={<Database className="w-4 h-4" />} tone="cyan" />
            <KpiCard title="OUTPUT PRODUCTS" value={`${formatNum(outputs?.activeProducts, 0)}/${formatNum(outputs?.totalProducts, 0)}`} subtitle="active / total" icon={<Blocks className="w-4 h-4" />} tone="cyan" />
            <KpiCard title="REVENUE / DAY" value={formatUsd(economics?.revenuePerDay, 4)} subtitle={`cost ${formatUsd(economics?.costPerDay, 4)}`} icon={<CircleDollarSign className="w-4 h-4" />} tone="green" />
            <KpiCard title="GROSS MARGIN" value={economics?.grossMargin == null ? '—' : formatPct(economics.grossMargin)} subtitle={`floor ${formatPct(integration?.thresholds?.marginFloor ?? null)}`} icon={<Sparkles className="w-4 h-4" />} tone={(economics?.grossMargin ?? 1) < (integration?.thresholds?.marginFloor ?? 0) ? 'red' : 'green'} />
            <KpiCard title="SIGNAL QUALITY" value={economics?.signalQualityScore == null ? '—' : economics.signalQualityScore.toFixed(3)} subtitle={`min ${(integration?.thresholds?.signalQualityMin ?? 0).toFixed(2)}`} icon={<Radar className="w-4 h-4" />} tone={(economics?.signalQualityScore ?? 1) < (integration?.thresholds?.signalQualityMin ?? 0) ? 'red' : 'green'} />
            <KpiCard title="PAID CUSTOMERS (7D)" value={formatNum(economics?.paidCustomers7d, 0)} subtitle={`min ${formatNum(integration?.thresholds?.minPaidCustomers ?? null, 0)}`} icon={<CircleDollarSign className="w-4 h-4" />} />
            <KpiCard title="UPTIME (7D)" value={formatPctPoints(economics?.uptime7dPercent)} subtitle="health samples" icon={<Gauge className="w-4 h-4" />} tone={(economics?.uptime7dPercent ?? 100) < 99 ? 'yellow' : 'green'} />
            <KpiCard title="FACTORY SNAPSHOT AGE" value={relativeTime(snapshot.generatedAt)} subtitle={formatTimestamp(snapshot.generatedAt)} icon={<RefreshCcw className="w-4 h-4" />} />
            <KpiCard title="FACTORY API LATENCY" value={factory.fetchLatencyMs == null ? '—' : `${factory.fetchLatencyMs}ms`} subtitle={runtime.fetchLatencyMs == null ? 'runtime n/a' : `runtime ${runtime.fetchLatencyMs}ms`} icon={<Server className="w-4 h-4" />} />
          </div>

          <div className="w-full">
            <AlertDigestStrip alerts={alerts} />
          </div>

          <div className="border border-panelBorder bg-panelBg rounded-xl p-4">
            <div className="flex flex-col xl:flex-row xl:items-end gap-4">
              <div className="flex items-center gap-2 text-gray-400 min-w-[140px]">
                <Filter className="w-4 h-4" />
                <span className="font-mono text-xs tracking-widest">FILTERS</span>
              </div>

              <div className="flex flex-wrap gap-2 items-center text-[10px] font-mono text-gray-400 xl:ml-auto">
                <span className="px-2 py-1 rounded border border-gray-800 bg-black/20">streams {filteredStreams.length}</span>
                <span className="px-2 py-1 rounded border border-gray-800 bg-black/20">products {filteredProducts.length}</span>
                <span className="px-2 py-1 rounded border border-gray-800 bg-black/20">alerts {alerts.length}</span>
                <span className="px-2 py-1 rounded border border-gray-800 bg-black/20">mode {snapshot.mode}</span>
              </div>

              <label className="flex flex-col gap-1 text-xs min-w-[220px]">
                <span className="font-mono text-gray-500">INPUT FAMILY</span>
                <select value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value as FamilyFilter)} className="bg-black/30 border border-gray-700 rounded px-2 py-2 text-gray-200 font-mono text-xs">
                  <option value="all">all</option>
                  <option value="market_microstructure">market_microstructure</option>
                  <option value="onchain_flow">onchain_flow</option>
                  <option value="macro_news_risk">macro_news_risk</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs min-w-[180px]">
                <span className="font-mono text-gray-500">OUTPUT PRODUCT STATUS</span>
                <select value={productStatusFilter} onChange={(e) => setProductStatusFilter(e.target.value as ProductStatusFilter)} className="bg-black/30 border border-gray-700 rounded px-2 py-2 text-gray-200 font-mono text-xs">
                  <option value="all">all</option>
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="stale">stale</option>
                  <option value="degraded">degraded</option>
                </select>
              </label>

              <label className="flex-1 flex flex-col gap-1 text-xs">
                <span className="font-mono text-gray-500">SEARCH STREAM / PRODUCT / SOURCE</span>
                <div className="flex gap-2">
                  <input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchDraft.trim()); }}
                    placeholder="stream id, product id, sourceRef, family..."
                    className="flex-1 bg-black/30 border border-gray-700 rounded px-3 py-2 text-gray-200 text-sm"
                  />
                  <button onClick={() => setSearch(searchDraft.trim())} className="text-xs font-mono border border-gray-700 px-3 py-2 rounded hover:border-neonCyan hover:text-neonCyan">APPLY</button>
                  <button onClick={() => { setSearchDraft(''); setSearch(''); }} className="text-xs font-mono border border-gray-700 px-3 py-2 rounded hover:border-gray-500 text-gray-300">CLEAR</button>
                </div>
              </label>
            </div>
          </div>


          <SectionShell title="FACTORY FLOW" right={<span className="text-[10px] font-mono text-gray-500">scan left → right</span>}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col 2xl:flex-row items-stretch gap-2">
                <FlowNodeCard
                  title="INPUTS"
                  icon={<Database className="w-4 h-4" />}
                  value={`${formatNum(sources?.activeStreams, 0)}/${formatNum(sources?.totalStreams, 0)}`}
                  subtitle={`active/total • stale ${formatNum(staleStreamCount, 0)}`}
                  status={(staleStreamCount ?? 0) > 0 ? 'attention' : 'connected'}
                />
                <FlowConnector />
                <FlowNodeCard
                  title="PIPELINE"
                  icon={<Workflow className="w-4 h-4" />}
                  value={formatMaybeMinutes(pipeline?.health?.freshnessMinutes)}
                  subtitle={`threshold ${formatMaybeMinutes(pipeline?.health?.freshnessThresholdMinutes)} • uptime ${formatPctPoints(pipeline?.health?.uptime7dPercent)}`}
                  status={pipeline?.health?.healthy === false ? 'warning' : (pipeline?.health?.healthy === true ? 'connected' : 'degraded')}
                />
                <FlowConnector />
                <FlowNodeCard
                  title="OUTPUTS"
                  icon={<Blocks className="w-4 h-4" />}
                  value={`${formatNum(outputs?.activeProducts, 0)}/${formatNum(outputs?.totalProducts, 0)}`}
                  subtitle={`active/total • stale ${formatNum(staleProductCount, 0)}`}
                  status={(staleProductCount ?? 0) > 0 ? 'warning' : 'connected'}
                />
                <FlowConnector />
                <FlowNodeCard
                  title="DELIVERY"
                  icon={<Server className="w-4 h-4" />}
                  value={`${formatNum(delivery?.webhooks?.statusCounts?.delivered, 0)} ok / ${formatNum(delivery?.webhooks?.statusCounts?.failed, 0)} fail`}
                  subtitle={`dead-letter ${formatNum(delivery?.webhooks?.statusCounts?.deadLettered, 0)} • ${humanizeStatus(delivery?.webhooks?.endpointReachability || 'unknown')}`}
                  status={delivery?.webhooks?.statusCounts?.deadLettered ? 'warning' : (delivery?.webhooks?.available ? 'connected' : 'degraded')}
                />
                <FlowConnector />
                <FlowNodeCard
                  title="SETTLEMENT"
                  icon={<CircleDollarSign className="w-4 h-4" />}
                  value={`${formatNum(settlement?.summary?.reconciledPayments, 0)}/${formatNum(settlement?.summary?.officialAcceptedPayments, 0)}`}
                  subtitle={`reconciled/official • txhash ${settlementCoverageLabel}`}
                  status={(settlement?.summary?.failedOfficialPayments ?? 0) > 0 ? 'warning' : (settlement?.available ? 'connected' : 'degraded')}
                />
              </div>
              <div className="text-[11px] text-gray-500 font-mono">
                Flow intent: ingest raw streams → synthesize signals → publish products → deliver to buyers/agents → reconcile payments/settlement.
              </div>
            </div>
          </SectionShell>

          <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6 items-start">
            <SectionShell title="INPUT STREAMS" right={<span className="text-[10px] font-mono text-gray-500">{filteredStreams.length} visible</span>}>
              <div className="space-y-4 max-h-[880px] overflow-y-auto custom-scrollbar pr-1">
                {streamsByFamily.map(([family, items]) => {
                  const familySummary = familySummariesByName.get(family);
                  const visibleLabel = `${items.length} visible`;
                  return (
                    <div key={family} className="border border-gray-800 rounded-xl p-3 bg-black/10">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="font-mono text-xs text-gray-200">{family}</div>
                          <div className="text-[11px] text-gray-500 mt-1">
                            total {formatNum(familySummary?.total ?? items.length, 0)} • active {formatNum(familySummary?.active ?? 0, 0)} • healthy {formatNum(familySummary?.healthyCount ?? 0, 0)}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            median freshness {formatMaybeSeconds(familySummary?.medianFreshnessSeconds)} • quality avg {familySummary?.qualityAvg == null ? '—' : familySummary.qualityAvg.toFixed(3)}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-gray-500">{visibleLabel}</span>
                      </div>
                      <StreamTable streams={items} />
                    </div>
                  );
                })}
                {streamsByFamily.length === 0 && <div className="text-sm text-gray-500 font-mono">No input families available.</div>}
              </div>
            </SectionShell>

            <SectionShell title="SYNTHESIS PIPELINE" right={<span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(integration?.factoryStatus || 'unknown')}`}>{humanizeStatus(integration?.factoryStatus)}</span>}>
              <div className="space-y-4 max-h-[880px] overflow-y-auto custom-scrollbar pr-1">
                <div className="border border-gray-800 rounded-xl p-3 bg-black/20">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                    <div>
                      <div className="font-mono text-xs text-gray-200">PIPELINE HEALTH</div>
                      <div className="text-[11px] text-gray-500 mt-1">service {humanizeStatus(pipeline?.health?.status)} • checked {relativeTime(pipeline?.health?.checkedAt)}</div>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(pipeline?.health?.healthy === false ? 'warning' : (pipeline?.health?.healthy === true ? 'ok' : 'unknown'))}`}>
                      {pipeline?.health?.healthy === true ? 'HEALTHY' : pipeline?.health?.healthy === false ? 'UNHEALTHY' : 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <MetricRow label="last feature" value={relativeTime(pipeline?.health?.lastFeatureAt)} />
                    <MetricRow label="last publish" value={relativeTime(pipeline?.health?.lastPublishAt)} />
                    <MetricRow label="freshness" value={formatMaybeMinutes(pipeline?.health?.freshnessMinutes)} />
                    <MetricRow label="threshold" value={formatMaybeMinutes(pipeline?.health?.freshnessThresholdMinutes)} />
                    <MetricRow label="uptime7d" value={formatPctPoints(pipeline?.health?.uptime7dPercent)} />
                    <MetricRow label="samples" value={formatNum(pipeline?.health?.uptime7dSampleCount, 0)} />
                  </div>
                  {pipeline?.health?.lastError?.error ? (
                    <div className="mt-3 border border-red-500/20 bg-red-500/5 rounded p-2 text-[11px] text-red-200">
                      <div className="font-mono text-[10px] mb-1">LAST PIPELINE ERROR ({relativeTime(pipeline?.health?.lastError?.checkedAt)})</div>
                      <div className="break-words">{pipeline.health.lastError.error}</div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {(pipeline?.stages || []).map((stage) => (
                    <StageCard key={stage.stage} stage={stage} />
                  ))}
                </div>

                <div className="border border-gray-800 rounded-xl p-3 bg-black/20">
                  <div className="font-mono text-xs text-gray-300 mb-3">SYNTHESIS AUTOMATION STATUS</div>
                  <div className="space-y-2">
                    {(pipeline?.automationHeartbeats || []).map((hb) => (
                      <HeartbeatRow key={hb.task} hb={hb} />
                    ))}
                  </div>
                </div>
              </div>
            </SectionShell>

            <SectionShell title="OUTPUT PRODUCTS (FOR SALE)" right={<span className="text-[10px] font-mono text-gray-500">{filteredProducts.length} visible</span>}>
              <div className="space-y-3 max-h-[880px] overflow-y-auto custom-scrollbar pr-1">
                {filteredProducts.length === 0 ? (
                  <div className="border border-gray-800 rounded p-4 bg-black/20 text-sm text-gray-500 font-mono">
                    {snapshot.mode === 'degraded_runtime_only'
                      ? 'Product service snapshot unavailable. Runtime-only degraded mode is active.'
                      : 'No products match current filters.'}
                  </div>
                ) : (
                  filteredProducts.map((product) => <ProductRow key={product.productId} product={product} />)
                )}
              </div>
            </SectionShell>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6 items-start">
          <SectionShell title="DELIVERY CHANNELS (WEBHOOKS)" right={<span className="text-[10px] font-mono text-gray-500">operator telemetry</span>}>
            <div className="space-y-3">
              <div className="border border-gray-800 rounded p-3 bg-black/20">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-mono text-xs text-gray-300 mb-2">WEBHOOK DELIVERY SUMMARY</div>
                    <div className="text-sm text-gray-200">
                      {delivery?.webhooks?.available ? 'Connected' : 'Unavailable (optional endpoint)'}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      fetched {relativeTime(delivery?.webhooks?.fetchedAt)} • persistence {delivery?.webhooks?.persistenceBackend || '—'}
                    </div>
                    {delivery?.webhooks?.error ? (
                      <div className="text-[11px] text-yellow-200 mt-2 break-words">{delivery.webhooks.error}</div>
                    ) : null}
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(delivery?.webhooks?.endpointReachability || 'unknown')}`}>
                    {humanizeStatus(delivery?.webhooks?.endpointReachability || 'unknown')}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
                  <MetricRow label="attempts" value={formatNum(delivery?.webhooks?.totalAttempts, 0)} />
                  <MetricRow label="delivered" value={formatNum(delivery?.webhooks?.statusCounts?.delivered, 0)} />
                  <MetricRow label="failed" value={formatNum(delivery?.webhooks?.statusCounts?.failed, 0)} />
                  <MetricRow label="dead-letter" value={formatNum(delivery?.webhooks?.statusCounts?.deadLettered, 0)} />
                </div>
              </div>

              <div className="border border-gray-800 rounded p-3 bg-black/20">
                <div className="font-mono text-xs text-gray-300 mb-3">RECENT WEBHOOK DELIVERY ATTEMPTS</div>
                <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                  {delivery?.webhooks?.attempts?.length ? (
                    delivery.webhooks.attempts.map((attempt) => <WebhookAttemptRow key={attempt.id} attempt={attempt} />)
                  ) : (
                    <div className="text-sm text-gray-500 font-mono">
                      {delivery?.webhooks?.available ? 'No webhook delivery attempts in the current operator window.' : 'Webhook attempts endpoint unavailable.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SectionShell>

          <SectionShell title="BILLING & SETTLEMENT RECONCILIATION" right={<span className="text-[10px] font-mono text-gray-500">operator telemetry</span>}>
            <div className="space-y-3">
              <div className="border border-gray-800 rounded p-3 bg-black/20">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-mono text-xs text-gray-300 mb-2">SETTLEMENT RECONCILIATION SUMMARY</div>
                    <div className="text-sm text-gray-200">
                      {settlement?.available ? 'Connected' : 'Unavailable (optional endpoint)'}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      fetched {relativeTime(settlement?.fetchedAt)} • rpc {settlement?.rpc?.enabled ? 'enabled' : 'disabled'} • checks {formatNum(settlement?.rpc?.checkedTransactions, 0)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1 break-all">
                      payTo {settlement?.rpc?.sellerPayToAddress || '—'} • asset {settlement?.rpc?.sellerTokenAddress || '—'}
                    </div>
                    {settlement?.error ? (
                      <div className="text-[11px] text-yellow-200 mt-2 break-words">{settlement.error}</div>
                    ) : null}
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(settlement?.endpointReachability || 'unknown')}`}>
                    {humanizeStatus(settlement?.endpointReachability || 'unknown')}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
                  <MetricRow label="accepted" value={formatNum(settlement?.summary?.acceptedPayments, 0)} />
                  <MetricRow label="official" value={formatNum(settlement?.summary?.officialAcceptedPayments, 0)} />
                  <MetricRow label="reconciled" value={formatNum(settlement?.summary?.reconciledPayments, 0)} />
                  <MetricRow label="failed" value={formatNum(settlement?.summary?.failedOfficialPayments, 0)} />
                  <MetricRow label="pending" value={formatNum(settlement?.summary?.pendingOrUnverifiedOfficialPayments, 0)} />
                  <MetricRow label="dup txhash" value={formatNum(settlement?.summary?.duplicateSettlementTxHashes, 0)} />
                  <MetricRow label="txhash coverage" value={formatPct(settlement?.summary?.txHashCoverageRate, 1)} />
                  <MetricRow label="receipt confirm" value={formatPct(settlement?.summary?.receiptConfirmationRate, 1)} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-[11px]">
                  <MetricRow label="accepted rev" value={formatUsd(settlement?.summary?.acceptedRevenueUsdc, 4)} />
                  <MetricRow label="official rev" value={formatUsd(settlement?.summary?.officialAcceptedRevenueUsdc, 4)} />
                  <MetricRow label="legacy rev" value={formatUsd(settlement?.summary?.legacyAcceptedRevenueUsdc, 4)} />
                  <MetricRow label="reconciled rev" value={formatUsd(settlement?.summary?.reconciledRevenueUsdc, 4)} />
                </div>
              </div>

              <div className="border border-gray-800 rounded p-3 bg-black/20">
                <div className="font-mono text-xs text-gray-300 mb-3">RECONCILIATION EXCEPTIONS</div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                  {settlement?.exceptions?.length ? (
                    settlement.exceptions.map((item) => <SettlementExceptionRow key={`${item.paymentEventId}-${item.status}-${item.createdAt}`} item={item} />)
                  ) : (
                    <div className="text-sm text-gray-500 font-mono">
                      {settlement?.available ? 'No reconciliation exceptions in the current operator window.' : 'Billing reconciliation endpoint unavailable.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SectionShell>

          </div>

          <div className="grid grid-cols-1 gap-6">
            <SectionShell title="BACKUPS & RECOVERY" right={<span className="text-[10px] font-mono text-gray-500">local control-plane telemetry</span>}>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div className="border border-gray-800 rounded p-3 bg-black/20">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-xs text-gray-300 mb-2">CONTROL-PLANE BACKUP STATUS</div>
                      <div className="text-sm text-gray-200">
                        {controlPlaneBackup?.available ? 'Backup snapshot available' : 'No backup snapshot available'}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        latest {relativeTime(controlPlaneBackup?.latestCreatedAt)} • threshold {formatMaybeHours(controlPlaneBackup?.maxAgeHours)}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 break-all">
                        root {controlPlaneBackup?.rootPath || '—'}
                      </div>
                      {controlPlaneBackup?.error ? (
                        <div className="text-[11px] text-yellow-200 mt-2 break-words">{controlPlaneBackup.error}</div>
                      ) : null}
                      {controlPlaneBackup?.hasStateDb === false ? (
                        <div className="text-[11px] text-red-200 mt-2">Latest backup is missing automaton state DB content.</div>
                      ) : null}
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(controlPlaneBackupStatus)}`}>
                      {humanizeStatus(controlPlaneBackupStatus)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
                    <MetricRow label="age" value={formatMaybeHours(controlPlaneBackup?.latestAgeHours)} />
                    <MetricRow label="runs" value={formatNum(controlPlaneBackup?.runCount, 0)} />
                    <MetricRow label="artifact size" value={formatBytes(controlPlaneBackup?.artifactSizeBytes)} />
                    <MetricRow label="included" value={formatNum(controlPlaneBackup?.includedCount, 0)} />
                    <MetricRow label="missing opt" value={formatNum(controlPlaneBackup?.missingOptionalCount, 0)} />
                    <MetricRow label="has state db" value={controlPlaneBackup?.hasStateDb == null ? '—' : (controlPlaneBackup.hasStateDb ? 'yes' : 'no')} />
                    <MetricRow label="created" value={formatTimestamp(controlPlaneBackup?.latestCreatedAt)} />
                    <MetricRow label="manifest" value={controlPlaneBackup?.manifestPath ? 'present' : 'missing'} />
                  </div>
                </div>
                <div className="border border-gray-800 rounded p-3 bg-black/20">
                  <div className="font-mono text-xs text-gray-300 mb-2">BACKUP ARTIFACT DETAILS</div>
                  <div className="space-y-2 text-[11px]">
                    <div>
                      <div className="text-gray-500">latest run dir</div>
                      <div className="text-gray-300 break-all">{controlPlaneBackup?.latestRunDir || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">artifact</div>
                      <div className="text-gray-300 break-all">{controlPlaneBackup?.artifactPath || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">manifest</div>
                      <div className="text-gray-300 break-all">{controlPlaneBackup?.manifestPath || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">sha256</div>
                      <div className="text-gray-300 break-all font-mono">{controlPlaneBackup?.artifactSha256 || '—'}</div>
                    </div>
                    <div className="pt-1 text-gray-500">
                      Wallet material and Vultisig shares are intentionally excluded from the control-plane backup snapshot.
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-1">
                <div className="border border-gray-800 rounded p-3 bg-black/20">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-xs text-gray-300 mb-2">PRODUCT RUNTIME (REPO B) SURVIVAL</div>
                      <div className="text-sm text-gray-200">
                        {productRuntimeSurvival?.available ? 'Internal ops endpoint connected' : 'Internal ops endpoint unavailable'}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        fetched {relativeTime(productRuntimeSurvival?.fetchedAt)} • endpoint {humanizeStatus(productRuntimeSurvivalStatus)}
                      </div>
                      {productRuntimeSurvival?.error ? (
                        <div className="text-[11px] text-yellow-200 mt-2 break-words">{productRuntimeSurvival.error}</div>
                      ) : null}
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(productRuntimeSurvivalStatus)}`}>
                      {humanizeStatus(productRuntimeSurvivalStatus)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
                    <MetricRow label="pg backup" value={humanizeStatus(productRuntimeBackupStatus)} />
                    <MetricRow label="pg age" value={formatMaybeHours(productRuntimeBackup?.latestAgeHours)} />
                    <MetricRow label="x402 loop" value={humanizeStatus(productRuntimeSignalHealthStatus)} />
                    <MetricRow label="loop age" value={formatMaybeSeconds(productRuntimeSignalHealth?.ageSeconds)} />
                    <MetricRow label="loop next" value={formatMaybeSeconds(productRuntimeSignalHealth?.nextRunInSeconds)} />
                    <MetricRow label="loop fails" value={formatNum(productRuntimeSignalHealth?.consecutiveFailures, 0)} />
                    <MetricRow label="loop runs" value={formatNum(productRuntimeSignalHealth?.runsTotal, 0)} />
                    <MetricRow label="history rows" value={formatNum(productRuntimeSignalHealth?.historyLineCount, 0)} />
                  </div>
                </div>
                <div className="border border-gray-800 rounded p-3 bg-black/20">
                  <div className="font-mono text-xs text-gray-300 mb-2">PRODUCT RUNTIME ARTIFACTS & CHECK FILES</div>
                  <div className="space-y-2 text-[11px]">
                    <div>
                      <div className="text-gray-500">postgres backup root</div>
                      <div className="text-gray-300 break-all">{productRuntimeBackup?.rootPath || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">latest postgres backup dump</div>
                      <div className="text-gray-300 break-all">{productRuntimeBackup?.dumpFilePath || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">x402 health state file</div>
                      <div className="text-gray-300 break-all">{productRuntimeSignalHealth?.stateFile || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">x402 health history file</div>
                      <div className="text-gray-300 break-all">{productRuntimeSignalHealth?.historyFile || '—'}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <MetricRow label="pg dump size" value={formatBytes(productRuntimeBackup?.artifactSizeBytes)} />
                      <MetricRow label="x402 base url" value={productRuntimeSignalHealth?.baseUrl || '—'} />
                      <MetricRow label="loop exit" value={productRuntimeSignalHealth?.exitCode == null ? '—' : String(productRuntimeSignalHealth.exitCode)} />
                      <MetricRow label="loop dur" value={formatMaybeMs(productRuntimeSignalHealth?.durationMs)} />
                    </div>
                  </div>
                </div>
              </div>
            </SectionShell>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
            <SectionShell title="ALERTS & BREACHES" right={<span className="text-[10px] font-mono text-gray-500">{alerts.length} alerts</span>}>
              <div className="space-y-2 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
                {alerts.length === 0 ? (
                  <div className="border border-green-500/20 bg-green-500/5 rounded p-3 text-sm text-green-200 font-mono">
                    No active factory alerts.
                  </div>
                ) : (
                  alerts.map((alert) => <AlertRow key={`${alert.code}-${alert.lastSeenAt}-${alert.message}`} alert={alert} />)
                )}
              </div>
            </SectionShell>

            <SectionShell title="AUTOMATON COMMERCIAL DECISIONS" right={<span className="text-[10px] font-mono text-gray-500">read-only</span>}>
              <div className="space-y-4 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
                <div className="border border-gray-800 rounded p-3 bg-black/20">
                  <div className="font-mono text-xs text-gray-300 mb-2">REINVESTMENT CHECKLIST</div>
                  <div className="space-y-2">
                    {autonomy?.reinvestment?.items?.map((item) => (
                      <div key={item.key} className="grid grid-cols-[1.6fr_auto_auto] gap-2 items-center border border-gray-800 rounded px-2 py-2 text-[11px]">
                        <div className="text-gray-300">{item.label}</div>
                        <div className="font-mono text-gray-400">{item.actual == null ? '—' : `${item.actual.toFixed(item.unit === 'usd' ? 2 : 3)}${item.unit === '%' ? '%' : item.unit === 'usd' ? ' usd' : ''}`}</div>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${item.pass === true ? statusBadgeClass('ok') : item.pass === false ? statusBadgeClass('warning') : statusBadgeClass('unknown')}`}>
                          {item.pass === true ? 'PASS' : item.pass === false ? 'FAIL' : 'N/A'}
                        </span>
                      </div>
                    )) || <div className="text-sm text-gray-500 font-mono">No reinvestment checklist data.</div>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-[11px]">
                    <MetricRow label="net profit 7d" value={formatUsd(autonomy?.reinvestment?.netProfit7d, 2)} />
                    <MetricRow label="expansion budget" value={formatUsd(autonomy?.reinvestment?.expansionBudget, 2)} />
                    <MetricRow label="required budget" value={formatUsd(autonomy?.reinvestment?.requiredBudget, 2)} />
                  </div>
                </div>

                <div className="border border-gray-800 rounded p-3 bg-black/20">
                  <div className="font-mono text-xs text-gray-300 mb-2">NEXT SOURCE CANDIDATE</div>
                  <div className="text-sm text-gray-200">{autonomy?.nextSourceCandidate?.family || '—'}</div>
                  <div className="text-[11px] text-gray-400 break-all mt-1">{autonomy?.nextSourceCandidate?.sourceRef || '—'}</div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                    <MetricRow label="polling" value={formatMaybeSeconds(autonomy?.nextSourceCandidate?.pollingIntervalSeconds)} />
                    <MetricRow label="quality" value={autonomy?.nextSourceCandidate?.qualityScore == null ? '—' : autonomy.nextSourceCandidate.qualityScore.toFixed(3)} />
                    <MetricRow label="auto apply" value={autonomy?.nextSourceCandidate?.autoApplyEnabled ? 'true' : 'false'} />
                    <MetricRow label="run synth" value={autonomy?.nextSourceCandidate?.runSynthesisAfterApply ? 'true' : 'false'} />
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500">targets: {(autonomy?.nextSourceCandidate?.targetProductIds || []).length > 0 ? autonomy?.nextSourceCandidate?.targetProductIds.join(', ') : 'all / default'}</div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div className="border border-gray-800 rounded p-3 bg-black/20">
                    <div className="font-mono text-xs text-gray-300 mb-2">LAST AUTO-REPRICE</div>
                    {autoRepriceObj ? (
                      <>
                        <div className="text-sm text-gray-200">{readString(autoRepriceObj, 'productId') || '—'} • {readString(autoRepriceObj, 'accessMode') || '—'}</div>
                        <div className="text-[11px] text-gray-500 mt-1">{relativeTime(readString(autoRepriceObj, 'triggeredAt'))} • {formatTimestamp(readString(autoRepriceObj, 'triggeredAt'))}</div>
                        <div className="text-[11px] text-gray-400 mt-2">old {readNumber(autoRepriceObj, 'oldPriceUsdc') ?? '—'} → new {readNumber(autoRepriceObj, 'newPriceUsdc') ?? '—'} USDC</div>
                        <div className="text-[11px] text-gray-500 mt-1">Δ customers {readNumber(autoRepriceObj, 'customerDelta') ?? '—'} • revenue growth {readNumber(autoRepriceObj, 'revenueGrowth') ?? '—'}</div>
                      </>
                    ) : <div className="text-sm text-gray-500 font-mono">No auto-reprice audit yet.</div>}
                  </div>

                  <div className="border border-gray-800 rounded p-3 bg-black/20">
                    <div className="font-mono text-xs text-gray-300 mb-2">LAST EXPANSION EVALUATION</div>
                    {expansionEvalObj ? (
                      <>
                        <div className="text-sm text-gray-200">status {readString(expansionDecisionObj, 'status') || (String(expansionDecisionObj?.shouldAddSource) === 'true' ? 'accepted' : 'unknown')}</div>
                        <div className="text-[11px] text-gray-500 mt-1">{relativeTime(readString(expansionEvalObj, 'checkedAt'))} • {formatTimestamp(readString(expansionEvalObj, 'checkedAt'))}</div>
                        {readString(expansionDecisionObj, 'reason') ? <div className="text-[11px] text-gray-400 mt-2">{readString(expansionDecisionObj, 'reason')}</div> : null}
                        <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                          <MetricRow label="expansion budget" value={formatUsd(readNumber(expansionDecisionObj, 'expansionBudget'), 2)} />
                          <MetricRow label="should add source" value={String(expansionDecisionObj?.shouldAddSource ?? '—')} />
                        </div>
                        <div className="mt-2 text-[11px] text-gray-500 break-all">payload {jsonSnippet(expansionEvalObj.payload)}</div>
                      </>
                    ) : <div className="text-sm text-gray-500 font-mono">No expansion evaluation recorded.</div>}
                  </div>

                  <div className="border border-gray-800 rounded p-3 bg-black/20">
                    <div className="font-mono text-xs text-gray-300 mb-2">LAST EXPANSION APPLIED</div>
                    {lastExpansionAppliedObj ? (
                      <>
                        <div className="text-sm text-gray-200">{readString(lastExpansionAppliedObj, 'streamId') || '—'} • {readString(lastExpansionAppliedObj, 'family') || '—'}</div>
                        <div className="text-[11px] text-gray-500 mt-1">{relativeTime(readString(lastExpansionAppliedObj, 'appliedAt'))} • {formatTimestamp(readString(lastExpansionAppliedObj, 'appliedAt'))}</div>
                        <div className="text-[11px] text-gray-400 mt-2 break-all">{readString(lastExpansionAppliedObj, 'sourceRef') || '—'}</div>
                      </>
                    ) : <div className="text-sm text-gray-500 font-mono">No expansion apply event recorded.</div>}
                  </div>

                  <div className="border border-gray-800 rounded p-3 bg-black/20">
                    <div className="font-mono text-xs text-gray-300 mb-2">PATCH PIPELINE STATUS</div>
                    {patchPipelineObj ? (
                      <>
                        <div className={`inline-flex text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClass(patchPipelineObj.ok === false ? 'warning' : 'ok')}`}>
                          {patchPipelineObj.ok === false ? 'FAILURE' : 'OK'}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-2">{readString(patchPipelineObj, 'message') || jsonSnippet(patchPipelineObj)}</div>
                        <div className="text-[11px] text-gray-500 mt-1">recorded {formatTimestamp(readString(patchPipelineObj, 'recordedAt'))}</div>
                      </>
                    ) : <div className="text-sm text-gray-500 font-mono">No patch pipeline audit record yet.</div>}
                  </div>
                </div>
              </div>
            </SectionShell>
          </div>

          <SectionShell title="DATA SOURCES" right={<span className="text-[10px] font-mono text-gray-500">{dataSources.length} sources</span>}>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              {dataSources.length === 0 ? (
                <div className="text-sm text-gray-500 font-mono">No factory data source diagnostics available.</div>
              ) : (
                dataSources.map((source) => <DataSourceRow key={source.name} source={source} />)
              )}
            </div>
          </SectionShell>
        </>
      )}
    </div>
  );
}
