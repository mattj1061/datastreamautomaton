import { pickDashboardApiToken, type DashboardApiAuthScope } from './dashboardApiAuth';

export interface ApiFetchOptions {
  scope?: DashboardApiAuthScope;
}

function isDashboardApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') {
    return input.startsWith('/api/') || input.includes('/api/');
  }
  if (input instanceof URL) {
    return input.pathname.startsWith('/api/');
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      const url = new URL(input.url, window.location.origin);
      return url.pathname.startsWith('/api/');
    } catch {
      return false;
    }
  }
  return false;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit, options?: ApiFetchOptions): Promise<Response> {
  if (!isDashboardApiRequest(input)) {
    return fetch(input, init);
  }

  const scope = options?.scope ?? 'read';
  const token = pickDashboardApiToken(scope);
  if (!token) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers || {});
  if (!headers.has('Authorization') && !headers.has('X-Automaton-Dashboard-Token')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
