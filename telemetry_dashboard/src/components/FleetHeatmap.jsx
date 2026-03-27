import React, { useEffect } from 'react';
import { LayoutGrid, Thermometer, Battery, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import useTelemetryStore from '../store/useTelemetryStore';

const FleetHeatmap = () => {
    const { fleetHeatmap, fetchFleetHeatmap } = useTelemetryStore();

    useEffect(() => {
        const interval = setInterval(fetchFleetHeatmap, 5000);
        fetchFleetHeatmap();
        return () => clearInterval(interval);
    }, [fetchFleetHeatmap]);

    const getHealthColor = (health) => {
        switch (health) {
            case 'critical': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
            case 'warning': return 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]';
            default: return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]';
        }
    };

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 flex flex-col gap-5 h-full">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-accent tracking-[0.2em] uppercase flex items-center gap-2 font-black italic">
                    <LayoutGrid Medicine className="w-3 h-3 text-accent" /> Fleet Health Heatmap
                </h3>
                <span className="text-[8px] font-mono text-white/30 uppercase">Live Resource Audit</span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                {fleetHeatmap.map((sat) => (
                    <motion.div 
                        key={sat.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="group relative"
                    >
                        <div className={`aspect-square rounded-md ${getHealthColor(sat.health)} flex items-center justify-center transition-all duration-300 group-hover:scale-110 cursor-help`}>
                            <span className="text-[8px] font-black text-black/80">{sat.id.slice(-2)}</span>
                        </div>
                        
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 bg-black border border-white/10 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl backdrop-blur-md">
                            <p className="text-[9px] font-black text-white mb-1">{sat.id}</p>
                            <div className="flex items-center gap-2 text-[8px] text-white/60">
                                <Battery className="w-2 h-2" /> {sat.fuel_pct.toFixed(1)}% Propellant
                            </div>
                            <div className="flex items-center gap-2 text-[8px] text-white/60 mt-0.5">
                                <MapPin className="w-2 h-2" /> {sat.altitude_km.toFixed(0)}km Alt
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            <div className="flex items-center gap-4 mt-auto pt-4 border-t border-white/5">
                {[
                    { label: 'Nominal', color: 'bg-emerald-500' },
                    { label: 'Warning', color: 'bg-amber-500' },
                    { label: 'Critical', color: 'bg-red-500' }
                ].map(legend => (
                    <div key={legend.label} className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${legend.color}`} />
                        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">{legend.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default FleetHeatmap;
