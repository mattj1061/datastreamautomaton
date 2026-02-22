import { Activity, CheckCircle2, CircleDashed, Clock3, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { useMemo } from 'react';
import type { AutomatonDashboardRuntime } from '../types/automaton';

type HeartbeatStatus = 'scheduled' | 'due' | 'overdue' | 'disabled';

type HeartbeatView = {
  id: string;
  name: string;
  task: string;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  status: HeartbeatStatus;
  progressPct: number;
  dept: 'research' | 'dev' | 'product' | 'creative' | 'leadership';
};

interface TasksViewProps {
  runtime: AutomatonDashboardRuntime;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function relativeTime(iso: string | null | undefined): string {
  const t = parseMs(iso);
  if (t == null) return '—';
  const deltaSec = Math.floor((Date.now() - t) / 1000);
  const sign = deltaSec >= 0 ? '' : '-';
  const abs = Math.abs(deltaSec);
  if (abs < 60) return `${sign}${abs}s`;
  if (abs < 3600) return `${sign}${Math.floor(abs / 60)}m`;
  if (abs < 86400) return `${sign}${Math.floor(abs / 3600)}h`;
  return `${sign}${Math.floor(abs / 86400)}d`;
}

function formatLocalTime(iso: string | null | undefined): string {
  const t = parseMs(iso);
  if (t == null) return '—';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function inferDept(task: string, name: string): HeartbeatView['dept'] {
  const text = `${task} ${name}`.toLowerCase();
  if (text.includes('pricing') || text.includes('customer') || text.includes('demand') || text.includes('profit')) return 'product';
  if (text.includes('synthesis') || text.includes('source') || text.includes('quality') || text.includes('research')) return 'research';
  if (text.includes('creative') || text.includes('render')) return 'creative';
  if (text.includes('survival') || text.includes('heartbeat') || text.includes('pipeline') || text.includes('health')) return 'dev';
  return 'leadership';
}

function deriveHeartbeatStatus(enabled: boolean, _lastRun: string | null, nextRun: string | null): HeartbeatStatus {
  if (!enabled) return 'disabled';
  const now = Date.now();
  const next = parseMs(nextRun);
  if (next != null) {
    if (next < now) return 'overdue';
    if (next - now <= 60_000) return 'due';
  }
  return 'scheduled';
}

function deriveCycleProgress(lastRun: string | null, nextRun: string | null, status: HeartbeatStatus): number {
  if (status === 'disabled') return 0;
  const now = Date.now();
  const last = parseMs(lastRun);
  const next = parseMs(nextRun);
  if (last != null && next != null && next > last) {
    const pct = Math.round(((now - last) / (next - last)) * 100);
    return Math.max(0, Math.min(100, pct));
  }
  if (status === 'overdue') return 100;
  if (status === 'due') return 90;
  return 25;
}

function statusLabel(status: HeartbeatStatus): string {
  switch (status) {
    case 'scheduled':
      return 'scheduled';
    case 'due':
      return 'due_soon';
    case 'overdue':
      return 'overdue';
    case 'disabled':
      return 'disabled';
    default:
      return status;
  }
}

function statusIcon(status: HeartbeatStatus, dept: HeartbeatView['dept']) {
  const colorMap: Record<HeartbeatView['dept'], string> = {
    leadership: 'text-gray-300',
    research: 'text-deptResearch',
    dev: 'text-deptDev',
    product: 'text-neonCyan',
    creative: 'text-deptCreative',
  };
  const cls = colorMap[dept] || 'text-gray-400';
  if (status === 'disabled') return <PauseCircle className="w-4 h-4 text-gray-500" />;
  if (status === 'overdue') return <Activity className="w-4 h-4 text-red-400" />;
  if (status === 'due') return <Loader2 className={`w-4 h-4 animate-spin ${cls}`} />;
  return <PlayCircle className={`w-4 h-4 ${cls}`} />;
}

function statusDotClass(status: HeartbeatStatus): string {
  switch (status) {
    case 'scheduled':
      return 'bg-green-500';
    case 'due':
      return 'bg-yellow-400 animate-pulse';
    case 'overdue':
      return 'bg-red-400 animate-pulse';
    case 'disabled':
      return 'bg-gray-600';
    default:
      return 'bg-gray-600';
  }
}

export function TasksView({ runtime }: TasksViewProps) {
  const snapshot = runtime.snapshot;
  const heartbeats = snapshot?.heartbeats || [];
  const recentTurns = snapshot?.activity?.recentTurns || [];

  const heartbeatViews = useMemo<HeartbeatView[]>(() => {
    return heartbeats
      .map((hb) => {
        const status = deriveHeartbeatStatus(Boolean(hb.enabled), hb.lastRun || null, hb.nextRun || null);
        return {
          id: `${hb.name}:${hb.task}`,
          name: hb.name,
          task: hb.task,
          schedule: hb.schedule,
          enabled: Boolean(hb.enabled),
          lastRun: hb.lastRun || null,
          nextRun: hb.nextRun || null,
          status,
          progressPct: deriveCycleProgress(hb.lastRun || null, hb.nextRun || null, status),
          dept: inferDept(hb.task || '', hb.name || ''),
        };
      })
      .sort((a, b) => {
        const rank = (s: HeartbeatStatus) => (s === 'overdue' ? 0 : s === 'due' ? 1 : s === 'scheduled' ? 2 : 3);
        const r = rank(a.status) - rank(b.status);
        if (r !== 0) return r;
        const an = parseMs(a.nextRun) ?? Number.MAX_SAFE_INTEGER;
        const bn = parseMs(b.nextRun) ?? Number.MAX_SAFE_INTEGER;
        return an - bn;
      });
  }, [heartbeats]);

  const telemetryLines = useMemo(() => {
    const lines: Array<{ key: string; time: string; tag: string; tagClass: string; text: string }> = [];

    for (const turn of recentTurns.slice(0, 8)) {
      const errorCalls = turn.toolCalls.filter((tc) => Boolean(tc.error)).length;
      const tokenText = turn.tokenUsage?.totalTokens ? `${turn.tokenUsage.totalTokens.toLocaleString()} tok` : 'tokens n/a';
      lines.push({
        key: `turn-${turn.id}`,
        time: formatLocalTime(turn.timestamp),
        tag: (turn.inputSource || 'system').toUpperCase(),
        tagClass: errorCalls > 0 ? 'text-red-300' : 'text-neonCyan',
        text: `${turn.state.toUpperCase()} turn • tools=${turn.toolCalls.length} • errors=${errorCalls} • ${tokenText}`,
      });

      for (const [idx, tc] of turn.toolCalls.slice(0, 2).entries()) {
        lines.push({
          key: `tool-${turn.id}-${idx}-${tc.name}`,
          time: formatLocalTime(turn.timestamp),
          tag: tc.name.toUpperCase().slice(0, 12),
          tagClass: tc.error ? 'text-red-300' : 'text-deptDev',
          text: tc.error ? `tool error • ${tc.error}` : `tool ok • ${tc.durationMs}ms`,
        });
      }
    }

    return lines.slice(0, 20);
  }, [recentTurns]);

  const recentHeartbeatExecutions = useMemo(
    () => heartbeatViews.filter((hb) => hb.lastRun).sort((a, b) => (parseMs(b.lastRun) ?? 0) - (parseMs(a.lastRun) ?? 0)).slice(0, 10),
    [heartbeatViews],
  );

  const dueCount = heartbeatViews.filter((hb) => hb.status === 'due' || hb.status === 'overdue').length;
  const enabledCount = heartbeatViews.filter((hb) => hb.enabled).length;
  const toolErrorCalls = recentTurns.reduce((acc, turn) => acc + turn.toolCalls.filter((tc) => Boolean(tc.error)).length, 0);

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in pb-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-light font-mono">Active <span className="text-neonCyan">Tasks</span></h2>
          <p className="text-xs text-gray-500 mt-1">Live heartbeat schedules and recent runtime executions from the automaton snapshot.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill label="SNAPSHOT" value={runtime.connected ? 'CONNECTED' : 'DISCONNECTED'} tone={runtime.connected ? 'green' : 'yellow'} />
          <StatusPill label="HEARTBEATS" value={`${enabledCount}/${heartbeatViews.length}`} tone="cyan" />
          <StatusPill label="DUE/OVERDUE" value={String(dueCount)} tone={dueCount > 0 ? 'yellow' : 'green'} />
          <StatusPill label="TOOL ERRORS" value={String(toolErrorCalls)} tone={toolErrorCalls > 0 ? 'red' : 'green'} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[500px]">
        <div className="border border-panelBorder bg-panelBg rounded-lg p-5 flex flex-col">
          <h3 className="font-mono text-sm tracking-widest text-gray-400 mb-4 pb-2 border-b border-gray-800">HEARTBEAT SCHEDULE</h3>

          <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {heartbeatViews.map((hb) => (
              <HeartbeatCard key={hb.id} heartbeat={hb} />
            ))}

            {heartbeatViews.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-500 font-mono text-sm">
                No heartbeat schedule data in runtime snapshot.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 h-full">
          <div className="flex-1 border border-panelBorder bg-[#060B14] rounded-lg p-4 flex flex-col font-mono relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-deptDev to-transparent opacity-50"></div>

            <div className="flex items-center justify-between mb-3 border-b border-gray-800 pb-2">
              <h3 className="text-xs tracking-widest text-gray-500 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-neonCyan" />
                LIVE RUNTIME TELEMETRY
              </h3>
              <span className="text-[10px] text-gray-600">{snapshot?.generatedAt ? `snapshot ${formatLocalTime(snapshot.generatedAt)}` : 'awaiting snapshot'}</span>
            </div>

            <div className="flex-1 overflow-y-auto text-xs text-gray-400 space-y-2 custom-scrollbar">
              {telemetryLines.length === 0 && (
                <div className="text-gray-500 font-mono py-4">No recent turn telemetry yet.</div>
              )}
              {telemetryLines.map((line) => (
                <div key={line.key} className="flex gap-3">
                  <span className="text-gray-600 w-[72px] shrink-0">[{line.time}]</span>
                  <span className={`${line.tagClass} w-[96px] shrink-0 truncate`}>[{line.tag}]</span>
                  <span className="text-gray-300 break-words">{line.text}</span>
                </div>
              ))}
              <div className="mt-4 flex gap-2 w-full pt-2">
                <span className="w-2 h-4 bg-neonCyan animate-pulse"></span>
              </div>
            </div>
          </div>

          <div className="h-1/3 border border-panelBorder bg-panelBg rounded-lg p-5 flex flex-col min-h-[180px]">
            <h3 className="font-mono text-sm tracking-widest text-gray-400 mb-3 pb-2 border-b border-gray-800">RECENT HEARTBEAT EXECUTIONS</h3>
            <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar">
              {recentHeartbeatExecutions.map((hb) => (
                <div key={`exec-${hb.id}`} className="flex items-center gap-3 text-sm p-2 hover:bg-white/5 rounded transition-colors group">
                  <CheckCircle2 className="w-4 h-4 text-gray-500 group-hover:text-green-500 transition-colors" />
                  <span className="font-mono text-xs text-gray-400 w-20 truncate" title={hb.name}>{hb.name}</span>
                  <span className="text-gray-300 flex-1 truncate" title={hb.task}>{hb.task}</span>
                  <span className="text-xs font-mono text-gray-600 shrink-0">{relativeTime(hb.lastRun)}</span>
                </div>
              ))}
              {recentHeartbeatExecutions.length === 0 && (
                <div className="text-gray-500 font-mono text-sm py-4">No heartbeat execution timestamps recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeartbeatCard({ heartbeat }: { heartbeat: HeartbeatView }) {
  const deptColors: Record<HeartbeatView['dept'], string> = {
    leadership: 'text-gray-300 bg-gray-500/10 border-gray-500',
    research: 'text-deptResearch bg-deptResearch/10 border-deptResearch',
    dev: 'text-deptDev bg-deptDev/10 border-deptDev',
    creative: 'text-deptCreative bg-deptCreative/10 border-deptCreative',
    product: 'text-neonCyan bg-neonCyan/10 border-neonCyan',
  };

  const progressColors: Record<HeartbeatView['dept'], string> = {
    leadership: 'bg-gray-400',
    research: 'bg-deptResearch',
    dev: 'bg-deptDev',
    creative: 'bg-deptCreative',
    product: 'bg-neonCyan',
  };

  return (
    <div className="p-4 rounded border border-gray-800 bg-black/20 hover:border-gray-600 transition-colors">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-[#060B14] flex items-center justify-center border border-gray-800 shrink-0">
            {statusIcon(heartbeat.status, heartbeat.dept)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${deptColors[heartbeat.dept]}`}>{heartbeat.name}</span>
              <span className="text-xs font-mono text-gray-500">[{statusLabel(heartbeat.status)}]</span>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(heartbeat.status)}`}></span>
            </div>
            <div className="text-[10px] text-gray-600 font-mono mt-1 truncate" title={heartbeat.schedule}>{heartbeat.schedule || 'schedule n/a'}</div>
          </div>
        </div>
        <div className="text-xl font-mono font-light text-gray-300 shrink-0">{heartbeat.progressPct}%</div>
      </div>

      <p className="text-sm text-gray-200 mb-3 ml-11 break-words">{heartbeat.task}</p>

      <div className="ml-11 h-1 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${progressColors[heartbeat.dept]} transition-all duration-500`}
          style={{ width: `${heartbeat.progressPct}%` }}
        ></div>
      </div>

      <div className="ml-11 mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono text-gray-500">
        <div className="flex items-center gap-1.5"><Clock3 className="w-3 h-3" /> last: {heartbeat.lastRun ? `${relativeTime(heartbeat.lastRun)} (${formatLocalTime(heartbeat.lastRun)})` : '—'}</div>
        <div className="flex items-center gap-1.5"><CircleDashed className="w-3 h-3" /> next: {heartbeat.nextRun ? `${relativeTime(heartbeat.nextRun)} (${formatLocalTime(heartbeat.nextRun)})` : '—'}</div>
      </div>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone: 'green' | 'yellow' | 'red' | 'cyan' }) {
  const tones: Record<'green' | 'yellow' | 'red' | 'cyan', string> = {
    green: 'border-green-500/30 bg-green-500/10 text-green-300',
    yellow: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
    cyan: 'border-neonCyan/30 bg-neonCyan/10 text-neonCyan',
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${tones[tone]}`}>
      <span className="text-[10px] font-mono opacity-80">{label}</span>
      <span className="text-xs font-mono">{value}</span>
    </div>
  );
}
