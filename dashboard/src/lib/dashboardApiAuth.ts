export type DashboardApiAuthScope = "read" | "write";

export interface DashboardApiStoredTokens {
  readToken: string;
  writeToken: string;
}

export const DASHBOARD_API_READ_TOKEN_STORAGE_KEY = 'automaton.dashboardApi.readToken';
export const DASHBOARD_API_WRITE_TOKEN_STORAGE_KEY = 'automaton.dashboardApi.writeToken';

function safeGetStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getStoredDashboardApiTokens(): DashboardApiStoredTokens {
  const storage = safeGetStorage();
  if (!storage) {
    return { readToken: '', writeToken: '' };
  }
  return {
    readToken: normalize(storage.getItem(DASHBOARD_API_READ_TOKEN_STORAGE_KEY)),
    writeToken: normalize(storage.getItem(DASHBOARD_API_WRITE_TOKEN_STORAGE_KEY)),
  };
}

export function setStoredDashboardApiTokens(tokens: Partial<DashboardApiStoredTokens>): DashboardApiStoredTokens {
  const storage = safeGetStorage();
  const next = { ...getStoredDashboardApiTokens(), ...tokens };
  if (storage) {
    storage.setItem(DASHBOARD_API_READ_TOKEN_STORAGE_KEY, normalize(next.readToken));
    storage.setItem(DASHBOARD_API_WRITE_TOKEN_STORAGE_KEY, normalize(next.writeToken));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('automaton-dashboard-auth-updated'));
  }
  return getStoredDashboardApiTokens();
}

export function clearStoredDashboardApiTokens(): DashboardApiStoredTokens {
  const storage = safeGetStorage();
  if (storage) {
    storage.removeItem(DASHBOARD_API_READ_TOKEN_STORAGE_KEY);
    storage.removeItem(DASHBOARD_API_WRITE_TOKEN_STORAGE_KEY);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('automaton-dashboard-auth-updated'));
  }
  return { readToken: '', writeToken: '' };
}

export function pickDashboardApiToken(scope: DashboardApiAuthScope): string {
  const { readToken, writeToken } = getStoredDashboardApiTokens();
  if (scope === 'write') return writeToken || '';
  return readToken || writeToken || '';
}
