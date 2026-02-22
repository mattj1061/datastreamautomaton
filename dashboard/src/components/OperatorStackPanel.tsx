import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, RefreshCcw, RotateCcw, Square, Terminal } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import type { OperatorStackStatusResponse } from '../types/automaton';

type ComponentName = 'dashboard-api' | 'dashboard-ui' | 'telegram-listener' | 'treasury-worker-loop';
type ActionName = 'start' | 'stop' | 'restart';

const COMPONENT_ORDER: ComponentName[] = [
  'dashboard-api',
  'dashboard-ui',
  'telegram-listener',
  'treasury-worker-loop',
];

function componentLabel(name: ComponentName): string {
  switch (name) {
    case 'dashboard-api':
      return 'Dashboard API';
    case 'dashboard-ui':
      return 'Dashboard UI';
    case 'telegram-listener':
      return 'Telegram Listener';
    case 'treasury-worker-loop':
      return 'Treasury Worker Loop';
    default:
      return name;
  }
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case 'running':
      return 'border-green-500/30 bg-green-500/10 text-green-300';
    case 'external':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300';
    case 'stopped':
      return 'border-gray-700 bg-black/20 text-gray-400';
    case 'stale':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
    default:
      return 'border-gray-700 bg-black/20 text-gray-400';
  }
}

function formatState(state: string): string {
  return state.replace(/_/g, ' ').toUpperCase();
}

interface OperatorStackPanelProps {
  compact?: boolean;
}

export function OperatorStackPanel({ compact = false }: OperatorStackPanelProps) {
  const [data, setData] = useState<OperatorStackStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/operator-stack/status', { cache: 'no-store' }, { scope: 'read' });
      const json = (await resp.json()) as OperatorStackStatusResponse;
      if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || `Operator stack status failed (${resp.status})`);
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const components = data?.operatorStack?.components || {};
  const runningCount = useMemo(
    () => Object.values(components).filter((c) => c.state === 'running').length,
    [components],
  );

  async function runAction(action: ActionName, targetComponents: ComponentName[], force = false) {
    const key = `${action}:${targetComponents.join(',')}:${force ? 'force' : 'normal'}`;
    setBusyKey(key);
    setActionMessage(null);
    setActionError(null);
    try {
      const resp = await apiFetch(`/api/operator-stack/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: targetComponents, force }),
      }, { scope: 'write' });
      const json = (await resp.json()) as OperatorStackStatusResponse;
      if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || `Operator stack ${action} failed (${resp.status})`);
      }
      setData(json);
      setActionMessage(
        `${action.toUpperCase()} ${targetComponents.length === 1 ? componentLabel(targetComponents[0]) : `${targetComponents.length} components`}${force ? ' (force)' : ''}`,
      );
      setError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  const wrapperClass = compact
    ? 'border border-panelBorder bg-panelBg rounded-lg p-4'
    : 'border border-panelBorder bg-panelBg rounded-xl p-5';

  return (
    <div className={wrapperClass}>
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 mb-4 pb-3 border-b border-gray-800">
        <div>
          <h3 className="font-mono text-sm tracking-widest text-gray-300 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-neonCyan" />
            OPERATOR STACK CONTROL
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Local process control for dashboard + treasury listeners. {runningCount}/4 running.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void loadStatus()}
            disabled={loading || busyKey !== null}
            className="text-xs font-mono px-3 py-2 rounded border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            REFRESH
          </button>
          <button
            onClick={() => void runAction('restart', ['dashboard-api', 'dashboard-ui'], true)}
            disabled={busyKey !== null}
            className="text-xs font-mono px-3 py-2 rounded border border-neonCyan/50 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            RESTART DASHBOARD (--FORCE)
          </button>
        </div>
      </div>

      {(error || actionError || actionMessage) && (
        <div className="space-y-2 mb-4">
          {error && <div className="text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">{error}</div>}
          {actionError && <div className="text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">{actionError}</div>}
          {actionMessage && <div className="text-xs font-mono border border-green-500/30 bg-green-500/10 text-green-300 rounded p-2">{actionMessage}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {COMPONENT_ORDER.map((name) => {
          const component = components[name] || {
            name,
            state: 'unknown',
            pid: null,
            port: name === 'dashboard-api' ? 8787 : name === 'dashboard-ui' ? 5174 : null,
            details: 'No status yet',
            raw: '',
            logPath: null,
          };
          const rowBusy = busyKey?.includes(name) || false;
          return (
            <div key={name} className="border border-gray-800 rounded p-3 bg-black/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-sm text-gray-200 font-mono">{componentLabel(name)}</span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${stateBadgeClass(component.state)}`}>
                      {formatState(component.state)}
                    </span>
                    {component.port != null && (
                      <span className="text-[10px] font-mono text-gray-600">:{component.port}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 break-all">{component.details}</div>
                  {component.logPath && (
                    <div className="text-[10px] font-mono text-gray-600 mt-1 break-all">{component.logPath}</div>
                  )}
                </div>
                <div className="text-[10px] font-mono text-gray-500">
                  {component.pid ? `pid ${component.pid}` : '—'}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void runAction('start', [name])}
                  disabled={busyKey !== null}
                  className="text-[11px] font-mono px-2.5 py-1.5 rounded border border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3" />
                  START
                </button>
                <button
                  onClick={() => void runAction('restart', [name])}
                  disabled={busyKey !== null}
                  className="text-[11px] font-mono px-2.5 py-1.5 rounded border border-neonCyan/30 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3 h-3" />
                  RESTART
                </button>
                {(name === 'dashboard-api' || name === 'dashboard-ui') && (
                  <button
                    onClick={() => void runAction('restart', [name], true)}
                    disabled={busyKey !== null}
                    className="text-[11px] font-mono px-2.5 py-1.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-50"
                  >
                    RESTART --FORCE
                  </button>
                )}
                <button
                  onClick={() => void runAction('stop', [name])}
                  disabled={busyKey !== null}
                  className="text-[11px] font-mono px-2.5 py-1.5 rounded border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Square className="w-3 h-3" />
                  STOP
                </button>
                {rowBusy && <span className="text-[10px] font-mono text-gray-500 self-center">working…</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
