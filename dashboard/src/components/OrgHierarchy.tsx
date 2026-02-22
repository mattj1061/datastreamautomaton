import { useState } from 'react';
import { AgentCard } from './AgentCard';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function OrgHierarchy() {
    const [isCouncilOpen, setIsCouncilOpen] = useState(false);

    return (
        <div className="min-w-max h-full pb-10 flex items-start gap-16 relative pr-8">
            <div className="flex flex-col items-center gap-12 pt-8 flex-1 pl-8 w-full mr-80">

                {/* LEADERSHIP */}
                <div className="flex flex-col items-center gap-8 relative">
                    <AgentCard
                        name="Vadim Strizheus"
                        role="CEO"
                        department="leadership"
                        tags={['VISION', 'MANAGEMENT']}
                        model="Human"
                        avatarInitials="VS"
                    />

                    {/* Connector */}
                    <div className="h-8 w-px bg-panelBorder"></div>

                    <AgentCard
                        name="JARVIS"
                        role="Chief Strategy Officer"
                        department="leadership"
                        tags={['STRATEGIC PLANNING', 'TASK ORCHESTRATION']}
                        model="GPT-4o"
                        avatarInitials="JA"
                    />
                </div>

                {/* Main Connector from Leadership to Departments */}
                <div className="flex flex-col items-center">
                    <div className="h-8 w-px bg-panelBorder"></div>
                    <div className="w-[1000px] h-px bg-panelBorder"></div>

                    <div className="flex justify-between w-[1000px] mt-8 gap-6">

                        {/* RESEARCH */}
                        <div className="flex flex-col items-center gap-8 relative">
                            <div className="absolute -top-8 w-px h-8 bg-panelBorder"></div>
                            <h4 className="text-gray-500 font-mono tracking-widest text-sm mb-4">RESEARCH</h4>
                            <AgentCard
                                name="Atlas"
                                role="Senior Research Analyst"
                                department="research"
                                tags={['DEEP RESEARCH', 'WEB SEARCH']}
                                model="Claude 3.5 Sonnet"
                                avatarInitials="AT"
                            />
                            <AgentCard
                                name="Trendy"
                                role="Viral Scout"
                                department="research"
                                tags={['CONTENT DISCOVERY']}
                                model="Gemini Pro"
                                avatarInitials="TR"
                            />
                        </div>

                        {/* CREATIVE */}
                        <div className="flex flex-col items-center gap-8 relative">
                            <div className="absolute -top-8 w-px h-8 bg-panelBorder"></div>
                            <h4 className="text-gray-500 font-mono tracking-widest text-sm mb-4">CREATIVE</h4>
                            <AgentCard
                                name="Pixel"
                                role="Lead Designer"
                                department="creative"
                                tags={['DESIGN', 'IMAGE GEN']}
                                model="Midjourney"
                                avatarInitials="PI"
                            />
                            <AgentCard
                                name="Nova"
                                role="Video Production"
                                department="creative"
                                tags={['MOTION GRAPHICS']}
                                model="Sora / Runway"
                                avatarInitials="NO"
                            />
                            <AgentCard
                                name="Vibe"
                                role="Senior Fashion Editor"
                                department="creative"
                                tags={['FASHION ANALYSIS']}
                                model="Claude 3.5 Sonnet"
                                avatarInitials="VI"
                            />
                        </div>

                        {/* DEV */}
                        <div className="flex flex-col items-center gap-8 relative">
                            <div className="absolute -top-8 w-px h-8 bg-panelBorder"></div>
                            <h4 className="text-gray-500 font-mono tracking-widest text-sm mb-4">DEV</h4>
                            <AgentCard
                                name="Clawd"
                                role="Senior Developer"
                                department="dev"
                                tags={['FULL-STACK', 'CODE REVIEW']}
                                model="Claude 3.5 Sonnet"
                                avatarInitials="CL"
                            />
                            <AgentCard
                                name="Sentinel"
                                role="QA Monitor"
                                department="dev"
                                tags={['SYSTEM MONITORING', 'TESTING']}
                                model="GPT-4o Mini"
                                avatarInitials="SE"
                            />
                        </div>

                        {/* PRODUCT */}
                        <div className="flex flex-col items-center gap-8 relative">
                            <div className="absolute -top-8 w-px h-8 bg-panelBorder"></div>
                            <h4 className="text-gray-500 font-mono tracking-widest text-sm mb-4">PRODUCT</h4>
                            <AgentCard
                                name="Clip"
                                role="Clipping Agent"
                                department="product"
                                tags={['HIGHLIGHTS', 'CAPTIONS']}
                                model="Custom pipeline"
                                avatarInitials="CP"
                            />
                        </div>

                    </div>
                </div>
            </div>

            {/* THE COUNCIL - Top Right Expandable Dropdown */}
            <div className={`fixed top-24 right-8 w-80 bg-panelBg/80 backdrop-blur border border-yellow-500/30 rounded-lg p-6 flex flex-col gap-6 transition-all duration-300 z-50 overflow-hidden ${isCouncilOpen ? 'max-h-[800px] shadow-[0_0_30px_rgba(234,179,8,0.15)] shadow-yellow-500/10' : 'max-h-[72px] cursor-pointer hover:bg-panelBg/90'}`}
                onClick={() => !isCouncilOpen && setIsCouncilOpen(true)}>
                <div className="flex items-center justify-between mb-2 border-b-2 border-transparent pb-0">
                    <div className="flex items-center gap-3">
                        <h3 className="text-yellow-500 font-mono font-bold tracking-widest text-sm">THE COUNCIL</h3>
                        <span className="text-xs text-gray-500 font-mono">22:00 REPORT</span>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsCouncilOpen(!isCouncilOpen); }}
                        className="text-gray-400 hover:text-white transition-colors p-1"
                    >
                        {isCouncilOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                </div>

                <div className={`flex flex-col gap-6 transition-opacity duration-300 ${isCouncilOpen ? 'opacity-100' : 'opacity-0'}`}>
                    <AgentCard
                        name="The Growth"
                        role="User Acquisition"
                        department="council"
                        tags={['METRICS', 'FUNNELS']}
                        avatarInitials="GR"
                    />
                    <AgentCard
                        name="The Retention"
                        role="Churn Prevention"
                        department="council"
                        tags={['EMAILS', 'ENGAGEMENT']}
                        avatarInitials="RT"
                    />
                    <AgentCard
                        name="The Skeptic"
                        role="Risk Assessment"
                        department="council"
                        tags={['CRITICAL REVIEW']}
                        avatarInitials="SK"
                    />
                </div>
            </div>

        </div>
    );
}
