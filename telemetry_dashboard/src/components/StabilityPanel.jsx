import React from 'react';
import { Activity, Gauge, Zap, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

const StabilityPanel = ({ metrics }) => {
    const { energy, energy_error, dt, stability } = metrics;
    
    const getStabilityColor = () => {
        if (stability === 'stable') return '#10B981'; // Green
        if (stability === 'warning') return '#F59E0B'; // Amber
        return '#EF4444'; // Red
    };

    const color = getStabilityColor();

    return (
        <div className="bg-black/40 backdrop-blur-md border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-3">
                    <Activity className="w-4 h-4 text-white/40" />
                    <span className="text-[10px] font-black tracking-[0.2em] uppercase text-white/60">Numerical Stability</span>
                </div>
                <div className="flex items-center gap-2 px-2 py-1 rounded bg-white/5 border border-white/10">
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color }}>{stability}</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-white/30">
                        <Gauge className="w-3 h-3" />
                        <span className="text-[9px] uppercase tracking-widest font-bold">Rel Error</span>
                    </div>
                    <div className="text-lg font-mono tracking-tighter text-white/90">
                        {energy_error.toExponential(3)}
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-white/30">
                        <Zap className="w-3 h-3" />
                        <span className="text-[9px] uppercase tracking-widest font-bold">Prop Δt</span>
                    </div>
                    <div className="text-lg font-mono tracking-tighter text-accent">
                        {dt.toFixed(2)}s
                    </div>
                </div>
            </div>

            {stability !== 'stable' && (
                <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3"
                >
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-red-200 leading-relaxed uppercase tracking-tight">
                        High energy drift detected. Adaptive timestep engaged to maintain orbital integrity.
                    </p>
                </motion.div>
            )}
        </div>
    );
};

export default StabilityPanel;
