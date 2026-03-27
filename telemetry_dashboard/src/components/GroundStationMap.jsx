import React from 'react';
import { Radio, MapPin, Globe, Signal, SignalLow } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const GroundStationMap = ({ satelliteId, visibleStations }) => {
    if (!satelliteId) return null;

    const hasVisibility = visibleStations && visibleStations.length > 0;
    
    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 overflow-hidden flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-emerald-400 tracking-widest uppercase flex items-center gap-2 font-black italic">
                    <Radio className="w-3 h-3 text-emerald-500" /> Uplink Visibility Check
                </h3>
                <div className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${hasVisibility ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                    {hasVisibility ? 'VISIBLE' : 'NO LOS'}
                </div>
            </div>

            {/* Station List */}
            <div className="flex-1 space-y-3 max-h-[220px] overflow-y-auto custom-scrollbar pr-2">
                <AnimatePresence mode="popLayout">
                    {hasVisibility ? (
                        visibleStations.map((gs, i) => (
                            <motion.div 
                                key={gs.id}
                                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                className={`p-3 rounded-xl border ${i === 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/5 border-white/5'} flex items-center justify-between`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${i === 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white/20'}`}>
                                        <MapPin className="w-4 h-4" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black text-white/80 uppercase tracking-widest">{gs.name}</span>
                                        <span className="text-[8px] font-mono text-white/30 uppercase tracking-tighter">EL: {gs.elevation_deg}° — DIST: {gs.distance_km} KM</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[8px] text-white/20 font-black uppercase mb-1 tracking-widest">Signal</span>
                                    <div className="flex gap-0.5">
                                        {[1, 2, 3, 4, 5].map(bar => (
                                            <div 
                                                key={bar} 
                                                className={`w-1 h-3 rounded-full ${bar <= Math.round(gs.signal_strength / 20) ? 'bg-emerald-500' : 'bg-white/5'}`} 
                                            />
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center py-10 opacity-30 text-center gap-3">
                            <SignalLow className="w-8 h-8 animate-pulse text-red-500" />
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] leading-relaxed">
                                Awaiting Next Window...<br/>LOS Re-entry predicted in 14.5m
                            </span>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* Best Station Summary */}
            {hasVisibility && (
                <div className="bg-black/30 border border-white/5 p-3 rounded-xl flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[8px] text-white/20 font-black uppercase mb-1">Active Uplink</span>
                        <span className="text-[10px] font-mono text-emerald-400">{visibleStations[0].id}</span>
                    </div>
                     <Globe className="w-4 h-4 text-white/10 animate-spin-slow" />
                </div>
            )}
        </div>
    );
};

export default GroundStationMap;
