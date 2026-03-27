import React from 'react';
import { Play, Pause, FastForward, Clock } from 'lucide-react';
import useTelemetryStore from '../store/useTelemetryStore';

const TimeControlPanel = () => {
    const { simulationMetrics, setSimClock } = useTelemetryStore();
    const { time } = simulationMetrics;

    const formatUTC = (iso) => {
        try {
            return new Date(iso).toUTCString().slice(5, 25);
        } catch(e) { return "SYNCING..."; }
    };

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] text-accent font-black uppercase tracking-[0.2em] flex items-center gap-2">
                    <Clock className="w-3 h-3" /> Mission Time (UTC)
                </h3>
                <span className="text-[8px] bg-white/5 px-2 py-0.5 rounded text-white/40 font-mono tracking-widest">REAL-TIME SYNC</span>
            </div>

            <div className="bg-black/40 border border-white/5 p-4 rounded-xl flex flex-col items-center">
                <span className="text-xl font-mono text-white tabular-nums tracking-wider font-bold">
                    {formatUTC(time.utc)}
                </span>
            </div>

            <div className="flex items-center gap-3">
                <button 
                    onClick={() => setSimClock({ paused: !time.is_paused })}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${time.is_paused ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 font-bold' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                >
                    {time.is_paused ? <Play className="w-3 h-3 fill-amber-400" /> : <Pause className="w-3 h-3 fill-white/60" />}
                    <span className="text-[9px] font-black uppercase tracking-widest">{time.is_paused ? 'RESUME' : 'PAUSE'}</span>
                </button>

                <div className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg border border-white/10">
                    <FastForward className="w-3 h-3 text-white/30" />
                    <input 
                        type="range" min="0.1" max="100" step="1" 
                        value={time.speed}
                        onChange={(e) => setSimClock({ speed: parseFloat(e.target.value) })}
                        className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                    <span className="text-[9px] font-mono text-accent w-8">{time.speed}X</span>
                </div>
            </div>
        </div>
    );
};

export default TimeControlPanel;
