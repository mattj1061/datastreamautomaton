

export function TopNav({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) {
    const tabs = ['MISSION CONTROL', 'TASKS', 'CHAT', 'ORG'];

    return (
        <div className="h-16 border-b border-panelBorder bg-[#0B1121]/80 backdrop-blur fixed top-0 left-16 md:left-20 right-0 z-40 flex items-center justify-between px-6">
            <div className="flex gap-1 h-full pt-4">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 font-mono text-xs font-semibold tracking-wider transition-colors relative ${activeTab === tab
                            ? 'text-neonCyan'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        {tab}
                        {activeTab === tab && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-neonCyan w-full shadow-[0_0_8px_rgba(0,242,255,0.8)]" />
                        )}
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                    <span className="text-xs font-mono font-bold tracking-widest text-gray-300">LIVE</span>
                </div>
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 border border-gray-600 flex items-center justify-center text-xs font-bold shadow-lg">
                    VS
                </div>
            </div>
        </div>
    );
}
