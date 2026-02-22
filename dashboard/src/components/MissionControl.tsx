import { Activity, AlertTriangle, CheckCircle2, Cpu, Database, Network, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AutomatonDashboardRuntime } from '../types/automaton';
import { OperatorStackPanel } from './OperatorStackPanel';

type AlertType = 'error' | 'warning' | 'info';

interface Alert {
  id: string;
  type: AlertType;
  message: string;
  time: string;
  agent: string;
}

interface MissionControlProps {
  runtime: AutomatonDashboardRuntime;
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

function formatUsd(cents: number | undefined): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export function MissionControl({ runtime }: MissionControlProps) {
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);

  const snapshot = runtime.snapshot;
  const status = snapshot?.status;
  const treasury = snapshot?.treasury;
  const telemetry = snapshot?.telemetry;
  const recentTurns = snapshot?.activity?.recentTurns || [];
  const lastTurn = recentTurns[0];
  const lastTurnAgeMs = status?.lastTurnAt ? Date.now() - new Date(status.lastTurnAt).getTime() : null;
  const toolErrorCount = recentTurns.reduce(
    (acc, turn) => acc + turn.toolCalls.filter((tc) => Boolean(tc.error)).length,
    0,
  );

  const generatedAlerts = useMemo<Alert[]>(() => {
    const items: Alert[] = [];

    if (!runtime.connected) {
      items.push({
        id: 'api-disconnected',
        type: 'error',
        message: 'Dashboard API bridge is disconnected. Runtime snapshot and controls may be stale.',
        time: 'now',
        agent: 'System',
      });
    }

    if ((treasury?.pendingApprovalCount ?? 0) > 0) {
      items.push({
        id: 'treasury-pending',
        type: 'warning',
        message: `${treasury?.pendingApprovalCount ?? 0} treasury request(s) pending human approval.`,
        time: 'live',
        agent: 'Treasury',
      });
    }

    const failedIntents = treasury?.counts?.failed ?? 0;
    if (failedIntents > 0) {
      items.push({
        id: 'treasury-failed',
        type: 'error',
        message: `${failedIntents} treasury transfer intent(s) are marked failed. Review execution and signer logs.`,
        time: 'live',
        agent: 'Treasury',
      });
    }

    if (typeof lastTurnAgeMs === 'number' && Number.isFinite(lastTurnAgeMs) && lastTurnAgeMs > 20 * 60 * 1000) {
      items.push({
        id: 'turn-freshness',
        type: 'warning',
        message: `No recent automaton turn activity for ${Math.floor(lastTurnAgeMs / 60000)}m while heartbeats are enabled.`,
        time: relativeTime(status?.lastTurnAt),
        agent: 'Scheduler',
      });
    }

    if (toolErrorCount > 0) {
      items.push({
        id: 'recent-tool-errors',
        type: 'warning',
        message: `${toolErrorCount} tool call error(s) detected in recent turns. Inspect monitoring and turn logs.`,
        time: relativeTime(lastTurn?.timestamp),
        agent: 'Runtime',
      });
    }

    if (runtime.connected && items.length === 0) {
      items.push({
        id: 'all-clear',
        type: 'info',
        message: 'Runtime snapshot connected and no immediate treasury or freshness issues detected.',
        time: 'live',
        agent: 'System',
      });
    }

    return items;
  }, [lastTurn?.timestamp, lastTurnAgeMs, runtime.connected, status?.lastTurnAt, toolErrorCount, treasury?.counts?.failed, treasury?.pendingApprovalCount]);

  const alerts = generatedAlerts.filter((alert) => !dismissedAlertIds.includes(alert.id));

