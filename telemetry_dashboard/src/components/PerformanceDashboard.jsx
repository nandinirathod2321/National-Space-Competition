import React, { useState } from 'react';
import { Activity, Layout, Layers, Cpu, Database, Play, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useTelemetryStore from '../store/useTelemetryStore';

const PerformanceDashboard = () => {
    const { simulationMetrics, startHighFreqSim } = useTelemetryStore();
    const { performance } = simulationMetrics;
    const [simLoading, setSimLoading] = useState(false);

    const handleStartSim = async () => {
        setSimLoading(true);
        try {
            await startHighFreqSim();
            alert("High-Frequency Telemetry Simulator Started (telemetry_sim.py)");
        } catch (e) {
            console.error(e);
        } finally {
            setSimLoading(false);
        }
    };

    const stats = [
        { label: 'TRACKED BODIES', value: performance?.objects_tracked || 0, icon: Database, color: 'text-accent' },
        { label: 'COMPUTE LATENCY', value: (performance?.compute_time_ms || 0).toFixed(2) + 'ms', icon: Cpu, color: 'text-emerald-400' },
        { label: 'SYSTEM TICK', value: '1.0 Hz', icon: Activity, color: 'text-blue-400' },
        { label: 'ENGINE MODE', value: 'RK4 HYBRID', icon: Layout, color: 'text-amber-400' }
    ];

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-accent tracking-[0.2em] uppercase flex items-center gap-2 font-black italic">
                    <Activity className="w-3 h-3 text-accent" /> System Performance
                </h3>
                <button 
                    onClick={handleStartSim}
                    disabled={simLoading}
                    className="p-1 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-500 hover:text-black transition-all"
                >
                    {simLoading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                    Ignite Simulator
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {stats.map((stat, i) => (
                    <div key={i} className="bg-white/5 border border-white/5 p-4 rounded-xl flex flex-col gap-2">
                        <div className="flex items-center gap-2 opacity-30">
                            <stat.icon className="w-3 h-3 text-white" />
                            <span className="text-[8px] font-black uppercase tracking-widest">{stat.label}</span>
                        </div>
                        <span className={`text-lg font-mono font-bold ${stat.color} tracking-tighter`}>{stat.value}</span>
                    </div>
                ))}
            </div>

            {/* Performance Health Bar */}
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl flex flex-col gap-3">
                <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest opacity-40">
                    <span>CPU Load Efficiency</span>
                    <span className="text-emerald-400">NOMINAL</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                        initial={{ width: 0 }} animate={{ width: '85%' }}
                        className="h-full bg-accent rounded-full" 
                    />
                </div>
            </div>
        </div>
    );
};

export default PerformanceDashboard;
