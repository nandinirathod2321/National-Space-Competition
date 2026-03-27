import React from 'react';
import { Map, LucideSatellite, Navigation2 } from 'lucide-react';
import { motion } from 'framer-motion';

const OrbitView = ({ satelliteId, telemetry, transferTrajectory }) => {
    if (!telemetry) return null;

    // Scale ECI [x, y, z] to viewport pixels (relative)
    const MAX_RAD = 12000;
    
    const getPos = (pos) => ({
        x: ((pos[0] + MAX_RAD) / (MAX_RAD * 2)) * 100,
        y: ((-pos[1] + MAX_RAD) / (MAX_RAD * 2)) * 100
    });

    const satPos = getPos(telemetry.position);

    return (
        <div className="h-full bg-black/80 border border-white/10 rounded-2xl p-6 relative overflow-hidden flex flex-col shadow-2xl backdrop-blur-md">
            <h3 className="text-[11px] text-white/50 tracking-[0.4em] uppercase mb-6 flex items-center gap-3 font-black italic">
                <Navigation2 className="w-4 h-4 text-accent animate-pulse" /> ECI Reference Plane
            </h3>
            
            <div className="flex-1 relative flex items-center justify-center p-4 border border-white/5 rounded-2xl bg-[radial-gradient(circle_at_center,rgba(30,144,255,0.03)_0%,transparent_80%)]">
                {/* Earth Representative Circle */}
                <div className="absolute w-32 h-32 rounded-full border-2 border-accent/20 flex items-center justify-center bg-accent/5 shadow-[0_0_50px_rgba(30,144,255,0.1)]">
                    <div className="absolute w-40 h-40 rounded-full border border-accent/10 animate-spin-slow" />
                    <div className="w-20 h-20 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(30,144,255,0.14),#000000)] border border-white/5" />
                </div>

                {/* Transfer Trajectory (Hohmann/Phasing) */}
                {transferTrajectory && transferTrajectory.length > 0 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                        <motion.polyline 
                            points={transferTrajectory.map(p => {
                                const pt = getPos(p);
                                return `${pt.x}%,${pt.y}%`;
                            }).join(' ')}
                            fill="none" 
                            stroke="#1e90ff" 
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 0.6 }}
                            transition={{ duration: 1.5, ease: "easeInOut" }}
                        />
                    </svg>
                )}

                {/* Satellite Marker */}
                <motion.div 
                    animate={{ left: `${satPos.x}%`, top: `${satPos.y}%` }}
                    transition={{ type: 'spring', bounce: 0, duration: 0.8 }}
                    className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-20 group"
                >
                    <div className="absolute w-12 h-12 rounded-full bg-accent/20 blur-xl group-hover:bg-accent/40 transition-colors" />
                    <div className="absolute w-3 h-3 rounded-full bg-accent shadow-[0_0_15px_#1e90ff]" />
                    <div className="absolute -top-6 text-[8px] text-white font-black tracking-[0.2em] uppercase whitespace-nowrap bg-black/40 px-2 py-0.5 rounded border border-white/10 backdrop-blur-sm">
                        {satelliteId}
                    </div>
                </motion.div>

                {/* Grid Lines */}
                <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 pointer-events-none opacity-20">
                    {Array.from({length: 36}).map((_, i) => (
                        <div key={i} className="border border-white/5" />
                    ))}
                </div>
            </div>

            <div className="absolute bottom-6 right-8 flex flex-col gap-2 items-end">
                <div className="flex items-center gap-2 bg-black/40 border border-white/5 px-3 py-1.5 rounded-full backdrop-blur-md">
                    <span className="text-[8px] text-white/30 font-black uppercase tracking-widest">Ground Distance</span>
                    <span className="text-[11px] text-white font-mono font-bold tracking-tighter italic">
                        { (Math.sqrt(telemetry.position[0]**2 + telemetry.position[1]**2 + telemetry.position[2]**2) - 6378.137).toFixed(2) } KM
                    </span>
                </div>
            </div>
        </div>
    );
};

export default OrbitView;

