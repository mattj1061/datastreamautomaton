import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopNav } from './components/layout/TopNav';
import { OrgHierarchy } from './components/OrgHierarchy';
import { MissionControl } from './components/MissionControl';
import { TasksView } from './components/TasksView';
import { ChatInterface } from './components/ChatInterface';
import { HomeDashboard } from './components/HomeDashboard';
import { ProjectsView } from './components/ProjectsView';
import { MonitoringView } from './components/MonitoringView';
import { FactoryView } from './components/FactoryView';
import { TreasuryView } from './components/TreasuryView';
import { DashboardApiAuthPanel } from './components/DashboardApiAuthPanel';
import { useAutomatonDashboard } from './hooks/useAutomatonDashboard';

function App() {
    const [activeApp, setActiveApp] = useState('HOME');
    const [activeTab, setActiveTab] = useState('ORG');
    const runtime = useAutomatonDashboard(5000);

    return (
        <div className="min-h-screen bg-darkNavy text-white font-sans flex overflow-hidden">
            <Sidebar activeApp={activeApp} setActiveApp={setActiveApp} />
            <div className="flex-1 flex flex-col ml-16 md:ml-20 w-full h-screen relative">
                {/* Only show TopNav in the Mission Control suite */}
                {activeApp === 'MISSION_CONTROL' && (
                    <TopNav activeTab={activeTab} setActiveTab={setActiveTab} />
                )}

                {/* Main Content Area */}
                <main className={`flex-1 overflow-hidden ${activeApp === 'MISSION_CONTROL' ? 'mt-16 h-[calc(100vh-4rem)]' : 'h-screen'}`}>
                    {/* Mission Control Suite Router */}
                    {activeApp === 'MISSION_CONTROL' && (
                        <div className="h-full overflow-auto p-6">
                            {activeTab === 'MISSION CONTROL' && <MissionControl runtime={runtime} />}
                            {activeTab === 'TASKS' && <TasksView runtime={runtime} />}
                            {activeTab === 'CHAT' && <ChatInterface />}
                            {activeTab === 'ORG' && <OrgHierarchy />}
                        </div>
                    )}

                    {/* Sidebar Apps Router */}
                    {activeApp === 'HOME' && <HomeDashboard onNavigate={setActiveApp} runtime={runtime} />}
                    {activeApp === 'PROJECTS' && <ProjectsView />}
                    {activeApp === 'MONITORING' && <MonitoringView runtime={runtime} />}
                    {activeApp === 'FACTORY' && <FactoryView runtime={runtime} />}
                    {activeApp === 'TREASURY' && <TreasuryView runtime={runtime} />}
                </main>
            </div>
            <DashboardApiAuthPanel />
        </div>
    );
}

export default App;
