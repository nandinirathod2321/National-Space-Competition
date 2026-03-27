import React from 'react';
import useTelemetryStore from '../store/useTelemetryStore';
import { motion } from 'framer-motion';
import { Database, LucideSatellite } from 'lucide-react';

const SatelliteList = () => {
    const { satellites, selectedSatId, setSelectedSatId } = useTelemetryStore();
    const satIds = Object.keys(satellites);

    return (
        <aside className="h-full bg-[#111116] border border-[#ffffff10] rounded-xl flex flex-col p-4 overflow-hidden">
            <h2 className="text-[11px] text-gray-400 tracking-[0.2em] font-bold uppercase mb-4 flex items-center gap-2">
                <Database className="w-3 h-3 text-accent" /> Active Fleet
            </h2>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {satIds.length === 0 ? (
                    <div className="text-center py-20 text-gray-700 text-xs italic tracking-widest">
                        Listening for Inbound...
                    </div>
                ) : (
                    satIds.map(id => (
                        <motion.button
                            key={id}
                            onClick={() => setSelectedSatId(id)}
                            className={`w-full text-left p-3 rounded-lg border transition-all ${selectedSatId === id ? 'bg-accent/10 border-accent/40 shadow-[0_0_20px_#00D4FF15]' : 'bg-white/[0.02] border-white/5 hover:border-white/10'}`}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            <div className="flex items-center justify-between">
                                <span className={`text-xs font-bold tracking-tight ${selectedSatId === id ? 'text-accent' : 'text-gray-100'}`}>
                                    {id}
                                </span>
                                <LucideSatellite className={`w-3 h-3 ${selectedSatId === id ? 'text-accent' : 'text-gray-600'}`} />
                            </div>
                            <div className="mt-2 text-[9px] text-gray-500 font-mono tracking-tighter">
                                {Math.round((satellites[id].fuel / 50) * 100)}% Propellant
                            </div>
                        </motion.button>
                    ))
                )}
            </div>
        </aside>
    );
};

export default SatelliteList;
