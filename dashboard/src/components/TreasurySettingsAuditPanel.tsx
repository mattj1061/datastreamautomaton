import { useCallback, useEffect, useState } from 'react';
import { History, RefreshCcw } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

interface TreasurySettingsAuditEntry {
  at: string;
  actor: string;
  reason: string;
  envFilePath?: string;
  auditLogPath?: string;
  changedSettingKeys?: string[];
  diff?: Record<string, { before: unknown; after: unknown }>;
}

interface TreasurySettingsAuditResponse {
  ok: boolean;
  error?: string;
  audit?: {
    logPath: string;
    file: {
      exists: boolean;
      sizeBytes: number;
      mtime: string | null;
    };
    limit: number;
    entries: TreasurySettingsAuditEntry[];
  };
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

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  if (value == null) return 'null';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface TreasurySettingsAuditPanelProps {
  limit?: number;
}

export function TreasurySettingsAuditPanel({ limit = 10 }: TreasurySettingsAuditPanelProps) {
  const [entries, setEntries] = useState<TreasurySettingsAuditEntry[]>([]);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    try {
      const resp = await apiFetch(`/api/treasury/settings/audit?limit=${encodeURIComponent(String(limit))}`, {
        cache: 'no-store',
      }, { scope: 'read' });
      const data = (await resp.json()) as TreasurySettingsAuditResponse;
      if (!resp.ok || data?.ok === false || !data.audit) {
        throw new Error(data?.error || `Treasury settings audit load failed (${resp.status})`);
      }
      setEntries(Array.isArray(data.audit.entries) ? data.audit.entries : []);
      setLogPath(data.audit.logPath || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadAudit();
    const timer = window.setInterval(() => {
      void loadAudit();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadAudit]);

  return (
    <div className="border border-panelBorder bg-panelBg rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-800">
        <div>
          <h3 className="font-mono tracking-widest text-gray-300 flex items-center gap-2">
            <History className="w-4 h-4 text-neonCyan" />
            TREASURY SETTINGS AUDIT
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Recent policy changes saved from the dashboard. {logPath ? <span className="font-mono">{logPath}</span> : ''}
          </p>
        </div>
        <button
          onClick={() => void loadAudit()}
          className="text-xs font-mono border border-gray-700 px-3 py-2 rounded hover:border-gray-500 text-gray-300 transition-colors"
          disabled={loading}
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCcw className="w-3.5 h-3.5" />
            {loading ? 'LOADING...' : 'REFRESH'}
          </span>
        </button>
      </div>

      {error && (
        <div className="mb-3 text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {!loading && entries.length === 0 && (
          <div className="text-sm font-mono text-gray-500 py-6 text-center">
            No settings changes have been logged yet.
          </div>
        )}

        {entries.map((entry, idx) => {
          const changedKeys = Array.isArray(entry.changedSettingKeys) ? entry.changedSettingKeys : [];
          const diffEntries = Object.entries(entry.diff || {});
          return (
            <div key={`${entry.at || 'entry'}-${idx}`} className="border border-gray-800 rounded p-3 bg-black/20">
              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center mb-1">
                    <span className="text-xs font-mono px-2 py-0.5 rounded border border-neonCyan/20 bg-neonCyan/5 text-neonCyan">
                      {entry.actor || 'unknown-actor'}
                    </span>
                    <span className="text-[10px] font-mono text-gray-500">{relativeTime(entry.at)}</span>
                    <span className="text-[10px] font-mono text-gray-600">{entry.at ? new Date(entry.at).toLocaleString() : '—'}</span>
                  </div>
                  <div className="text-sm text-gray-200">{entry.reason || 'No reason recorded'}</div>
                  {changedKeys.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {changedKeys.map((key) => (
                        <span
                          key={`${entry.at}-${key}`}
                          className="text-[10px] font-mono px-2 py-0.5 rounded border border-gray-700 bg-black/20 text-gray-300"
                        >
                          {key}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {diffEntries.length > 0 && (
                <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-2">
                  {diffEntries.slice(0, 6).map(([key, change]) => (
                    <div key={`${entry.at}-${key}-diff`} className="border border-gray-800 rounded p-2 text-xs">
                      <div className="font-mono text-gray-400 mb-1">{key}</div>
                      <div className="text-gray-500">
                        before: <span className="text-gray-300 break-all">{summarizeValue(change.before)}</span>
                      </div>
                      <div className="text-gray-500 mt-1">
                        after: <span className="text-gray-200 break-all">{summarizeValue(change.after)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
