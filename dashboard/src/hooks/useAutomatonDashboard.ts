import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AutomatonDashboardRuntime, AutomatonDashboardSnapshot } from '../types/automaton';

const DASHBOARD_API_PATH = '/api/dashboard';

export function useAutomatonDashboard(pollMs = 5000): AutomatonDashboardRuntime {
  const [snapshot, setSnapshot] = useState<AutomatonDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchLatencyMs, setFetchLatencyMs] = useState<number | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const started = performance.now();

    try {
      const response = await fetch(DASHBOARD_API_PATH, { cache: 'no-store' });
      const data = (await response.json()) as AutomatonDashboardSnapshot;
      setFetchLatencyMs(Math.round(performance.now() - started));

      if (!response.ok || data?.ok === false) {
        setError(data?.error || `Dashboard API error (${response.status})`);
        if (data) {
          setSnapshot(data);
        }
        return;
      }

      setSnapshot(data);
      setError(null);
    } catch (err) {
      setFetchLatencyMs(Math.round(performance.now() - started));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, refresh]);

  return useMemo(
    () => ({
      snapshot,
      loading,
      connected: Boolean(snapshot?.ok && !error),
      error,
      fetchLatencyMs,
      refresh,
    }),
    [snapshot, loading, error, fetchLatencyMs, refresh],
  );
}
