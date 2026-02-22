import { Activity, Cpu, Database, Globe, Layers, Navigation, Server, Wifi } from 'lucide-react';
import type { AutomatonDashboardRuntime } from '../types/automaton';

interface MonitoringViewProps {
    runtime: AutomatonDashboardRuntime;
}

function formatDuration(seconds: number | undefined): string {
    if (!Number.isFinite(seconds)) return '--';
    const s = Math.max(0, Math.floor(seconds || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
}

export function MonitoringView({ runtime }: MonitoringViewProps) {
    const snapshot = runtime.snapshot;
    const status = snapshot?.status;
    const treasury = snapshot?.treasury;
    const telemetry = snapshot?.telemetry;
    const recentTurns = snapshot?.activity?.recentTurns || [];
    const totalRecentTokens = recentTurns.reduce((acc, turn) => acc + (turn.tokenUsage?.totalTokens || 0), 0);
    const errorTurns = recentTurns.filter((turn) => turn.toolCalls.some((tc) => tc.error)).length;
    const errorRate = recentTurns.length > 0 ? ((errorTurns / recentTurns.length) * 100).toFixed(1) : '0.0';

    return (
        <div className="h-full flex flex-col p-8 pt-12 animate-fade-in overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-light font-mono">System <span className="text-neonCyan">Telemetry</span></h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Live automaton snapshot ({snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString() : 'awaiting API'}) with dashboard design overlay.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${runtime.connected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500 animate-pulse'}`}></span>
                    <span className="text-xs font-mono text-gray-400">
                        {runtime.connected ? 'API CONNECTED' : 'API DISCONNECTED'}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <TelemetryBox title="API LATENCY" value={runtime.fetchLatencyMs != null ? String(runtime.fetchLatencyMs) : '--'} unit="ms" icon={<Wifi className="w-4 h-4 text-neonCyan" />} color="text-neonCyan" />
                <TelemetryBox title="HEARTBEATS" value={status ? `${status.heartbeatEnabled}/${status.heartbeatTotal}` : '--'} unit="" icon={<Cpu className="w-4 h-4 text-deptDev" />} color="text-white" />
                <TelemetryBox title="NODE RSS" value={telemetry?.nodeRssMb != null ? String(telemetry.nodeRssMb) : '--'} unit="MB" icon={<Server className="w-4 h-4 text-deptResearch" />} color="text-white" />
                <TelemetryBox title="ERROR TURNS" value={String(errorRate)} unit="%" icon={<Activity className="w-4 h-4 text-red-400" />} color="text-red-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
                {/* Network Graph */}
                <div className="lg:col-span-2 border border-panelBorder bg-panelBg rounded-xl p-6 flex flex-col relative overflow-hidden min-h-[400px]">
                    {/* Decorative grid background */}
                    <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none"></div>

                    <h3 className="font-mono text-sm tracking-widest text-gray-400 mb-6 relative z-10 flex items-center justify-between">
                        NETWORK TOPOLOGY
                        <span className="text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">ALL SYSTEMS GO</span>
                    </h3>

                    <div className="flex-1 flex items-center justify-center relative z-10">
                        {/* Connecting Lines (SVG) */}
                        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                            {/* Ingress to Orchestrator */}
                            <path d="M 15% 50% L 35% 50%" stroke="rgba(0, 242, 255, 0.3)" strokeWidth="2" strokeDasharray="4 4" fill="none" className="animate-[dash_20s_linear_infinite]" />

                            {/* Orchestrator to Services (Top) */}
                            <path d="M 35% 50% Q 50% 50% 50% 25% L 70% 25%" stroke="rgba(147, 51, 234, 0.3)" strokeWidth="2" fill="none" />

                            {/* Orchestrator to Services (Middle) */}
                            <path d="M 35% 50% L 70% 50%" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="2" fill="none" />

                            {/* Orchestrator to Services (Bottom) */}
                            <path d="M 35% 50% Q 50% 50% 50% 75% L 70% 75%" stroke="rgba(236, 72, 153, 0.3)" strokeWidth="2" fill="none" />

                            {/* Services to Vector DB */}
                            <path d="M 70% 25% Q 85% 25% 85% 50%" stroke="rgba(107, 114, 128, 0.3)" strokeWidth="2" fill="none" />
                            <path d="M 70% 50% L 85% 50%" stroke="rgba(107, 114, 128, 0.3)" strokeWidth="2" fill="none" />
                            <path d="M 70% 75% Q 85% 75% 85% 50%" stroke="rgba(107, 114, 128, 0.3)" strokeWidth="2" fill="none" />
                        </svg>

                        {/* Nodes Layout */}
                        <div className="absolute inset-0 flex items-center justify-between px-10" style={{ zIndex: 10 }}>

                            {/* Left: Edge / API Gateway */}
                            <div className="flex flex-col items-center">
                                <TopologyNode
                                    icon={<Globe className="w-5 h-5 text-neonCyan" />}
                                    name="API Gateway"
                                    status="healthy"
                                    color="border-neonCyan"
                                    shadow="shadow-[0_0_15px_rgba(0,242,255,0.3)]"
                                />
                                <NodeMetrics load="42%" latency="12ms" />
                            </div>

                            {/* Center-Left: Main Orchestrator */}
                            <div className="flex flex-col items-center ml-12">
                                <TopologyNode
                                    icon={<Navigation className="w-6 h-6 text-white" />}
                                    name="LLM Orchestrator"
                                    status="healthy"
                                    color="border-white"
                                    shadow="shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                                    size="lg"
                                />
                                <NodeMetrics load="78%" latency="45ms" />
                            </div>

                            {/* Center-Right: Services Column */}
                            <div className="flex flex-col gap-12 ml-16">
                                <div className="flex items-center gap-4">
                                    <TopologyNode
                                        icon={<Server className="w-4 h-4 text-deptResearch" />}
                                        name="Research Worker"
                                        status="healthy"
                                        color="border-deptResearch"
                                    />
                                </div>
                                <div className="flex items-center gap-4 -ml-8">
                                    <TopologyNode
                                        icon={<Server className="w-4 h-4 text-deptDev" />}
                                        name="Build Worker"
                                        status="healthy"
                                        color="border-deptDev"
                                    />
                                </div>
                                <div className="flex items-center gap-4">
                                    <TopologyNode
                                        icon={<Server className="w-4 h-4 text-deptCreative" />}
                                        name="Render Worker   "
                                        status="warning"
                                        color="border-deptCreative"
                                    />
                                </div>
                            </div>

                            {/* Right: Storage / DB */}
                            <div className="flex flex-col items-center mr-8">
                                <TopologyNode
                                    icon={<Database className="w-5 h-5 text-gray-400" />}
                                    name="Vector DB"
                                    status="healthy"
                                    color="border-gray-500"
                                />
                                <div className="mt-4 flex flex-col items-center gap-2">
                                    <TopologyNode
                                        icon={<Layers className="w-4 h-4 text-gray-500" />}
                                        name="Redis Cache"
                                        status="healthy"
                                        color="border-gray-600"
                                        size="sm"
                                    />
                                </div>
                            </div>

                        </div>
                    </div>
                </div>

                {/* Model Metrics */}
                <div className="lg:col-span-1 border border-panelBorder bg-panelBg rounded-xl p-6 flex flex-col min-h-[400px]">
                    <h3 className="font-mono text-sm tracking-widest text-gray-400 mb-6 pb-2 border-b border-gray-800">MODEL INFERENCE LOG</h3>
                    <div className="space-y-4">
                        <ModelMetric model="Claude 3.5 Sonnet" calls="12.4K" latency="180ms" status="healthy" color="bg-deptResearch" />
                        <ModelMetric model="GPT-4o" calls="8.2K" latency="240ms" status="healthy" color="bg-gray-400" />
                        <ModelMetric model="Midjourney API" calls="1.1K" latency="4.2s" status="warning" color="bg-deptCreative" />
                        <ModelMetric model="Gemini Pro" calls="4.5K" latency="150ms" status="healthy" color="bg-neonCyan" />
                        <ModelMetric model="Custom Whisper" calls="842" latency="800ms" status="healthy" color="bg-purple-500" />
                    </div>

                    <div className="mt-8 border-t border-gray-800 pt-6">
                        <div className="flex justify-between text-xs font-mono text-gray-500 mb-2">
                            <span>TOTAL TOKEN USAGE (24H)</span>
                            <span className="text-neonCyan">{totalRecentTokens > 0 ? totalRecentTokens.toLocaleString() : '—'}</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-deptResearch via-neonCyan to-deptCreative"
                                style={{ width: `${Math.min(100, Math.max(8, Math.round((treasury?.pendingApprovalCount ?? 0) * 12 + (runtime.connected ? 35 : 10))))}%` }}
                            ></div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] font-mono text-gray-500">
                            <div className="border border-gray-800 rounded p-2">
                                TREASURY PENDING
                                <div className="text-gray-200 text-xs mt-1">{treasury?.pendingApprovalCount ?? 0}</div>
                            </div>
                            <div className="border border-gray-800 rounded p-2">
                                API UPTIME
                                <div className="text-gray-200 text-xs mt-1">{formatDuration(telemetry?.serverUptimeSeconds)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TelemetryBox({ title, value, unit, icon, color }: any) {
    return (
        <div className="border border-panelBorder bg-black/40 rounded-lg p-5 group hover:border-gray-600 transition-colors">
            <div className="flex items-center justify-between mb-3 text-gray-400">
                <span className="text-xs font-mono tracking-widest group-hover:text-gray-300 transition-colors">{title}</span>
                {icon}
            </div>
            <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-mono font-bold ${color}`}>{value}</span>
                <span className="text-sm font-mono text-gray-500">{unit}</span>
            </div>
        </div>
    );
}

function TopologyNode({ icon, name, status, color, shadow = '', size = 'md' }: any) {
    const sizeClasses = {
        sm: 'w-10 h-10',
        md: 'w-12 h-12',
        lg: 'w-16 h-16'
    };

    return (
        <div className="flex flex-col items-center gap-2 group cursor-pointer">
            <div className={`relative ${sizeClasses[size as keyof typeof sizeClasses]} bg-[#060B14] border-2 ${color} rounded-xl flex items-center justify-center ${shadow} group-hover:scale-110 transition-transform`}>
                {icon}
                {status === 'warning' && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-500 rounded-full border-2 border-[#060B14] animate-pulse"></div>
                )}
            </div>
            <span className="text-[10px] font-mono text-gray-400 bg-black/50 px-2 py-0.5 rounded border border-gray-800 mt-1 whitespace-nowrap">{name}</span>
        </div>
    );
}

function NodeMetrics({ load, latency }: { load: string, latency: string }) {
    return (
        <div className="mt-2 flex gap-3 text-[9px] font-mono p-1.5 bg-black/40 rounded border border-gray-800">
            <div className="flex flex-col items-center">
                <span className="text-gray-600">LOAD</span>
                <span className="text-gray-300">{load}</span>
            </div>
            <div className="w-px bg-gray-800"></div>
            <div className="flex flex-col items-center">
                <span className="text-gray-600">LAT</span>
                <span className="text-gray-300">{latency}</span>
            </div>
        </div>
    );
}

function ModelMetric({ model, calls, latency, status, color }: any) {
    return (
        <div className="flex items-center justify-between p-3 border border-gray-800 rounded bg-[#060B14] hover:bg-white/[0.02] transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${color}`}></div>
                <span className="text-sm text-gray-200 font-mono">{model}</span>
                {status === 'warning' && <Activity className="w-3 h-3 text-yellow-500 ml-1" />}
            </div>
            <div className="flex gap-4 text-xs font-mono">
                <div className="text-gray-400 w-16 text-right"><span className="text-gray-600 mr-1 text-[10px]">REQ</span>{calls}</div>
                <div className={`w-16 text-right ${status === 'warning' ? 'text-yellow-400' : 'text-gray-400'}`}>
                    <span className="text-gray-600 mr-1 text-[10px]">LAT</span>{latency}
                </div>
            </div>
        </div>
    );
}
