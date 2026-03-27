import React, { useEffect, useState } from 'react';
import { GanttChart, Rocket, CheckCircle2, AlertTriangle, Calendar, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useTelemetryStore from '../store/useTelemetryStore';

const ManeuverHistory = () => {
    const { maneuverGantt, fetchManeuverGantt } = useTelemetryStore();
    const [activeTab, setActiveTab] = useState('history'); // history, scheduled

    useEffect(() => {
        const interval = setInterval(fetchManeuverGantt, 5000);
        fetchManeuverGantt();
        return () => clearInterval(interval);
    }, [fetchManeuverGantt]);

    const events = activeTab === 'history' ? maneuverGantt.events : maneuverGantt.scheduled;

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 flex flex-col gap-5 h-full relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 blur-[80px] -z-10 group-hover:bg-accent/10 transition-colors" />
            
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-accent tracking-[0.2em] uppercase flex items-center gap-2 font-black italic">
                    <GanttChart className="w-3 h-3 text-accent" /> Maneuver Logs & Gantt (v2)
                </h3>
            </div>

            <div className="flex gap-4 p-1 bg-white/5 border border-white/5 rounded-lg w-fit">
                {['history', 'scheduled'].map(tab => (
                    <button 
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-accent text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'text-white/40 hover:bg-white/5 hover:text-white/60'}`}
                    >
                        {tab === 'history' ? 'Past Operations' : 'Future Schedule'}
                    </button>
                ))}
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                <AnimatePresence mode="wait">
                    {events?.length === 0 ? (
                        <motion.div 
                            key="empty"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="bg-white/5 border border-white/5 border-dashed p-10 rounded-xl flex flex-col items-center justify-center gap-4 text-center opacity-30"
                        >
                            <Calendar className="w-8 h-8" />
                            <span className="text-[9px] font-black uppercase tracking-widest leading-relaxed">No maneuvers logged for {activeTab === 'history' ? 'the current mission cycle' : 'the upcoming epoch'}</span>
                        </motion.div>
                    ) : (
                        events.map((event, idx) => (
                            <motion.div 
                                key={idx}
                                initial={{ x: -10, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between"
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activeTab === 'history' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                        <Rocket className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black text-white/80 uppercase tracking-widest">{event.satellite_id || event.id}</span>
                                        <span className="text-[8px] font-mono text-white/30 uppercase">{event.event_type || 'BURN_EXECUTED'} • {new Date(event.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-[9px] font-mono font-bold text-accent">{(event.dv_ms || 0).toFixed(2)} m/s Δv</span>
                                    <div className="flex items-center gap-2 text-[8px] text-white/40 uppercase">
                                        <Clock className="w-2.5 h-2.5" /> {event.duration_seconds || 0}s Burn
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>
            
            <div className="mt-auto px-1 flex items-center justify-between text-[8px] text-white/20 font-black tracking-widest uppercase">
                <span>SIM_EPOCH: {maneuverGantt.sim_time}</span>
                <span className="text-emerald-500/50">Stability: Nominal</span>
            </div>
        </div>
    );
};

export default ManeuverHistory;
