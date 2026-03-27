import React from 'react';
import useTelemetryStore from '../store/useTelemetryStore';
import { motion } from 'framer-motion';
import { Database, LucideSatellite } from 'lucide-react';
 
const SatelliteCard = React.memo(({ id, sat, isSelected, onSelect }) => {
    return (
        <button
            key={id}
            onClick={() => onSelect(id)}
            className={`w-full text-left p-4 rounded-xl border transition-all duration-300 ${isSelected ? 'bg-accent/15 border-accent/40 shadow-[0_0_20px_rgba(30,144,255,0.15)]' : 'bg-white/[0.03] border-white/5 hover:border-accent/30 hover:bg-white/[0.05]'}`}
        >
            <div className="flex items-center justify-between">
                <span className={`text-[11px] font-black tracking-tight uppercase ${isSelected ? 'text-accent' : 'text-white/60'}`}>
                    {id}
                </span>
                <LucideSatellite className={`w-3.5 h-3.5 ${isSelected ? 'text-accent' : 'text-white/20'}`} />
            </div>
            <div className="mt-3 flex items-center justify-between">
                <div className="text-[9px] text-white/30 font-mono tracking-tighter uppercase font-bold">
                    Propellant
                </div>
                <div className={`text-[10px] font-mono font-bold ${sat.fuel < 10 ? 'text-red-500' : 'text-accent/80'}`}>
                    {Math.round((sat.fuel / 50) * 100)}%
                </div>
            </div>
            <div className="mt-1.5 w-full h-1 bg-white/5 rounded-full overflow-hidden">
                <div 
                    className={`h-full transition-all duration-300 ${sat.fuel < 10 ? 'bg-red-500' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, (sat.fuel / 50) * 100)}%` }}
                />
            </div>
        </button>
    );
});

const SatelliteList = () => {
    const { satellites, selectedSatId, setSelectedSatId } = useTelemetryStore();
    const satIds = Object.keys(satellites);

    return (
        <aside className="flex-1 bg-[#0a0a0f] border border-white/5 rounded-xl flex flex-col p-5 overflow-hidden diagram-card min-h-0">
            <h2 className="text-[11px] text-white/40 tracking-[0.2em] font-black uppercase mb-5 flex items-center justify-between gap-2 border-b border-white/5 pb-3">
                <span className="flex items-center gap-2">
                    <Database className="w-3 h-3 text-accent" /> Active Fleet
                </span>
                <span className="text-[8px] bg-accent/5 px-1.5 py-0.5 rounded border border-accent/20 text-accent font-black tracking-tight">{satIds.length} UNITS</span>
            </h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                {satIds.length === 0 ? (
                    <div className="text-center py-20 text-white/10 text-[10px] italic tracking-[0.3em] uppercase font-bold">
                        Awaiting Uplink...
                    </div>
                ) : (
                    satIds.map(id => (
                        <SatelliteCard 
                            key={id}
                            id={id}
                            sat={satellites[id]}
                            isSelected={selectedSatId === id}
                            onSelect={setSelectedSatId}
                        />
                    ))
                )}
            </div>
        </aside>
    );
};

export default SatelliteList;
