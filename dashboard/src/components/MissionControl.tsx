import { Activity, AlertTriangle, CheckCircle2, Cpu, Database, Network, X } from 'lucide-react';
import { useState } from 'react';

type AlertType = 'error' | 'warning' | 'info';

interface Alert {
    id: number;
    type: AlertType;
    message: string;
    time: string;
    agent: string;
}

export function MissionControl() {
    const [alerts, setAlerts] = useState<Alert[]>([
        { id: 1, type: 'warning', message: 'Rate limit approaching on Midjourney API', time: '2m ago', agent: 'Pixel' },
        { id: 2, type: 'info', message: 'Daily brief report generated successfully', time: '1h ago', agent: 'JARVIS' },
        { id: 3, type: 'error', message: 'Failed to fetch recent competitor data', time: '3h ago', agent: 'Atlas' },
        { id: 4, type: 'info', message: 'New video asset rendered', time: '4h ago', agent: 'Nova' },
    ]);

    const handleDismiss = (id: number) => {
        setAlerts(prev => prev.filter(alert => alert.id !== id));
    };

    return (
        <div className="h-full flex flex-col gap-6 animate-fade-in pb-10">
            <h2 className="text-2xl font-light font-mono">Mission <span className="text-neonCyan">Control</span></h2>

            {/* Top Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <MetricCard title="SYSTEM STATUS" value="NOMINAL" icon={<CheckCircle2 className="text-green-500 w-5 h-5" />} color="text-green-500" />
                <MetricCard title="ACTIVE AGENTS" value="14/14" icon={<Network className="text-neonCyan w-5 h-5" />} color="text-neonCyan" />
                <MetricCard title="COMPUTE LOAD" value="42%" icon={<Cpu className="text-deptDev w-5 h-5" />} color="text-white" />
                <MetricCard title="API REQUESTS" value="12.4k/h" icon={<Database className="text-deptResearch w-5 h-5" />} color="text-white" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[500px]">
                {/* Left Column: Alerts & Logs */}
                <div className="lg:col-span-1 border border-panelBorder bg-panelBg rounded-lg p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-800">
                        <h3 className="font-mono text-sm tracking-widest text-gray-400">PRIORITY ALERTS</h3>
                        {alerts.length > 0 && (
                            <span className="bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5 rounded font-mono">{alerts.length} NEW</span>
                        )}
                        {alerts.length === 0 && (
                            <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded font-mono">CLEAR</span>
                        )}
                    </div>

                    <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                        {alerts.map(alert => (
                            <AlertItem key={alert.id} {...alert} onDismiss={() => handleDismiss(alert.id)} />
                        ))}
                        {alerts.length === 0 && (
                            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-mono mt-8">
                                No active alerts.
                            </div>
                        )}
                    </div>
                </div>

                {/* Center/Right Column: Daily Brief */}
                <div className="lg:col-span-2 border border-panelBorder bg-panelBg rounded-lg p-6 relative overflow-hidden group">
                    {/* Decorative grid background */}
                    <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none"></div>

                    <div className="relative z-10 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gray-500/10 border border-gray-500 flex items-center justify-center font-bold text-xs font-mono text-gray-300">
                                    JA
                                </div>
                                <div>
                                    <h3 className="font-mono text-sm tracking-widest text-neonCyan">DAILY BRIEF REPORT</h3>
                                    <p className="text-xs text-gray-500">Compiled by JARVIS • 08:00 AM</p>
                                </div>
                            </div>
                            <button className="text-xs font-mono border border-panelBorder px-3 py-1.5 rounded hover:bg-white/5 transition-colors">
                                DOWNLOAD PDF
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-6 text-sm text-gray-300 pr-4 custom-scrollbar">
                            <section>
                                <h4 className="text-deptResearch font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-deptResearch"></div> RESEARCH INSIGHTS</h4>
                                <p className="pl-3.5 border-l border-gray-800 text-gray-400 leading-relaxed">
                                    Atlas identified 3 emerging trends in the AI orchestration space. Competitor X launched a new update. Trendy found 12 viral hooks performing well in our niche this week.
                                </p>
                            </section>

                            <section>
                                <h4 className="text-deptCreative font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-deptCreative"></div> CREATIVE OUTPUT</h4>
                                <p className="pl-3.5 border-l border-gray-800 text-gray-400 leading-relaxed">
                                    Pixel delivered 5 concept arts for the new campaign. Nova is 80% done rendering the B-roll sequence. Vibe reviewed the latest fashion aesthetics and suggests adjusting the color palette to warmer tones.
                                </p>
                            </section>

                            <section>
                                <h4 className="text-deptDev font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-deptDev"></div> ENGINEERING STATUS</h4>
                                <p className="pl-3.5 border-l border-gray-800 text-gray-400 leading-relaxed">
                                    Clawd pushed 3 commits to the core orchestrator repo resolving the memory leak. Sentinel ran the overnight E2E suite; 100% pass rate.
                                </p>
                            </section>

                            <section>
                                <h4 className="text-yellow-500 font-mono mb-2 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500"></div> COUNCIL DIRECTIVE</h4>
                                <div className="pl-3.5 border-l border-gray-800 p-3 bg-yellow-500/5 rounded border border-yellow-500/10 mt-2">
                                    <p className="text-gray-300 italic">"Focus today should be on optimizing the onboarding funnel. Acquisition metrics are stable, but drop-off at step 2 requires attention." - The Council</p>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function MetricCard({ title, value, icon, color }: { title: string, value: string, icon: React.ReactNode, color: string }) {
    return (
        <div className="border border-panelBorder bg-panelBg rounded-lg p-4 flex items-center justify-between group hover:border-gray-600 transition-colors">
            <div>
                <h4 className="text-xs text-gray-500 font-mono mb-1 tracking-wider">{title}</h4>
                <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            </div>
            <div className="p-2 bg-black/20 rounded-lg border border-white/5">
                {icon}
            </div>
        </div>
    );
}

function AlertItem({ type, message, time, agent, onDismiss }: { type: AlertType, message: string, time: string, agent: string, onDismiss: () => void }) {
    const colors = {
        error: 'text-red-400 border-red-500/20 bg-red-500/5',
        warning: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/5',
        info: 'text-neonCyan border-neonCyan/20 bg-neonCyan/5'
    };

    const icons = {
        error: <AlertTriangle className="w-4 h-4" />,
        warning: <AlertTriangle className="w-4 h-4" />,
        info: <Activity className="w-4 h-4" />
    };

    return (
        <div className={`p-3 rounded border text-sm flex gap-3 group relative overflow-hidden pr-8 transition-colors ${colors[type]}`}>
            <div className="mt-0.5">{icons[type]}</div>
            <div className="flex-1">
                <p className="mb-1 text-gray-200">{message}</p>
                <div className="flex justify-between items-center text-[10px] font-mono text-gray-500 uppercase">
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
