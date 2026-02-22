import { Mic, Paperclip, Send, Search } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function ChatInterface() {
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const contacts = [
        { name: 'JARVIS', role: 'Chief Strategy Officer', dept: 'leadership', unread: 0, online: true, initials: 'JA' },
        { name: 'Atlas', role: 'Senior Research Analyst', dept: 'research', unread: 2, online: true, initials: 'AT' },
        { name: 'Pixel', role: 'Lead Designer', dept: 'creative', unread: 0, online: true, initials: 'PI' },
        { name: 'Clawd', role: 'Senior Developer', dept: 'dev', unread: 5, online: true, initials: 'CL' },
        { name: 'The Council', role: 'Executive Panel', dept: 'council', unread: 0, online: true, initials: 'CN' },
    ];

    const [messages, setMessages] = useState([
        { sender: 'AI', name: 'Atlas', time: '10:42 AM', text: 'I have completed the deep dive into the 3 new competitor features. Shall I run the data through Claude for a summarized brief?' },
        { sender: 'USER', name: 'Vadim', time: '10:45 AM', text: 'Yes, please summarize and then pass the insights over to Pixel to see if any UI adjustments are needed.' },
        { sender: 'AI', name: 'Atlas', time: '10:46 AM', text: 'Understood. Processing now. I will notify Pixel when complete.' },
    ]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    const handleSend = () => {
        if (!inputText.trim()) return;

        const newMsg = {
            sender: 'USER',
            name: 'Vadim',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            text: inputText
        };

        setMessages(prev => [...prev, newMsg]);
        setInputText('');
        setIsTyping(true);

        // Mock AI auto-reply
        setTimeout(() => {
            const aiResponses = [
                "I've logged that request. Continuing execution.",
                "Analyzing the provided parameters now...",
                "Task added to my queue. I will alert you upon completion.",
                "Understood. Cross-referencing with our existing knowledge base.",
                "Are there any specific edge cases you'd like me to consider for this?"
            ];
            const randomReply = aiResponses[Math.floor(Math.random() * aiResponses.length)];

            setMessages(prev => [...prev, {
                sender: 'AI',
                name: 'Atlas',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                text: randomReply
            }]);
            setIsTyping(false);
        }, 1500);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="h-full flex gap-6 animate-fade-in pb-10">

            {/* Contacts Sidebar */}
            <div className="w-80 flex flex-col h-full border border-panelBorder bg-panelBg rounded-lg overflow-hidden shrink-0">
                <div className="p-4 border-b border-gray-800 bg-[#060B14]">
                    <h2 className="text-sm font-mono tracking-widest text-gray-400 mb-4">AGENT <span className="text-neonCyan">COMMS</span></h2>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            placeholder="Search agents..."
                            className="w-full bg-black/40 border border-gray-700 rounded pl-9 pr-4 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-neonCyan transition-colors"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {contacts.map((contact, i) => (
                        <ContactItem key={i} {...contact} active={i === 1} />
                    ))}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 border border-panelBorder bg-panelBg rounded-lg flex flex-col overflow-hidden relative">
                {/* Chat Header */}
                <div className="h-16 border-b border-gray-800 bg-[#060B14] flex items-center justify-between px-6 shrink-0 relative">
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-deptResearch to-transparent opacity-50"></div>

                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border font-mono border-deptResearch text-deptResearch bg-deptResearch/10 relative">
                            AT
                            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[#060B14]"></div>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-100 flex items-center gap-2">Atlas <span className="text-[10px] bg-black/50 border border-gray-700 px-1.5 py-0.5 rounded text-gray-400 font-mono font-normal">Claude 3.5 Sonnet</span></h3>
                            <p className="text-xs text-deptResearch font-mono">Senior Research Analyst</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button className="px-3 py-1.5 border border-gray-700 rounded text-xs font-mono text-gray-400 hover:text-white hover:border-gray-500 transition-colors">VIEW LOGS</button>
                        <button className="px-3 py-1.5 border border-gray-700 rounded text-xs font-mono text-gray-400 hover:text-white hover:border-gray-500 transition-colors">MANAGE TOOLS</button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
                    <div className="text-center">
                        <span className="text-xs font-mono text-gray-600 border border-gray-800 px-3 py-1 rounded bg-black/20">TODAY</span>
                    </div>

                    {messages.map((msg, i) => (
                        <MessageBubble key={i} {...msg} />
                    ))}

                    {isTyping && (
                        <div className="self-start flex items-center gap-2 mb-1 px-1">
                            <div className="bg-black/30 border border-gray-800 text-gray-400 rounded-xl rounded-tl-none p-3 text-sm flex gap-1">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-[#060B14] border-t border-gray-800 shrink-0">
                    <div className="flex items-end gap-3 bg-panelBg border border-gray-700 rounded-lg p-2 focus-within:border-deptResearch transition-colors">
                        <button className="p-2 text-gray-500 hover:text-white transition-colors">
                            <Paperclip className="w-5 h-5" />
                        </button>
                        <textarea
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Atlas..."
                            className="flex-1 bg-transparent border-none outline-none text-white resize-none max-h-32 min-h-[44px] py-3 text-sm font-sans custom-scrollbar"
                            rows={1}
                        />
                        <button className="p-2 text-gray-500 hover:text-white transition-colors">
                            <Mic className="w-5 h-5" />
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={!inputText.trim()}
                            className="p-2 text-deptResearch hover:text-white transition-colors bg-deptResearch/10 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="mt-2 text-center">
                        <span className="text-[10px] text-gray-600 font-mono tracking-widest">PRESS ENTER TO SEND • SHIFT+ENTER FOR NEW LINE</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ContactItem({ name, role, dept, unread, active, initials }: any) {
    const deptColors: Record<string, string> = {
        leadership: 'border-gray-500 text-gray-300 bg-gray-500/10',
        research: 'border-deptResearch text-deptResearch bg-deptResearch/10',
        dev: 'border-deptDev text-deptDev bg-deptDev/10',
        creative: 'border-deptCreative text-deptCreative bg-deptCreative/10',
        council: 'border-yellow-500 text-yellow-500 bg-yellow-500/10',
    };

    return (
        <div className={`p-4 border-b border-gray-800 flex items-center justify-between cursor-pointer transition-colors relative ${active ? 'bg-white/5' : 'hover:bg-white/[0.02]'}`}>
            {active && <div className={`absolute left-0 top-0 bottom-0 w-1 ${deptColors[dept].split(' ')[0].replace('border-', 'bg-')}`}></div>}

            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border font-mono ${deptColors[dept]} relative`}>
                    {initials}
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-panelBg"></div>
                </div>
                <div>
                    <h4 className={`font-bold text-sm ${active ? 'text-white' : 'text-gray-300'}`}>{name}</h4>
                    <p className="text-[10px] text-gray-500 font-mono truncate w-40">{role}</p>
                </div>
            </div>

            {unread > 0 && (
                <div className="w-5 h-5 rounded-full bg-neonCyan text-black flex items-center justify-center font-bold text-[10px]">
                    {unread}
                </div>
            )}
        </div>
    );
}

function MessageBubble({ sender, name, time, text }: any) {
    const isUser = sender === 'USER';

    return (
        <div className={`flex flex-col max-w-[80%] ${isUser ? 'self-end items-end' : 'self-start items-start'}`}>
            <div className="flex items-center gap-2 mb-1 px-1">
                <span className={`text-xs font-bold ${isUser ? 'text-blue-400' : 'text-deptResearch'}`}>{name}</span>
                <span className="text-[10px] text-gray-600 font-mono">{time}</span>
            </div>
            <div className={`p-4 rounded-xl text-sm leading-relaxed shadow-sm ${isUser
                ? 'bg-blue-600/20 border border-blue-500/30 text-white rounded-tr-none'
                : 'bg-black/30 border border-gray-800 text-gray-200 rounded-tl-none'
                }`}>
                {text}
            </div>
        </div>
    );
}
