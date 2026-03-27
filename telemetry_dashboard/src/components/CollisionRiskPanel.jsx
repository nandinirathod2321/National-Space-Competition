import React from 'react';
import { ShieldAlert, Zap, Target, Gauge } from 'lucide-react';
import { motion } from 'framer-motion';

const CollisionRiskPanel = ({ risk }) => {
    if (!risk || risk.probability === undefined) return null;

    const prob = risk.probability * 100;
    const isCritical = risk.risk_level === 'critical';
    const isWarning = risk.risk_level === 'warning';

    const color = isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981';

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 overflow-hidden relative">
            {/* Background Glow */}
            <div 
                className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 rounded-full"
                style={{ backgroundColor: color }}
            />

            <h3 className="text-[11px] text-accent tracking-widest uppercase mb-6 flex items-center gap-2 font-black italic">
                <ShieldAlert className="w-3 h-3" style={{ color }} /> Conjunction Risk Assessment
            </h3>

            <div className="grid grid-cols-2 gap-4">
                {/* Probability Gauge */}
                <div className="col-span-2 flex flex-col items-center justify-center p-4 bg-black/40 border border-white/5 rounded-2xl">
                    <span className="text-[9px] text-gray-600 uppercase tracking-widest font-black mb-2">Collision Probability</span>
                    <div className="relative flex items-center justify-center">
                        <svg className="w-24 h-24 transform -rotate-90">
                            <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                            <motion.circle 
                                cx="48" cy="48" r="40" 
                                stroke={color} strokeWidth="8" fill="transparent"
                                strokeDasharray={251.2}
                                initial={{ strokeDashoffset: 251.2 }}
                                animate={{ strokeDashoffset: 251.2 - (251.2 * (prob / 100)) }}
                                transition={{ duration: 1, ease: "easeOut" }}
                            />
                        </svg>
                        <span className="absolute text-xl font-mono text-white tabular-nums">{prob.toFixed(2)}%</span>
                    </div>
                </div>

                {/* Details */}
                <div className="bg-black/30 border border-white/5 p-3 rounded-xl flex flex-col">
                    <span className="text-[8px] text-gray-700 font-black uppercase mb-1">Time to TCA</span>
                    <span className="text-xs font-mono text-white">{(risk.tca_s / 60).toFixed(1)} MIN</span>
                </div>

                <div className="bg-black/30 border border-white/5 p-3 rounded-xl flex flex-col">
                    <span className="text-[8px] text-gray-700 font-black uppercase mb-1">Min Separation</span>
                    <span className="text-xs font-mono text-white">{risk.d_min_km.toFixed(3)} KM</span>
                </div>

                <div className="col-span-2 bg-black/30 border border-white/5 p-3 rounded-xl flex justify-between items-center">
                    <div className="flex flex-col">
                        <span className="text-[8px] text-gray-700 font-black uppercase mb-1">Primary Threat</span>
                        <span className="text-[10px] font-mono text-accent">{risk.object_id}</span>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${isCritical ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                        {risk.risk_level}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CollisionRiskPanel;
