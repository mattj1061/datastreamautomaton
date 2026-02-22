

interface AgentCardProps {
    name: string;
    role: string;
    department: 'leadership' | 'research' | 'dev' | 'creative' | 'product' | 'council';
    tags: string[];
    model?: string;
    status?: 'online' | 'offline' | 'busy';
    avatarInitials: string;
}

export function AgentCard({
    name,
    role,
    department,
    tags,
    model = "Claude 3.5 Sonnet",
    status = 'online',
    avatarInitials
}: AgentCardProps) {

    const deptColors = {
        leadership: 'border-gray-500 text-gray-300',
        research: 'border-deptResearch text-deptResearch',
        dev: 'border-deptDev text-deptDev',
        creative: 'border-deptCreative text-deptCreative',
        product: 'border-neonCyan text-neonCyan',
        council: 'border-yellow-500 text-yellow-500',
    };

    const bgColors = {
        leadership: 'bg-gray-500/10',
        research: 'bg-deptResearch/10',
        dev: 'bg-deptDev/10',
        creative: 'bg-deptCreative/10',
        product: 'bg-neonCyan/10',
        council: 'bg-yellow-500/10',
    };

    return (
        <div className="w-72 bg-panelBg border border-panelBorder rounded-lg p-4 flex flex-col gap-4 relative overflow-hidden group hover:border-gray-600 transition-colors">
            {/* Top Accent Line */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${bgColors[department].replace('/10', '')} opacity-50`} />

            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border font-mono ${deptColors[department]} ${bgColors[department]}`}>
                        {avatarInitials}
                    </div>

                    <div>
                        <h3 className="font-bold text-gray-100">{name}</h3>
                        <p className="text-xs text-gray-400 font-mono">{role}</p>
                    </div>
                </div>

                {/* Status indicator */}
                <div className="flex items-center justify-center p-1">
                    <div className={`w-2 h-2 rounded-full ${status === 'online' ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-gray-500'}`} />
                </div>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                    <span key={tag} className={`text-[10px] font-mono px-2 py-0.5 rounded border ${deptColors[department]} bg-opacity-10 bg-black`}>
                        {tag}
                    </span>
                ))}
            </div>

            <div className="flex justify-between items-center mt-2 pt-3 border-t border-gray-800">
                <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">{model}</span>
                <button className="text-xs text-gray-400 hover:text-white transition-colors">View Logs</button>
            </div>
        </div>
    );
}
