import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Lock, Shield, Trash2 } from 'lucide-react';
import { clearStoredDashboardApiTokens, getStoredDashboardApiTokens, setStoredDashboardApiTokens } from '../lib/dashboardApiAuth';

export function DashboardApiAuthPanel() {
  const [open, setOpen] = useState(false);
  const [readToken, setReadToken] = useState('');
  const [writeToken, setWriteToken] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const tokens = getStoredDashboardApiTokens();
      setReadToken(tokens.readToken);
      setWriteToken(tokens.writeToken);
    };
    sync();
    window.addEventListener('automaton-dashboard-auth-updated', sync);
    return () => window.removeEventListener('automaton-dashboard-auth-updated', sync);
  }, []);

  const status = useMemo(() => {
    if (writeToken) return 'WRITE TOKEN SET';
    if (readToken) return 'READ TOKEN SET';
    return 'NO TOKENS';
  }, [readToken, writeToken]);

  function save() {
    setStoredDashboardApiTokens({ readToken, writeToken });
    setMessage('Saved to browser local storage. Polling requests will use these tokens.');
    window.setTimeout(() => setMessage(null), 2500);
  }

  function clear() {
    clearStoredDashboardApiTokens();
    setReadToken('');
    setWriteToken('');
    setMessage('Cleared local dashboard API tokens.');
    window.setTimeout(() => setMessage(null), 2500);
  }

  return (
    <div className="fixed right-4 bottom-4 z-[70] w-[min(420px,calc(100vw-2rem))]">
      <div className="border border-panelBorder bg-[#060B14]/95 backdrop-blur rounded-xl shadow-2xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors rounded-xl"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Shield className="w-4 h-4 text-neonCyan shrink-0" />
            <span className="font-mono text-xs tracking-widest text-gray-200">DASHBOARD API AUTH</span>
          </span>
          <span className={`text-[10px] font-mono px-2 py-1 rounded border ${writeToken ? 'border-green-500/30 text-green-300 bg-green-500/10' : readToken ? 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10' : 'border-gray-700 text-gray-400 bg-black/20'}`}>
            {status}
          </span>
        </button>

        {open && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-800">
            <p className="text-xs text-gray-500 mb-3">
              Stores tokens in this browser only. Read token is for GETs. Write token is required for treasury/operator actions and also works for reads.
            </p>

            <label className="block mb-3">
              <span className="text-[11px] font-mono text-gray-400 tracking-widest flex items-center gap-2 mb-1">
                <KeyRound className="w-3.5 h-3.5" /> READ TOKEN (OPTIONAL)
              </span>
              <input
                type="password"
                value={readToken}
                onChange={(e) => setReadToken(e.target.value)}
                placeholder="AUTOMATON_DASHBOARD_API_READ_TOKEN"
                className="w-full rounded border border-gray-700 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-neonCyan"
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-mono text-gray-400 tracking-widest flex items-center gap-2 mb-1">
                <Lock className="w-3.5 h-3.5" /> WRITE TOKEN (TREASURY/ACTIONS)
              </span>
              <input
                type="password"
                value={writeToken}
                onChange={(e) => setWriteToken(e.target.value)}
                placeholder="AUTOMATON_DASHBOARD_API_WRITE_TOKEN"
                className="w-full rounded border border-gray-700 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-neonCyan"
                autoComplete="off"
              />
            </label>

            {message && <div className="mt-3 text-xs font-mono text-green-300 border border-green-500/20 bg-green-500/5 rounded p-2">{message}</div>}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={save}
                className="text-xs font-mono px-3 py-2 rounded border border-neonCyan/40 bg-neonCyan/10 text-neonCyan hover:bg-neonCyan/20 transition-colors"
              >
                SAVE TOKENS
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-xs font-mono px-3 py-2 rounded border border-gray-700 text-gray-300 hover:border-gray-500 transition-colors inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> CLEAR
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
