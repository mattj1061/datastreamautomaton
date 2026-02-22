import { Plus, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { useState } from 'react';

type ProjectStatus = 'BACKLOG' | 'IN PROGRESS' | 'REVIEW' | 'COMPLETED';

interface Project {
    id: string;
    title: string;
    dept: string;
    agents: string[];
    due: string;
    status: ProjectStatus;
}

export function ProjectsView() {
    const columns: { title: ProjectStatus; color: string }[] = [
        { title: 'BACKLOG', color: 'border-gray-600' },
        { title: 'IN PROGRESS', color: 'border-neonCyan' },
        { title: 'REVIEW', color: 'border-yellow-500' },
        { title: 'COMPLETED', color: 'border-green-500' },
    ];

    const [projects, setProjects] = useState<Project[]>([
        { id: 'PRJ-102', title: 'Q3 Marketing Campaign Assets', dept: 'creative', agents: ['PI', 'NO'], due: '2 Days', status: 'IN PROGRESS' },
        { id: 'PRJ-105', title: 'Competitive Gap Analysis', dept: 'research', agents: ['AT', 'TR'], due: 'Today', status: 'IN PROGRESS' },
        { id: 'PRJ-110', title: 'Auth Auth0 Migration', dept: 'dev', agents: ['CL', 'SE'], due: '1 Week', status: 'IN PROGRESS' },
        { id: 'PRJ-115', title: 'User Funnel Optimization', dept: 'council', agents: ['GR', 'JA'], due: '3 Days', status: 'IN PROGRESS' },
        { id: 'PRJ-118', title: 'System Architecture Review', dept: 'leadership', agents: ['VS', 'JA'], due: '2 Weeks', status: 'BACKLOG' },
        { id: 'PRJ-120', title: 'New Onboarding Flow', dept: 'product', agents: ['CP'], due: 'Next Month', status: 'BACKLOG' },
        { id: 'PRJ-099', title: 'Landing Page Redesign', dept: 'creative', agents: ['PI'], due: 'Past Due', status: 'REVIEW' },
    ]);

    const [isAdding, setIsAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDept, setNewDept] = useState('dev');

    const handleMove = (id: string, direction: 'forward' | 'backward') => {
        setProjects(prev => prev.map(p => {
            if (p.id !== id) return p;

            const currentIndex = columns.findIndex(c => c.title === p.status);
            const nextIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1;

            if (nextIndex >= 0 && nextIndex < columns.length) {
                return { ...p, status: columns[nextIndex].title };
            }
            return p;
        }));
    };

    const handleAdd = () => {
        if (!newTitle.trim()) return;

        const newProject: Project = {
            id: `PRJ-${Math.floor(Math.random() * 900) + 100}`,
            title: newTitle,
            dept: newDept,
            agents: ['?'],
            due: 'TBD',
            status: 'BACKLOG'
        };

        setProjects(prev => [newProject, ...prev]);
        setNewTitle('');
        setIsAdding(false);
    };

    return (
        <div className="h-full flex flex-col pt-8 px-8 overflow-hidden">
            <div className="flex items-center justify-between mb-8 shrink-0">
                <div>
                    <h2 className="text-2xl font-light font-mono">Active <span className="text-neonCyan">Projects</span></h2>
                    <p className="text-sm text-gray-500 mt-1">Kanban board for cross-departmental initiatives.</p>
                </div>
                <button
                    onClick={() => setIsAdding(true)}
                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-gray-700 px-4 py-2 rounded text-sm transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    NEW INITIATIVE
                </button>
            </div>

            {/* Kanban Grid */}
            <div className="flex gap-6 flex-1 overflow-x-auto pb-8 custom-scrollbar">
                {columns.map((col, i) => {
                    const colProjects = projects.filter(p => p.status === col.title);

                    return (
                        <div key={i} className="min-w-[320px] w-[320px] flex flex-col gap-4">
                            {/* Column Header */}
                            <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color}`}>
                                <h3 className="font-mono text-sm tracking-widest text-gray-300">{col.title}</h3>
                                <span className="text-xs font-mono text-gray-500 bg-black/30 px-2 py-0.5 rounded">{colProjects.length}</span>
                            </div>

                            {/* Cards Area */}
                            <div className="flex flex-col gap-4 flex-1 overflow-y-auto custom-scrollbar pr-2">

                                {/* Inline Add Form in Backlog */}
                                {col.title === 'BACKLOG' && isAdding && (
                                    <div className="bg-panelBg/80 border-2 border-dashed border-neonCyan/50 rounded-lg p-4 animate-fade-in">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-mono text-neonCyan">NEW INITIATIVE</span>
                                            <button onClick={() => setIsAdding(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                                        </div>
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Project Title..."
                                            value={newTitle}
                                            onChange={(e) => setNewTitle(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                                            className="w-full bg-black/50 border border-gray-700 rounded px-3 py-2 text-sm text-white mb-3 focus:outline-none focus:border-neonCyan"
                                        />
                                        <div className="flex justify-between items-center">
                                            <select
                                                value={newDept}
                                                onChange={(e) => setNewDept(e.target.value)}
                                                className="bg-black/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-400 focus:outline-none"
                                            >
                                                <option value="dev">Dev</option>
                                                <option value="creative">Creative</option>
                                                <option value="research">Research</option>
                                                <option value="leadership">Leadership</option>
                                                <option value="council">Council</option>
                                            </select>
                                            <button
                                                onClick={handleAdd}
                                                className="bg-neonCyan/20 text-neonCyan hover:bg-neonCyan/30 border border-neonCyan/50 px-3 py-1 rounded text-xs font-bold transition-colors"
                                            >
                                                ADD
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {colProjects.map((project) => (
                                    <ProjectCard
                                        key={project.id}
                                        {...project}
                                        onMove={(dir: 'forward' | 'backward') => handleMove(project.id, dir)}
                                        canMoveBackward={col.title !== 'BACKLOG'}
                                        canMoveForward={col.title !== 'COMPLETED'}
                                    />
                                ))}

                                {col.title === 'BACKLOG' && !isAdding && (
                                    <button
                                        onClick={() => setIsAdding(true)}
                                        className="border border-dashed border-gray-700 rounded-lg h-12 flex items-center justify-center text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5 transition-all text-sm font-mono"
                                    >
                                        + Add Task
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ProjectCard({ id, title, dept, agents, due, onMove, canMoveBackward, canMoveForward }: any) {
    const deptColors: Record<string, string> = {
        leadership: 'border-gray-500 text-gray-300 bg-gray-500/10',
        research: 'border-deptResearch text-deptResearch bg-deptResearch/10',
        dev: 'border-deptDev text-deptDev bg-deptDev/10',
        creative: 'border-deptCreative text-deptCreative bg-deptCreative/10',
        product: 'border-purple-500 text-purple-400 bg-purple-500/10',
        council: 'border-yellow-500 text-yellow-500 bg-yellow-500/10',
    };

    return (
        <div className="bg-panelBg border border-gray-800 rounded-lg p-4 group hover:border-gray-600 transition-colors">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono text-gray-500">{id}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => canMoveBackward && onMove('backward')}
                        disabled={!canMoveBackward}
                        className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
                        title="Move column left"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => canMoveForward && onMove('forward')}
                        disabled={!canMoveForward}
                        className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
                        title="Move column right"
                    >
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <h4 className="font-bold text-gray-200 mb-4">{title}</h4>

            <div className="flex items-center justify-between mt-auto">
                <div className="flex -space-x-2">
                    {agents.map((agent: string, i: number) => (
                        <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] border font-mono ${deptColors[dept] || deptColors['dev']} relative ring-2 ring-panelBg`}>
                            {agent}
                        </div>
                    ))}
                </div>
                <span className="text-[10px] font-mono uppercase bg-black/40 border border-gray-800 px-2 py-1 rounded text-gray-400">
                    Due: {due}
                </span>
            </div>
        </div>
    );
}
