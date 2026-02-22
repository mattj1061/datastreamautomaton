import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Filter, RefreshCcw, Save, Send, ShieldAlert, SlidersHorizontal, XCircle } from 'lucide-react';
import { TreasurySettingsAuditPanel } from './TreasurySettingsAuditPanel';
import { apiFetch } from '../lib/apiFetch';
import type {
  AutomatonDashboardRuntime,
  DashboardIntentSummary,
  TreasuryIntentListResponse,
  TreasuryPolicySettingsEnvelope,
  TreasuryPolicySettingsValues,
  TreasurySettingsResponse,
} from '../types/automaton';

type StatusFilter =
  | 'all'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'submitted'
  | 'executed'
  | 'failed';

interface TreasuryViewProps {
  runtime: AutomatonDashboardRuntime;
}

function formatUsd(cents: number | null | undefined): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function formatUsdInputFromCents(cents: number | undefined): string {
  if (!Number.isFinite(cents)) return '0.00';
  return ((cents || 0) / 100).toFixed(2);
}

function parseUsdInputToCents(value: string, label: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  const parsed = Number(trimmed.replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return Math.max(0, Math.round(parsed * 100));
}

function shortAddress(value: string | undefined): string {
  if (!value) return '—';
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortId(value: string | undefined): string {
  if (!value) return '—';
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
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

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'pending_approval':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300';
    case 'approved':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
    case 'submitted':
      return 'border-neonCyan/30 bg-neonCyan/10 text-neonCyan';
    case 'executed':
      return 'border-green-500/30 bg-green-500/10 text-green-300';
    case 'failed':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    case 'rejected':
      return 'border-gray-600 bg-gray-800/30 text-gray-300';
    default:
      return 'border-gray-700 bg-black/20 text-gray-300';
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

interface TreasurySettingsFormState {
  requireAllowlist: boolean;
  allowlistText: string;
  minReserveUsd: string;
  autoApproveMaxUsd: string;
  hardPerTransferUsd: string;
  hardDailyLimitUsd: string;
  autoExecuteApproved: boolean;
}

function settingsValuesToForm(values: TreasuryPolicySettingsValues): TreasurySettingsFormState {
  return {
    requireAllowlist: Boolean(values.requireAllowlist),
    allowlistText: (values.allowlist || []).join('\n'),
    minReserveUsd: formatUsdInputFromCents(values.minReserveCents),
    autoApproveMaxUsd: formatUsdInputFromCents(values.autoApproveMaxCents),
    hardPerTransferUsd: formatUsdInputFromCents(values.hardPerTransferCents),
    hardDailyLimitUsd: formatUsdInputFromCents(values.hardDailyLimitCents),
    autoExecuteApproved: Boolean(values.autoExecuteApproved),
  };
}

export function TreasuryView({ runtime }: TreasuryViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intents, setIntents] = useState<DashboardIntentSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busyIntentId, setBusyIntentId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsMeta, setSettingsMeta] = useState<TreasuryPolicySettingsEnvelope | null>(null);
  const [settingsForm, setSettingsForm] = useState<TreasurySettingsFormState | null>(null);
  const [settingsBaseline, setSettingsBaseline] = useState<TreasurySettingsFormState | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [settingsChangeReason, setSettingsChangeReason] = useState('');
  const [settingsConfirmationInput, setSettingsConfirmationInput] = useState('');
  const [humanEditArmed, setHumanEditArmed] = useState(false);

  const loadIntents = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('status', statusFilter);
    params.set('limit', String(limit));
    if (search.trim()) params.set('q', search.trim());

    try {
      const resp = await apiFetch(`/api/treasury/intents?${params.toString()}`, {
        cache: 'no-store',
      }, { scope: 'read' });
      const data = (await resp.json()) as TreasuryIntentListResponse;
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.error || `Treasury list failed (${resp.status})`);
      }
      setIntents(Array.isArray(data.intents) ? data.intents : []);
      setCounts(data.counts || {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [limit, search, statusFilter]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const resp = await apiFetch('/api/treasury/settings', { cache: 'no-store' }, { scope: 'read' });
      const data = (await resp.json()) as TreasurySettingsResponse;
      if (!resp.ok || data?.ok === false || !data.settings) {
        throw new Error(data?.error || `Treasury settings load failed (${resp.status})`);
      }
      const nextForm = settingsValuesToForm(data.settings.values);
      setSettingsMeta(data.settings);
      setSettingsForm(nextForm);
      setSettingsBaseline(nextForm);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntents();
    const timer = window.setInterval(() => {
      void loadIntents();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadIntents]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadIntents(), runtime.refresh()]);
  }, [loadIntents, runtime]);

  const refreshAllWithSettings = useCallback(async () => {
    await Promise.all([loadIntents(), loadSettings(), runtime.refresh()]);
  }, [loadIntents, loadSettings, runtime]);

  const statusCounts = useMemo(
    () => ({
      pending: counts.pending_approval ?? runtime.snapshot?.treasury?.counts?.pending_approval ?? 0,
      approved: counts.approved ?? runtime.snapshot?.treasury?.counts?.approved ?? 0,
      submitted: counts.submitted ?? runtime.snapshot?.treasury?.counts?.submitted ?? 0,
      executed: counts.executed ?? runtime.snapshot?.treasury?.counts?.executed ?? 0,
      failed: counts.failed ?? runtime.snapshot?.treasury?.counts?.failed ?? 0,
      rejected: counts.rejected ?? runtime.snapshot?.treasury?.counts?.rejected ?? 0,
    }),
    [counts, runtime.snapshot?.treasury?.counts],
  );

  const settingsDirty = useMemo(() => {
    if (!settingsForm || !settingsBaseline) return false;
    return JSON.stringify(settingsForm) !== JSON.stringify(settingsBaseline);
  }, [settingsForm, settingsBaseline]);

  const settingsConfirmationPhrase = settingsMeta?.confirmationPhrase || 'APPLY TREASURY SETTINGS';

  const settingsCanSave = useMemo(() => {
    return Boolean(
      settingsForm &&
        settingsDirty &&
        !settingsSaving &&
        humanEditArmed &&
        settingsChangeReason.trim().length > 0 &&
        settingsConfirmationInput.trim() === settingsConfirmationPhrase,
    );
  }, [
    humanEditArmed,
    settingsChangeReason,
    settingsConfirmationInput,
    settingsConfirmationPhrase,
    settingsDirty,
    settingsForm,
    settingsSaving,
  ]);

  async function callAction(
    intentId: string,
    action: 'approve' | 'reject',
    payload: Record<string, unknown>,
  ) {
    setBusyIntentId(intentId);
    setActionError(null);
    setActionMessage(null);
    try {
      const resp = await apiFetch(`/api/treasury/intents/${encodeURIComponent(intentId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, { scope: 'write' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.error || `Treasury ${action} failed (${resp.status})`);
      }
      const execute = payload.execute === true;
      setActionMessage(
        action === 'reject'
          ? `Rejected ${shortId(intentId)}`
          : execute
            ? `Approved + queued ${shortId(intentId)}`
            : `Approved ${shortId(intentId)}`,
      );
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIntentId(null);
    }
  }

  async function approveOnly(intentId: string) {
    if (!window.confirm(`Approve transfer intent ${intentId} without execution?`)) return;
    await callAction(intentId, 'approve', { execute: false });
  }

  async function approveAndExecute(intentId: string) {
    if (!window.confirm(`Approve and execute (or queue) transfer intent ${intentId}?`)) return;
    await callAction(intentId, 'approve', { execute: true });
  }

  async function reject(intentId: string) {
    const reason = window.prompt(`Reject transfer intent ${intentId}. Reason:`, 'Rejected from dashboard UI');
    if (!reason || !reason.trim()) return;
    await callAction(intentId, 'reject', { reason: reason.trim() });
  }

  function updateSettingsForm<K extends keyof TreasurySettingsFormState>(
    key: K,
    value: TreasurySettingsFormState[K],
  ) {
    setSettingsForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveSettings() {
    if (!settingsForm) return;
    setSettingsSaveError(null);
    setSettingsSaveMessage(null);
    setSettingsSaving(true);
    try {
      const payload = {
        confirmationPhrase: settingsConfirmationInput.trim(),
        reason: settingsChangeReason.trim(),
        actor: 'dashboard-ui-human',
        settings: {
          requireAllowlist: settingsForm.requireAllowlist,
          allowlist: settingsForm.allowlistText,
          minReserveCents: parseUsdInputToCents(settingsForm.minReserveUsd, 'Min reserve'),
          autoApproveMaxCents: parseUsdInputToCents(
            settingsForm.autoApproveMaxUsd,
            'Auto-approve max',
          ),
          hardPerTransferCents: parseUsdInputToCents(
            settingsForm.hardPerTransferUsd,
            'Hard per-transfer cap',
          ),
          hardDailyLimitCents: parseUsdInputToCents(
            settingsForm.hardDailyLimitUsd,
            'Hard daily limit',
          ),
          autoExecuteApproved: settingsForm.autoExecuteApproved,
        },
      };

      const resp = await apiFetch('/api/treasury/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, { scope: 'write' });
      const data = (await resp.json()) as TreasurySettingsResponse;
      if (!resp.ok || data?.ok === false || !data.settings) {
        throw new Error(data?.error || `Treasury settings save failed (${resp.status})`);
      }

      const nextForm = settingsValuesToForm(data.settings.values);
      setSettingsMeta(data.settings);
      setSettingsForm(nextForm);
      setSettingsBaseline(nextForm);
      setSettingsSaveMessage(
        'Treasury settings saved to .env.synthesis. Restart the automaton runtime and treasury worker to apply across running processes.',
      );
      setSettingsChangeReason('');
      setSettingsConfirmationInput('');
      setHumanEditArmed(false);
      await refreshAllWithSettings();
    } catch (err) {
      setSettingsSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col p-8 pt-12 animate-fade-in overflow-y-auto custom-scrollbar">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-light font-mono">
            Treasury <span className="text-neonCyan">Control</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Review intents, approve/reject transfers, and track submitted/executed transactions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-mono px-2 py-1 rounded border ${
              runtime.connected
                ? 'text-green-300 border-green-500/30 bg-green-500/10'
                : 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10'
            }`}
          >
            {runtime.connected ? 'RUNTIME SNAPSHOT CONNECTED' : 'RUNTIME SNAPSHOT DISCONNECTED'}
          </span>
          <button
            onClick={() => void refreshAll()}
            className="flex items-center gap-2 text-xs font-mono border border-gray-700 px-3 py-2 rounded hover:border-neonCyan hover:text-neonCyan transition-colors"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            REFRESH
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <SummaryCard title="PENDING" value={statusCounts.pending} tone="yellow" />
        <SummaryCard title="APPROVED" value={statusCounts.approved} tone="blue" />
        <SummaryCard title="SUBMITTED" value={statusCounts.submitted} tone="cyan" />
        <SummaryCard title="EXECUTED" value={statusCounts.executed} tone="green" />
        <SummaryCard title="FAILED" value={statusCounts.failed} tone="red" />
        <SummaryCard
          title="SPEND (24H)"
          value={formatUsd(runtime.snapshot?.treasury?.executedSpendLast24hCents)}
          tone="neutral"
          monospace={true}
        />
      </div>

      <div className="border border-panelBorder bg-panelBg rounded-xl p-4 mb-6">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-4 pb-3 border-b border-gray-800">
          <div>
            <h3 className="font-mono tracking-widest text-gray-300 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-neonCyan" />
              TREASURY SETTINGS (HUMAN CONTROL)
            </h3>
            <p className="text-xs text-gray-500 mt-2">
              Edits write only the treasury policy keys in <span className="font-mono">{settingsMeta?.envFilePath || '.env.synthesis'}</span>.
              Running automaton/worker processes should be restarted after changes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadSettings()}
              className="text-xs font-mono border border-gray-700 px-3 py-2 rounded hover:border-gray-500 text-gray-300 transition-colors"
              disabled={settingsLoading || settingsSaving}
            >
              {settingsLoading ? 'LOADING...' : 'RELOAD SETTINGS'}
            </button>
          </div>
        </div>

        {settingsError && (
          <div className="mb-3 text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">
            {settingsError}
          </div>
        )}
        {settingsSaveError && (
          <div className="mb-3 text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">
            {settingsSaveError}
          </div>
        )}
        {settingsSaveMessage && (
          <div className="mb-3 text-xs font-mono border border-green-500/30 bg-green-500/10 text-green-300 rounded p-2">
            {settingsSaveMessage}
          </div>
        )}

        {settingsLoading || !settingsForm ? (
          <div className="text-sm font-mono text-gray-500 py-6">Loading treasury settings...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <label className="border border-gray-800 rounded p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-200">Require allowlist</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Non-allowlisted recipients require human review.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.requireAllowlist}
                  onChange={(e) => updateSettingsForm('requireAllowlist', e.target.checked)}
                  className="h-4 w-4 accent-cyan-400"
                />
              </label>

              <label className="border border-gray-800 rounded p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-200">Auto-execute approved intents</div>
                  <div className="text-xs text-gray-500 mt-1">
                    If enabled, approved intents can execute automatically in runtime paths that support it.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.autoExecuteApproved}
                  onChange={(e) => updateSettingsForm('autoExecuteApproved', e.target.checked)}
                  className="h-4 w-4 accent-cyan-400"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <FieldCard
                label="Daily Free-Will Budget (USD)"
                help="Hard 24h cap before human approval is required."
                value={settingsForm.hardDailyLimitUsd}
                onChange={(v) => updateSettingsForm('hardDailyLimitUsd', v)}
              />
              <FieldCard
                label="Auto-Approve Max (USD)"
                help="Requests above this require human approval."
                value={settingsForm.autoApproveMaxUsd}
                onChange={(v) => updateSettingsForm('autoApproveMaxUsd', v)}
              />
              <FieldCard
                label="Hard Per-Transfer Cap (USD)"
                help="Requests above this are rejected by policy."
                value={settingsForm.hardPerTransferUsd}
                onChange={(v) => updateSettingsForm('hardPerTransferUsd', v)}
              />
              <FieldCard
                label="Min Reserve (USD)"
                help="Projected post-spend balance must stay above this."
                value={settingsForm.minReserveUsd}
                onChange={(v) => updateSettingsForm('minReserveUsd', v)}
              />
            </div>

            <div className="border border-gray-800 rounded p-3">
              <div className="text-sm text-gray-200 mb-1">Treasury Allowlist (one address per line or comma-separated)</div>
              <div className="text-xs text-gray-500 mb-2">
                Keep the automaton base wallet allowlisted to avoid unnecessary approval prompts.
              </div>
              <textarea
                value={settingsForm.allowlistText}
                onChange={(e) => updateSettingsForm('allowlistText', e.target.value)}
                rows={4}
                className="w-full bg-black/40 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-neonCyan"
                placeholder="0xa706...&#10;0x..."
              />
            </div>

            <div className="border border-yellow-500/20 bg-yellow-500/5 rounded-lg p-3 space-y-3">
              <label className="flex items-start gap-3 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={humanEditArmed}
                  onChange={(e) => setHumanEditArmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-yellow-400"
                />
                <span>
                  I am a human operator making a treasury policy change and understand this modifies <span className="font-mono">.env.synthesis</span>.
                </span>
              </label>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-gray-400 block mb-1">CHANGE REASON (REQUIRED)</label>
                  <input
                    value={settingsChangeReason}
                    onChange={(e) => setSettingsChangeReason(e.target.value)}
                    className="w-full bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-neonCyan"
                    placeholder="Example: raise daily cap to $10 while testing new data sources"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-gray-400 block mb-1">
                    TYPE CONFIRMATION PHRASE TO SAVE
                  </label>
                  <input
                    value={settingsConfirmationInput}
                    onChange={(e) => setSettingsConfirmationInput(e.target.value)}
                    className="w-full bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-neonCyan"
                    placeholder={settingsConfirmationPhrase}
                  />
                </div>
              </div>

              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                <div className="text-xs text-gray-500">
                  Save is enabled only when the human checkbox is checked, a reason is provided, and the confirmation phrase matches exactly.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!settingsBaseline) return;
                      setSettingsForm(settingsBaseline);
                      setSettingsSaveError(null);
                      setSettingsSaveMessage(null);
                    }}
                    disabled={!settingsDirty || settingsSaving}
                    className="text-xs font-mono px-3 py-2 rounded border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    RESET FORM
                  </button>
                  <button
                    onClick={() => void saveSettings()}
                    disabled={!settingsCanSave}
                    className="inline-flex items-center gap-2 text-xs font-mono px-3 py-2 rounded border border-neonCyan/50 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {settingsSaving ? 'SAVING...' : 'SAVE POLICY SETTINGS'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <TreasurySettingsAuditPanel />

      <div className="border border-panelBorder bg-panelBg rounded-xl p-4 mb-6">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <Filter className="w-3.5 h-3.5" />
            FILTERS
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-neonCyan"
          >
            <option value="all">All statuses</option>
            <option value="pending_approval">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="submitted">Submitted</option>
            <option value="executed">Executed</option>
            <option value="failed">Failed</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 100)}
            className="bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-neonCyan"
          >
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
            <option value={200}>200 rows</option>
          </select>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(searchDraft.trim());
            }}
            placeholder="Search id, address, tx hash, reason..."
            className="flex-1 min-w-[220px] bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-neonCyan"
          />
          <button
            onClick={() => setSearch(searchDraft.trim())}
            className="text-xs font-mono px-3 py-2 rounded border border-gray-700 hover:border-gray-500 text-gray-300 transition-colors"
          >
            APPLY
          </button>
          <button
            onClick={() => {
              setSearchDraft('');
              setSearch('');
              setStatusFilter('all');
            }}
            className="text-xs font-mono px-3 py-2 rounded border border-gray-800 hover:border-gray-600 text-gray-400 transition-colors"
          >
            CLEAR
          </button>
        </div>
      </div>

      {(actionMessage || actionError || error) && (
        <div className="space-y-2 mb-4">
          {actionMessage && (
            <div className="text-xs font-mono border border-green-500/30 bg-green-500/10 text-green-300 rounded p-2">
              {actionMessage}
            </div>
          )}
          {actionError && (
            <div className="text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">
              {actionError}
            </div>
          )}
          {error && (
            <div className="text-xs font-mono border border-red-500/30 bg-red-500/10 text-red-300 rounded p-2">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="border border-panelBorder bg-panelBg rounded-xl p-4 flex-1">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
          <h3 className="font-mono tracking-widest text-gray-400">INTENT HISTORY</h3>
          <span className="text-xs font-mono text-gray-500">
            {loading ? 'Loading...' : `${intents.length} row${intents.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="space-y-3">
          {!loading && intents.length === 0 && (
            <div className="text-sm text-gray-500 font-mono py-10 text-center">
              No treasury intents found for the current filter.
            </div>
          )}

          {intents.map((intent) => {
            const busy = busyIntentId === intent.id;
            const isPending = intent.status === 'pending_approval';
            const txLink = intent.execution?.transactionUrl || null;
            return (
              <div key={intent.id} className="border border-gray-800 rounded-lg p-4 bg-black/20 hover:border-gray-700 transition-colors">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-base font-mono text-white">{formatUsd(intent.amountCents)}</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${statusBadgeClasses(intent.status)}`}>
                        {formatStatus(intent.status)}
                      </span>
                      <span className="text-[10px] font-mono text-gray-500">{relativeTime(intent.createdAt)}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div className="font-mono text-gray-400">
                        ID: <span className="text-gray-200">{intent.id}</span>
                      </div>
                      <div className="font-mono text-gray-400">
                        To:{' '}
                        <span className="text-gray-200" title={intent.toAddress}>
                          {shortAddress(intent.toAddress)}
                        </span>
                      </div>
                      <div className="text-gray-500">
                        Reason: <span className="text-gray-300">{intent.reason || '—'}</span>
                      </div>
                      <div className="text-gray-500">
                        Source/Requester:{' '}
                        <span className="text-gray-300">{intent.source} / {intent.requestedBy}</span>
                      </div>
                    </div>

                    {intent.policy?.reasons && intent.policy.reasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {intent.policy.reasons.map((reason, idx) => (
                          <span
                            key={`${intent.id}-policy-${idx}`}
                            className="text-[10px] font-mono px-2 py-0.5 rounded border border-gray-700 bg-black/20 text-gray-400"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}

                    {(intent.execution || intent.rejection || (intent.approvals?.length ?? 0) > 0) && (
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="border border-gray-800 rounded p-2">
                          <div className="text-[10px] font-mono text-gray-500 mb-1">APPROVALS</div>
                          <div className="text-xs text-gray-300">
                            {(intent.approvals?.length ?? 0) > 0
                              ? `${intent.approvals?.length} by ${intent.approvals?.[intent.approvals.length - 1]?.approvedBy || 'unknown'}`
                              : 'None'}
                          </div>
                        </div>
                        <div className="border border-gray-800 rounded p-2">
                          <div className="text-[10px] font-mono text-gray-500 mb-1">EXECUTION</div>
                          <div className="text-xs text-gray-300">
                            {intent.execution
                              ? `${intent.execution.backend} • ${intent.execution.message || 'no message'}`
                              : 'Not executed'}
                          </div>
                        </div>
                        <div className="border border-gray-800 rounded p-2">
                          <div className="text-[10px] font-mono text-gray-500 mb-1">REJECTION</div>
                          <div className="text-xs text-gray-300">
                            {intent.rejection
                              ? `${intent.rejection.rejectedBy}: ${intent.rejection.reason}`
                              : '—'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="xl:w-[240px] flex xl:flex-col gap-2 xl:items-stretch flex-wrap">
                    {txLink && (
                      <a
                        href={txLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-neonCyan/40 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 transition-colors"
                        title={intent.execution?.transactionRef || ''}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        VIEW TX {shortId(intent.execution?.transactionRef || undefined)}
                      </a>
                    )}

                    {isPending && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => void approveAndExecute(intent.id)}
                          className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-neonCyan/50 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {busy ? 'PROCESSING...' : 'APPROVE + EXECUTE'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void approveOnly(intent.id)}
                          className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          APPROVE ONLY
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void reject(intent.id)}
                          className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          REJECT
                        </button>
                      </>
                    )}

                    {!isPending && intent.status === 'executed' && (
                      <div className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-green-500/30 bg-green-500/10 text-green-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        EXECUTED
                      </div>
                    )}
                    {!isPending && intent.status === 'submitted' && (
                      <div className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-neonCyan/30 bg-neonCyan/10 text-neonCyan">
                        <Send className="w-3.5 h-3.5" />
                        SUBMITTED
                      </div>
                    )}
                    {!isPending && intent.status === 'failed' && (
                      <div className="inline-flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-300">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        FAILED
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  tone,
  monospace = false,
}: {
  title: string;
  value: number | string;
  tone: 'yellow' | 'blue' | 'cyan' | 'green' | 'red' | 'neutral';
  monospace?: boolean;
}) {
  const colorMap: Record<string, string> = {
    yellow: 'text-yellow-300 border-yellow-500/20 bg-yellow-500/5',
    blue: 'text-blue-300 border-blue-500/20 bg-blue-500/5',
    cyan: 'text-neonCyan border-neonCyan/20 bg-neonCyan/5',
    green: 'text-green-300 border-green-500/20 bg-green-500/5',
    red: 'text-red-300 border-red-500/20 bg-red-500/5',
    neutral: 'text-gray-200 border-gray-700 bg-black/20',
  };

  return (
    <div className={`border rounded-lg p-4 ${colorMap[tone]}`}>
      <div className="text-[10px] font-mono tracking-widest opacity-80">{title}</div>
      <div className={`mt-2 text-xl ${monospace ? 'font-mono' : 'font-bold'}`}>{value}</div>
    </div>
  );
}

function FieldCard({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border border-gray-800 rounded p-3 bg-black/20">
      <label className="text-xs font-mono text-gray-400 block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-neonCyan"
        placeholder="0.00"
        inputMode="decimal"
      />
      <div className="text-[10px] text-gray-600 mt-2">{help}</div>
    </div>
  );
}
