import React from 'react';
import { Home, Users, FolderKanban, Activity, Settings, Zap, Wallet } from 'lucide-react';

export function Sidebar({ activeApp, setActiveApp }: { activeApp: string, setActiveApp: (app: string) => void }) {
    return (
        <div className="w-16 md:w-20 fixed left-0 top-0 bottom-0 bg-[#060B14] border-r border-panelBorder flex flex-col items-center py-6 z-50">
            <div className="mb-8 cursor-pointer" onClick={() => setActiveApp('HOME')}>
                <Zap className="w-8 h-8 text-neonCyan" />
            </div>

            <nav className="flex-1 flex flex-col gap-6 w-full items-center mt-4">
                <NavItem icon={<Home className="w-5 h-5" />} tooltip="Home" active={activeApp === 'HOME'} onClick={() => setActiveApp('HOME')} />
                <NavItem icon={<Users className="w-5 h-5" />} tooltip="Mission Control" active={activeApp === 'MISSION_CONTROL'} onClick={() => setActiveApp('MISSION_CONTROL')} />
                <NavItem icon={<FolderKanban className="w-5 h-5" />} tooltip="Projects" active={activeApp === 'PROJECTS'} onClick={() => setActiveApp('PROJECTS')} />
                <NavItem icon={<Activity className="w-5 h-5" />} tooltip="Monitoring" active={activeApp === 'MONITORING'} onClick={() => setActiveApp('MONITORING')} />
                <NavItem icon={<Wallet className="w-5 h-5" />} tooltip="Treasury" active={activeApp === 'TREASURY'} onClick={() => setActiveApp('TREASURY')} />
            </nav>

            <div className="mt-auto">
                <NavItem icon={<Settings className="w-5 h-5" />} tooltip="Settings" />
            </div>
        </div>
    );
}

function NavItem({ icon, active = false, tooltip = "", onClick }: { icon: React.ReactNode, active?: boolean, tooltip?: string, onClick?: () => void }) {
    return (
        <div
            onClick={onClick}
            className={`relative group w-12 h-12 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-200 ${active ? 'bg-neonCyan/10 text-neonCyan' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
        >
            {icon}

            {/* Tooltip */}
            <div className="absolute left-full ml-4 px-2 py-1 bg-gray-800 text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
                {tooltip}
            </div>
        </div>
    );
}