  const handleDismiss = (id: string) => {
    setDismissedAlertIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const roughHealth = runtime.connected ? (status?.roughHealth || 'unknown') : 'offline';
  const healthLabel = roughHealth === 'nominal' ? 'NOMINAL' : roughHealth === 'attention' ? 'ATTENTION' : roughHealth === 'warning' ? 'WARNING' : 'OFFLINE';
  const healthColor = roughHealth === 'nominal' ? 'text-green-500' : roughHealth === 'attention' ? 'text-yellow-400' : roughHealth === 'warning' ? 'text-red-400' : 'text-gray-400';

  const enabledHeartbeats = status?.heartbeatEnabled ?? 0;
  const totalHeartbeats = status?.heartbeatTotal ?? 0;
  const heapPct = telemetry && telemetry.nodeHeapTotalMb > 0
    ? Math.round((telemetry.nodeHeapUsedMb / telemetry.nodeHeapTotalMb) * 100)
    : null;

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in pb-10">
      <h2 className="text-2xl font-light font-mono">Mission <span className="text-neonCyan">Control</span></h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="RUNTIME STATUS" value={healthLabel} icon={<CheckCircle2 className={`w-5 h-5 ${healthColor}`} />} color={healthColor} />
        <MetricCard title="HEARTBEATS" value={status ? `${enabledHeartbeats}/${totalHeartbeats}` : '--'} icon={<Network className="text-neonCyan w-5 h-5" />} color="text-neonCyan" />
        <MetricCard title="NODE HEAP" value={heapPct != null ? `${heapPct}%` : '--'} icon={<Cpu className="text-deptDev w-5 h-5" />} color="text-white" />
        <MetricCard title="TREASURY PENDING" value={String(treasury?.pendingApprovalCount ?? 0)} icon={<Database className="text-deptResearch w-5 h-5" />} color="text-white" />
      </div>

      <OperatorStackPanel compact />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[500px]">
        <div className="lg:col-span-1 border border-panelBorder bg-panelBg rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-800">
            <h3 className="font-mono text-sm tracking-widest text-gray-400">PRIORITY ALERTS</h3>
            {alerts.length > 0 ? (
              <span className="bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5 rounded font-mono">{alerts.length} OPEN</span>
            ) : (
              <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded font-mono">CLEAR</span>
            )}
          </div>

          <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
            {alerts.map((alert) => (
              <AlertItem key={alert.id} {...alert} onDismiss={() => handleDismiss(alert.id)} />
            ))}
            {alerts.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-mono mt-8">
                No active alerts.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 border border-panelBorder bg-panelBg rounded-lg p-6 relative overflow-hidden group">
          <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none"></div>

          <div className="relative z-10 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-500/10 border border-gray-500 flex items-center justify-center font-bold text-xs font-mono text-gray-300">
                  MC
                </div>
                <div>
                  <h3 className="font-mono text-sm tracking-widest text-neonCyan">AUTOMATON OPERATOR BRIEF</h3>
                  <p className="text-xs text-gray-500">Live runtime + treasury summary • {snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString() : 'awaiting API'}</p>
                </div>
              </div>
              <button
                onClick={() => void runtime.refresh()}
                className="text-xs font-mono border border-panelBorder px-3 py-1.5 rounded hover:bg-white/5 transition-colors"
              >
                REFRESH SNAPSHOT
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 text-sm text-gray-300 pr-4 custom-scrollbar">
              <section>
                <h4 className="text-deptResearch font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-deptResearch"></div> RUNTIME SNAPSHOT</h4>
                <p className="pl-3.5 border-l border-gray-800 text-gray-400 leading-relaxed">
                  Agent state is <span className="text-gray-200">{status?.agentState || 'unknown'}</span> with <span className="text-gray-200">{status?.turnCount ?? 0}</span> recorded turns. Last turn was <span className="text-gray-200">{relativeTime(status?.lastTurnAt)}</span> and current rough health is <span className="text-gray-200">{String(status?.roughHealth || 'unknown')}</span>.
                </p>
              </section>

              <section>
                <h4 className="text-deptDev font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-deptDev"></div> ENGINEERING / HEARTBEATS</h4>
                <p className="pl-3.5 border-l border-gray-800 text-gray-400 leading-relaxed">
                  {enabledHeartbeats}/{totalHeartbeats} heartbeat tasks are enabled. Node RSS is <span className="text-gray-200">{telemetry?.nodeRssMb ?? '—'} MB</span> and heap usage is <span className="text-gray-200">{telemetry?.nodeHeapUsedMb ?? '—'} / {telemetry?.nodeHeapTotalMb ?? '—'} MB</span>.
                </p>
              </section>

              <section>
                <h4 className="text-yellow-500 font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500"></div> TREASURY STATUS</h4>
                <div className="pl-3.5 border-l border-gray-800 p-3 bg-yellow-500/5 rounded border border-yellow-500/10 mt-2">
                  <p className="text-gray-300">
                    Pending approvals: <span className="font-mono text-gray-100">{treasury?.pendingApprovalCount ?? 0}</span> • Failed intents: <span className="font-mono text-gray-100">{treasury?.counts?.failed ?? 0}</span> • Executed spend (24h): <span className="font-mono text-gray-100">{formatUsd(treasury?.executedSpendLast24hCents)}</span>
                  </p>
                </div>
              </section>

              <section>
                <h4 className="text-neonCyan font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-neonCyan"></div> RECENT TURN SUMMARY</h4>
                <p className="pl-3.5 border-l border-gray-800 text-gray-400 leading-relaxed">
                  {lastTurn?.thinkingPreview
                    ? `${lastTurn.state.toUpperCase()} (${relativeTime(lastTurn.timestamp)}): ${lastTurn.thinkingPreview}`
                    : 'No recent turn preview is available yet. Start or wake the automaton runtime to populate live mission context.'}
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon, color }: { title: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="border border-panelBorder bg-panelBg rounded-lg p-4 flex items-center justify-between group hover:border-gray-600 transition-colors">
      <div>
        <h4 className="text-xs text-gray-500 font-mono mb-1 tracking-wider">{title}</h4>
        <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
      </div>
      <div className="p-2 bg-black/20 rounded-lg border border-white/5">{icon}</div>
    </div>
  );
}

function AlertItem({ type, message, time, agent, onDismiss }: { type: AlertType; message: string; time: string; agent: string; onDismiss: () => void }) {
  const colors = {
    error: 'text-red-400 border-red-500/20 bg-red-500/5',
    warning: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/5',
    info: 'text-neonCyan border-neonCyan/20 bg-neonCyan/5',
  };

  const icons = {
    error: <AlertTriangle className="w-4 h-4" />,
    warning: <AlertTriangle className="w-4 h-4" />,
    info: <Activity className="w-4 h-4" />,
  };

  return (
    <div className={`p-3 rounded border text-sm flex gap-3 group relative overflow-hidden pr-8 transition-colors ${colors[type]}`}>
      <div className="mt-0.5">{icons[type]}</div>
      <div className="flex-1">
        <p className="mb-1 text-gray-200">{message}</p>
        <div className="flex justify-between items-center text-[10px] font-mono text-gray-500 uppercase gap-4">
          <span>{agent}</span>
          <span>{time}</span>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-black/20 rounded text-gray-400 hover:text-white transition-all"
        title="Dismiss Alert"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
