import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import type { FactoryDashboardResponse, FactoryDashboardRuntime, FactorySnapshot } from '../types/automaton';

const FACTORY_API_PATH = '/api/factory';

export function useFactorySnapshot(pollMs = 15_000): FactoryDashboardRuntime {
  const [snapshot, setSnapshot] = useState<FactorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchLatencyMs, setFetchLatencyMs] = useState<number | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const started = performance.now();

    try {
      const response = await apiFetch(FACTORY_API_PATH, { cache: 'no-store' }, { scope: 'read' });
      const data = (await response.json()) as FactoryDashboardResponse;
      setFetchLatencyMs(Math.round(performance.now() - started));

      if (!response.ok || data?.ok === false) {
        setError(data?.error || `Factory API error (${response.status})`);
        if (data?.factory) setSnapshot(data.factory);
        return;
      }

      setSnapshot(data.factory || null);
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
      connected: Boolean(snapshot && !error),
      error,
      fetchLatencyMs,
      refresh,
    }),
    [snapshot, loading, error, fetchLatencyMs, refresh],
  );
}
