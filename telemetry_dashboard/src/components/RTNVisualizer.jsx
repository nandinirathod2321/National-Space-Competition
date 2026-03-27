import React from 'react';
import { Compass, Move, CircleDot } from 'lucide-react';

const RTNVisualizer = ({ satelliteId, dvRtn }) => {
    if (!satelliteId) return null;
    
    const [dr, dt, dn] = dvRtn || [0, 0, 0];
    const scale = 30; // Scale factor for vector lengths

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-accent tracking-[0.2em] uppercase flex items-center gap-2 font-black italic">
                    <Compass className="w-3 h-3" /> Relative Frame (RTN)
                </h3>
            </div>

            {/* RTN Vector schematic */}
            <div className="flex items-center justify-center p-6 bg-black/40 border border-white/5 rounded-2xl relative h-48">
                <svg width="100%" height="100%" viewBox="-100 -100 200 200" className="overflow-visible">
                    <defs>
                        <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                            <path d="M0,0 L6,2 L0,4 Z" fill="currentColor" />
                        </marker>
                    </defs>

                    {/* Radial (R) - Cyan */}
                    <line x1="0" y1="0" x2={dr * scale} y2="0" stroke="#22d3ee" strokeWidth="2" markerEnd="url(#arrow)" />
                    <text x={dr * scale + 10} y="4" className="fill-[#22d3ee] text-[10px] font-black italic uppercase">R</text>

                    {/* Transverse (T) - Yellow */}
                    <line x1="0" y1="0" x2="0" y2={dt * -scale} stroke="#facc15" strokeWidth="2" markerEnd="url(#arrow)" />
                    <text x="4" y={dt * -scale - 10} className="fill-[#facc15] text-[10px] font-black italic uppercase">T</text>

                    {/* Normal (N) - Blue */}
                    <line x1="0" y1="0" x2={dn * scale * 0.7} y2={dn * -scale * 0.7} stroke="#63b3ed" strokeWidth="2" markerEnd="url(#arrow)" />
                    <text x={dn * scale * 0.7 + 10} y={dn * -scale * 0.7 - 5} className="fill-[#63b3ed] text-[10px] font-black italic uppercase">N</text>

                    {/* Satellite Body */}
                    <circle cx="0" cy="0" r="4" fill="#fff" className="animate-pulse" />
                    <text x="8" y="15" className="fill-white/20 text-[6px] font-black uppercase tracking-tighter">NADIR REF</text>
                </svg>

                {/* Absolute Indicators */}
                <div className="absolute top-4 right-4 flex flex-col items-end gap-1 font-mono text-[8px] opacity-40">
                    <span className="text-cyan-400">ΔVR: {dr.toFixed(3)} KM/S</span>
                    <span className="text-yellow-400">ΔVT: {dt.toFixed(3)} KM/S</span>
                    <span className="text-blue-400">ΔVN: {dn.toFixed(3)} KM/S</span>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-white/5 border border-white/5 rounded-xl flex flex-col items-center">
                    <span className="text-[8px] text-cyan-400 font-black uppercase mb-1">RADIAL</span>
                    <span className="text-[10px] font-mono text-white/80 tracking-tighter">ALONG VELOCITY</span>
                </div>
                <div className="p-3 bg-white/5 border border-white/5 rounded-xl flex flex-col items-center text-center">
                    <span className="text-[8px] text-yellow-400 font-black uppercase mb-1">TRANSVERSE</span>
                    <span className="text-[10px] font-mono text-white/80 tracking-tighter">PERPENDICULAR IN-PLANE</span>
                </div>
                <div className="p-3 bg-white/5 border border-white/5 rounded-xl flex flex-col items-center text-center">
                    <span className="text-[8px] text-blue-400 font-black uppercase mb-1">NORMAL</span>
                    <span className="text-[10px] font-mono text-white/80 tracking-tighter">CROSS PRODUCT ANG-MOM</span>
                </div>
            </div>
        </div>
    );
};

export default RTNVisualizer;
