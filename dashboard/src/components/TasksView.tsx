import { CheckCircle2, CircleDashed, Loader2, Plus, X } from 'lucide-react';
import { useState, useEffect } from 'react';

type TaskStatus = 'running' | 'queued' | 'completed';

interface Task {
    id: number;
    agent: string;
    dept: string;
    task: string;
    progress: number;
    status: TaskStatus;
    time?: string;
}

export function TasksView() {
    const [activeTasks, setActiveTasks] = useState<Task[]>([
        { id: 1, agent: 'Atlas', dept: 'research', task: 'Deep researching competitive analysis for Q3', progress: 78, status: 'running' },
        { id: 2, agent: 'Pixel', dept: 'creative', task: 'Generating UI wireframes based on spec #402', progress: 45, status: 'running' },
        { id: 3, agent: 'Clawd', dept: 'dev', task: 'Refactoring authentication middleware', progress: 92, status: 'running' },
        { id: 4, agent: 'Sentinel', dept: 'dev', task: 'E2E Testing staging deployment', progress: 15, status: 'running' },
        { id: 5, agent: 'Clip', dept: 'product', task: 'Extracting highlights from Townhall video', progress: 0, status: 'queued' },
    ]);

    const [completedTasks, setCompletedTasks] = useState<Task[]>([
        { id: 6, agent: 'JARVIS', dept: 'leadership', task: 'Orchestrated daily morning brief', progress: 100, status: 'completed', time: '08:00 AM' },
        { id: 7, agent: 'Trendy', dept: 'research', task: 'Scraped top 50 trending GitHub repos', progress: 100, status: 'completed', time: '06:30 AM' },
        { id: 8, agent: 'Vibe', dept: 'creative', task: 'Analyzed competitor color palettes', progress: 100, status: 'completed', time: '05:15 AM' },
    ]);

    const [isAddingTask, setIsAddingTask] = useState(false);
    const [newTaskName, setNewTaskName] = useState('');
    const [newTaskAgent, setNewTaskAgent] = useState('Atlas');

    // Simulate task progress
    useEffect(() => {
        const interval = setInterval(() => {
            setActiveTasks(prev => {
                const newActive = [...prev];
                let hasCompleted = false;

                for (let i = 0; i < newActive.length; i++) {
                    if (newActive[i].status === 'running') {
                        // Random progress increment
                        newActive[i].progress += Math.floor(Math.random() * 5) + 1;
                        if (newActive[i].progress >= 100) {
                            newActive[i].progress = 100;
                            newActive[i].status = 'completed';
                            newActive[i].time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            hasCompleted = true;
                        }
                    } else if (newActive[i].status === 'queued') {
                        // Small chance to start a queued task
                        if (Math.random() > 0.8) {
                            newActive[i].status = 'running';
                        }
                    }
                }

                if (hasCompleted) {
                    const finishedTasks = newActive.filter(t => t.status === 'completed');
                    setCompletedTasks(c => [...finishedTasks, ...c]);
                    return newActive.filter(t => t.status !== 'completed');
                }

                return newActive;
            });
        }, 3000);

        return () => clearInterval(interval);
    }, []);

    const agentDepts: Record<string, string> = {
        'JARVIS': 'leadership',
        'Atlas': 'research',
        'Trendy': 'research',
        'Pixel': 'creative',
        'Vibe': 'creative',
        'Clawd': 'dev',
        'Sentinel': 'dev',
        'Clip': 'product'
    };

    const handleAddTask = () => {
        if (!newTaskName.trim()) return;

        const newTask: Task = {
            id: Date.now(),
            agent: newTaskAgent,
            dept: agentDepts[newTaskAgent] || 'dev',
            task: newTaskName,
            progress: 0,
            status: 'queued'
        };

        setActiveTasks(prev => [...prev, newTask]);
        setNewTaskName('');
        setIsAddingTask(false);
    };

    const runningCount = activeTasks.filter(t => t.status === 'running').length;

    return (
        <div className="h-full flex flex-col gap-6 animate-fade-in pb-10">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-light font-mono">Active <span className="text-neonCyan">Tasks</span></h2>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-panelBg border border-panelBorder px-3 py-1.5 rounded-full">
                        <div className={`w-2 h-2 rounded-full ${runningCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                        <span className="text-xs font-mono text-gray-400">{runningCount} AGENTS WORKING</span>
                    </div>
                    <button
                        onClick={() => setIsAddingTask(true)}
                        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-gray-700 px-4 py-1.5 rounded-full text-sm transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        QUEUE TASK
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[500px]">
                {/* Active Tasks Panel */}
                <div className="border border-panelBorder bg-panelBg rounded-lg p-5 flex flex-col">
                    <h3 className="font-mono text-sm tracking-widest text-gray-400 mb-4 pb-2 border-b border-gray-800">IN PROGRESS</h3>

                    <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">

                        {isAddingTask && (
                            <div className="p-4 rounded border border-neonCyan/50 bg-black/40 mb-2 animate-fade-in">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs font-mono text-neonCyan">NEW TASK OVERRIDE</span>
                                    <button onClick={() => setIsAddingTask(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                                </div>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Prompt or instruction..."
                                    value={newTaskName}
                                    onChange={(e) => setNewTaskName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
                                    className="w-full bg-black/50 border border-gray-700 rounded px-3 py-2 text-sm text-white mb-3 focus:outline-none focus:border-neonCyan"
                                />
                                <div className="flex justify-between items-center">
                                    <select
                                        value={newTaskAgent}
                                        onChange={(e) => setNewTaskAgent(e.target.value)}
                                        className="bg-black/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-400 focus:outline-none"
                                    >
                                        {Object.keys(agentDepts).map(agent => (
                                            <option key={agent} value={agent}>{agent}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleAddTask}
                                        className="bg-neonCyan/20 text-neonCyan hover:bg-neonCyan/30 border border-neonCyan/50 px-3 py-1 rounded text-xs font-bold transition-colors"
                                    >
                                        SUBMIT
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTasks.map(task => (
                            <TaskCard key={task.id} {...task} />
                        ))}

                        {activeTasks.length === 0 && !isAddingTask && (
                            <div className="flex-1 flex items-center justify-center text-gray-500 font-mono text-sm">
                                NO ACTIVE TASKS IN QUEUE
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-6 h-full">
                    {/* Terminal / Live Log Stream */}
                    <div className="flex-1 border border-panelBorder bg-[#060B14] rounded-lg p-4 flex flex-col font-mono relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-deptDev to-transparent opacity-50"></div>

                        <div className="flex items-center justify-between mb-3 border-b border-gray-800 pb-2">
                            <h3 className="text-xs tracking-widest text-gray-500 flex items-center gap-2">
                                <Loader2 className="w-3 h-3 animate-spin text-neonCyan" />
                                LIVE TELEMETRY
                            </h3>
                        </div>

                        <div className="flex-1 overflow-y-auto text-xs text-gray-400 space-y-2 custom-scrollbar">
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:02]</span><span className="text-deptDev">[CLAWD]</span><span className="text-gray-300">npm install completed with 0 vulnerabilities.</span></div>
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:05]</span><span className="text-deptDev">[CLAWD]</span><span className="text-gray-300">Writing updated auth controller logic...</span></div>
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:08]</span><span className="text-deptResearch">[ATLAS]</span><span className="text-gray-300">HTTP GET https://api.competitor.com/v1/metrics -&gt; 200 OK</span></div>
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:12]</span><span className="text-deptResearch">[ATLAS]</span><span className="text-gray-300">Parsing response JSON (452kb)...</span></div>
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:15]</span><span className="text-deptCreative">[PIXEL]</span><span className="text-gray-300">Prompt constructed: "cyberpunk dashboard UI, deep navy background..."</span></div>
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:16]</span><span className="text-deptCreative">[PIXEL]</span><span className="text-gray-300">Awaiting Midjourney API response...</span></div>
                            <div className="flex gap-3"><span className="text-gray-600">[10:45:20]</span><span className="text-deptResearch">[ATLAS]</span><span className="text-gray-300">Summarizing key findings using Claude 3.5 Sonnet...</span></div>
                            <div className="mt-4 flex gap-2 w-full pt-2">
                                <span className="w-2 h-4 bg-neonCyan animate-pulse"></span>
                            </div>
                        </div>
                    </div>

                    {/* Recently Completed */}
                    <div className="h-1/3 border border-panelBorder bg-panelBg rounded-lg p-5 flex flex-col">
                        <h3 className="font-mono text-sm tracking-widest text-gray-400 mb-3 pb-2 border-b border-gray-800">COMPLETED</h3>
                        <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar">
                            {completedTasks.map(task => (
                                <div key={task.id} className="flex items-center gap-3 text-sm p-2 hover:bg-white/5 rounded transition-colors group">
                                    <CheckCircle2 className="w-4 h-4 text-gray-500 group-hover:text-green-500 transition-colors" />
                                    <span className="font-mono text-xs text-gray-400 w-16">{task.agent}</span>
                                    <span className="text-gray-300 flex-1 truncate">{task.task}</span>
                                    <span className="text-xs font-mono text-gray-600">{task.time}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TaskCard({ agent, dept, task, progress, status }: any) {
    const deptColors: Record<string, string> = {
        leadership: 'text-gray-300 bg-gray-500/10 border-gray-500',
        research: 'text-deptResearch bg-deptResearch/10 border-deptResearch',
        dev: 'text-deptDev bg-deptDev/10 border-deptDev',
        creative: 'text-deptCreative bg-deptCreative/10 border-deptCreative',
        product: 'text-neonCyan bg-neonCyan/10 border-neonCyan',
    };

    const progressColors: Record<string, string> = {
        leadership: 'bg-gray-400',
        research: 'bg-deptResearch',
        dev: 'bg-deptDev',
        creative: 'bg-deptCreative',
        product: 'bg-neonCyan',
    };

    return (
        <div className="p-4 rounded border border-gray-800 bg-black/20 hover:border-gray-600 transition-colors">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-[#060B14] flex items-center justify-center border border-gray-800">
                        {status === 'running' ? <Loader2 className={`w-4 h-4 animate-spin ${progressColors[dept]?.replace('bg-', 'text-') || 'text-gray-400'}`} /> : <CircleDashed className="w-4 h-4 text-gray-500" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${deptColors[dept] || 'border-gray-500 text-gray-400 bg-gray-800/50'}`}>{agent}</span>
                            <span className="text-xs font-mono text-gray-500">[{status}]</span>
                        </div>
                    </div>
                </div>
                <div className="text-xl font-mono font-light text-gray-300">{progress}%</div>
            </div>

            <p className="text-sm text-gray-200 mb-3 ml-11">{task}</p>

            <div className="ml-11 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div
                    className={`h-full ${progressColors[dept] || 'bg-gray-500'} transition-all duration-1000 ease-out`}
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}
