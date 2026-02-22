import { useState } from 'react';
import { Play, TrendingUp, Zap, Server } from 'lucide-react';
import type { AutomatonDashboardRuntime } from '../types/automaton';

function formatUsd(cents: number | undefined): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function shortAddress(value: string | undefined): string {
  if (!value) return 'unknown';
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function shortId(value: string | undefined): string {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function healthLabel(roughHealth: string | undefined): string {
  switch (roughHealth) {
    case 'warning':
      return 'Warning';
    case 'attention':
      return 'Attention';
    case 'nominal':
      return 'Nominal';
    default:
      return 'Unknown';
  }
}

interface HomeDashboardProps {
  onNavigate: (app: string) => void;
  runtime: AutomatonDashboardRuntime;
}

export function HomeDashboard({ onNavigate, runtime }: HomeDashboardProps) {
  const [treasuryActionBusyId, setTreasuryActionBusyId] = useState<string | null>(null);
  const [treasuryActionStatus, setTreasuryActionStatus] = useState<string | null>(null);
  const [treasuryActionError, setTreasuryActionError] = useState<string | null>(null);

  const snapshot = runtime.snapshot;
  const status = snapshot?.status;
  const treasury = snapshot?.treasury;
  const recentTurns = snapshot?.activity?.recentTurns || [];
  const recentTransactions = snapshot?.activity?.recentTransactions || [];
  const pendingIntents = (treasury?.recentIntents || [])
    .filter((intent) => intent.status === 'pending_approval')
    .slice(0, 5);

  const bannerName = snapshot?.config?.name || 'Automaton';
  const pendingApprovals = treasury?.pendingApprovalCount ?? 0;
  const enabledHeartbeats = status?.heartbeatEnabled ?? 0;
  const totalHeartbeats = status?.heartbeatTotal ?? 0;
  const roughHealth = status?.roughHealth;

  const efficiency = status
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            100 -
              pendingApprovals * 4 -
              (treasury?.counts?.failed || 0) * 10 +
              (runtime.connected ? 0 : -15),
          ),
        ),
      )
    : 0;

  const eventItems = [
    ...recentTurns.slice(0, 4).map((turn) => ({
      kind: 'turn' as const,
      color: 'bg-deptResearch',
      text: `${turn.state.toUpperCase()} turn ${turn.id.slice(-6)} • ${turn.thinkingPreview || 'No thinking captured.'}`,
      meta: `${relativeTime(turn.timestamp)} • ${turn.inputSource || 'system'}`,
    })),
    ...recentTransactions.slice(0, 3).map((txn) => ({
      kind: 'txn' as const,
      color: txn.type === 'transfer_out' ? 'bg-yellow-500' : 'bg-green-500',
      text: `${txn.type}: ${txn.description}`,
      meta: `${relativeTime(txn.timestamp)} • ${txn.amountCents != null ? formatUsd(txn.amountCents) : 'n/a'}`,
    })),
  ].slice(0, 6);

  async function callTreasuryAction(
    intentId: string,
    action: 'approve' | 'reject',
    payload: Record<string, unknown>,
  ) {
    setTreasuryActionBusyId(intentId);
    setTreasuryActionError(null);
    setTreasuryActionStatus(null);
    try {
      const resp = await fetch(`/api/treasury/intents/${encodeURIComponent(intentId)}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.error || `Treasury ${action} failed (${resp.status})`);
      }
      const isExecute = payload.execute === true;
      setTreasuryActionStatus(
        action === 'reject'
          ? `Rejected ${shortId(intentId)}`
          : isExecute
            ? `Approved + queued ${shortId(intentId)}`
            : `Approved ${shortId(intentId)}`,
      );
      await runtime.refresh();
    } catch (err) {
      setTreasuryActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreasuryActionBusyId(null);
    }
  }

  async function handleApproveOnly(intentId: string) {
    const confirmed = window.confirm(`Approve transfer intent ${intentId} without execution?`);
    if (!confirmed) return;
    await callTreasuryAction(intentId, 'approve', { execute: false });
  }

  async function handleApproveAndExecute(intentId: string) {
    const confirmed = window.confirm(
      `Approve and execute (or queue to signer) transfer intent ${intentId}?`,
    );
    if (!confirmed) return;
    await callTreasuryAction(intentId, 'approve', { execute: true });
  }

  async function handleReject(intentId: string) {
    const reason = window.prompt(
      `Reject transfer intent ${intentId}. Enter a short reason:`,
      'Rejected from dashboard UI',
    );
    if (!reason || !reason.trim()) return;
    await callTreasuryAction(intentId, 'reject', { reason: reason.trim() });
  }

  return (
    <div className="h-full flex flex-col gap-8 animate-fade-in p-8 pt-12 overflow-y-auto">
      <div className="relative overflow-hidden rounded-2xl border border-neonCyan/30 bg-gradient-to-r from-panelBg to-[#060B14] p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-neonCyan/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h1 className="text-4xl font-light font-mono mb-2">
              {bannerName} <span className="font-bold text-neonCyan">Core</span>
            </h1>
            <p className="text-gray-400 max-w-2xl">
              {runtime.connected
                ? `Live runtime snapshot connected. ${enabledHeartbeats}/${totalHeartbeats} heartbeats enabled, ${pendingApprovals} treasury approvals pending, health ${healthLabel(roughHealth).toLowerCase()}.`
                : 'Dashboard design is loaded, but runtime API is not connected. Start the local dashboard API bridge to populate live data.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-mono">
              <span className={`px-2 py-1 rounded border ${runtime.connected ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10'}`}>
                {runtime.connected ? 'API CONNECTED' : 'API DISCONNECTED'}
              </span>
              <span className="px-2 py-1 rounded border border-gray-700 text-gray-300 bg-black/20">
                LAT {runtime.fetchLatencyMs != null ? `${runtime.fetchLatencyMs}ms` : '—'}
              </span>
              <span className="px-2 py-1 rounded border border-gray-700 text-gray-300 bg-black/20">
                WALLET {shortAddress(snapshot?.config?.walletAddress)}
              </span>
              <span className="px-2 py-1 rounded border border-gray-700 text-gray-300 bg-black/20">
                MODEL {snapshot?.config?.inferenceModel || '—'}
              </span>
            </div>
          </div>
          <button
            onClick={() => onNavigate('MISSION_CONTROL')}
            className="flex items-center gap-2 bg-neonCyan/10 hover:bg-neonCyan/20 text-neonCyan border border-neonCyan/50 px-6 py-3 rounded-lg font-mono font-bold transition-all group shrink-0"
          >
            <Play className="w-5 h-5 fill-neonCyan group-hover:scale-110 transition-transform" />
            ENTER MISSION CONTROL
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-panelBg border border-panelBorder rounded-xl p-6 group hover:border-gray-600 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-mono tracking-widest text-gray-500">OPERATING EFFICIENCY</h3>
            <Zap className="w-5 h-5 text-yellow-400/80" />
          </div>
          <div className="text-3xl font-mono font-light text-white mb-2">{status ? `${efficiency}%` : '—'}</div>
          <div className="flex items-center gap-2 text-xs text-green-400">
            <TrendingUp className="w-3 h-3" />
            <span>{status ? `Health: ${healthLabel(roughHealth)}` : 'Awaiting runtime API'}</span>
          </div>
        </div>

        <div className="bg-panelBg border border-panelBorder rounded-xl p-6 group hover:border-gray-600 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-mono tracking-widest text-gray-500">ACTIVE HEARTBEATS</h3>
            <Server className="w-5 h-5 text-deptDev/80" />
          </div>
          <div className="text-3xl font-mono font-light text-white mb-2">
            {status ? `${enabledHeartbeats}/${totalHeartbeats}` : '—'}
          </div>
          <p className="text-xs text-gray-500">Automaton scheduled tasks enabled</p>
        </div>

        <div
          className="bg-panelBg border border-panelBorder rounded-xl p-6 group hover:border-gray-600 transition-colors cursor-pointer"
          onClick={() => onNavigate('TREASURY')}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-mono tracking-widest text-gray-500">TREASURY PENDING</h3>
            <span className={`w-2 h-2 rounded-full ${pendingApprovals > 0 ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`}></span>
          </div>
          <div className="text-3xl font-mono font-light text-white mb-2">{pendingApprovals}</div>
          <p className="text-xs text-gray-400 group-hover:text-white transition-colors">Open treasury queue &rarr;</p>
        </div>

        <div
          className="bg-panelBg border border-panelBorder rounded-xl p-6 group hover:border-gray-600 transition-colors cursor-pointer"
          onClick={() => onNavigate('MONITORING')}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-mono tracking-widest text-gray-500">SPEND (24H)</h3>
            <span className="text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded uppercase font-bold">Treasury</span>
          </div>
          <div className="text-3xl font-mono font-light text-white mb-2">
            {treasury ? formatUsd(treasury.executedSpendLast24hCents) : '—'}
          </div>
          <p className="text-xs text-gray-500 font-mono">
            {status ? `${status.turnCount} turns recorded` : 'No runtime snapshot'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 flex-1 min-h-[360px]">
        <div className="xl:col-span-2 border border-panelBorder bg-panelBg rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
            <h3 className="font-mono tracking-widest text-gray-400">TREASURY APPROVAL QUEUE</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${pendingIntents.length > 0 ? 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10' : 'text-green-400 border-green-500/30 bg-green-500/10'}`}>
              {pendingIntents.length > 0 ? `${pendingIntents.length} PENDING` : 'CLEAR'}
            </span>
          </div>

          <div className="space-y-3">
            {treasuryActionStatus && (
              <div className="text-xs font-mono border border-green-500/30 bg-green-500/10 text-green-300 rounded p-2">
                {treasuryActionStatus}
              </div>
            )}
            {treasuryActionError && (
              <div className="text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">
                {treasuryActionError}
              </div>
            )}

            {pendingIntents.length === 0 && (
              <div className="text-sm text-gray-500 font-mono py-8 text-center">
                No pending treasury approvals in recent intents.
              </div>
            )}

            {pendingIntents.map((intent) => {
              const busy = treasuryActionBusyId === intent.id;
              const policyReasons = intent.policy?.reasons?.slice(0, 2).join(', ') || 'human review required';
              return (
                <div key={intent.id} className="border border-gray-800 rounded-lg p-3 bg-black/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-mono text-white">{formatUsdFromCents(intent.amountCents)}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-yellow-500/20 bg-yellow-500/10 text-yellow-300 uppercase">
                          {intent.status.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">{relativeTime(intent.createdAt)}</span>
                      </div>
                      <div className="text-xs text-gray-400 font-mono mt-1">
                        {shortAddress(intent.toAddress)} • {shortId(intent.id)}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        {intent.reason || 'No reason provided'}
                      </div>
                      <div className="text-[10px] text-gray-600 font-mono mt-1">
                        POLICY: {policyReasons}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={busy}
                      onClick={() => void handleApproveAndExecute(intent.id)}
                      className="text-[11px] font-mono px-3 py-1.5 rounded border border-neonCyan/50 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {busy ? 'PROCESSING...' : 'APPROVE + EXECUTE'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void handleApproveOnly(intent.id)}
                      className="text-[11px] font-mono px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      APPROVE ONLY
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void handleReject(intent.id)}
                      className="text-[11px] font-mono px-3 py-1.5 rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      REJECT
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-3 border border-panelBorder bg-panelBg rounded-xl p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-800">
            <h3 className="font-mono tracking-widest text-gray-400">SYSTEM EVENT LOG</h3>
            <button
              onClick={() => void runtime.refresh()}
              className="text-xs font-mono border border-gray-700 px-3 py-1 rounded hover:border-neonCyan hover:text-neonCyan transition-colors"
            >
              REFRESH
            </button>
          </div>
          <div className="space-y-4">
            {eventItems.length === 0 && (
              <div className="text-sm text-gray-500 font-mono">No runtime events yet. Start the automaton and dashboard API bridge.</div>
            )}
            {eventItems.map((item, index) => (
              <div key={`${item.kind}-${index}`} className="flex gap-4 items-start">
                <div className={`mt-1 w-2 h-2 rounded-full ${item.color}`}></div>
                <div>
                  <p className="text-sm text-gray-300">{item.text}</p>
                  <p className="text-xs font-mono text-gray-600 mt-1">{item.meta}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
