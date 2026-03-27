import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import { TrendingUp, RefreshCcw } from 'lucide-react';

const EnergyGraph = ({ history }) => {
    // Recharts requires non-circular data structure
    const data = history.map((h, i) => ({
        index: i,
        energy: h.energy,
        error: h.error
    }));

    return (
        <div className="bg-black/40 backdrop-blur-md border border-white/5 rounded-2xl p-5 flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex flex-col">
                    <div className="flex items-center gap-3">
                        <TrendingUp className="w-4 h-4 text-white/40" />
                        <span className="text-[10px] font-black tracking-[0.2em] uppercase text-white/60">Energy Conservation (Specific Energy)</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 group cursor-pointer">
                    <RefreshCcw className="w-3 h-3 text-white/20 group-hover:text-accent transition-colors rotate-0 group-hover:rotate-180" />
                    <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Real-time (Hz)</span>
                </div>
            </div>

            <div className="flex-1 w-full min-h-[140px] mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid vertical={false} stroke="#ffffff05" strokeWidth={1} />
                        <XAxis 
                            dataKey="index" 
                            hide 
                        />
                        <YAxis 
                            domain={['dataMin - 0.0001', 'dataMax + 0.0001']} 
                            hide 
                        />
                        <Tooltip 
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="bg-black border border-white/10 p-3 rounded-lg shadow-2xl">
                                            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">E (km²/s²)</p>
                                            <p className="text-sm font-mono text-accent">{payload[0].value.toFixed(6)}</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Line 
                            type="monotone" 
                            dataKey="energy" 
                            stroke="#A855F7" 
                            strokeWidth={2} 
                            dot={false}
                            animationDuration={0}
                            isAnimationActive={false}
                        />
                        {/* Glow effect for the line */}
                        <Line 
                            type="monotone" 
                            dataKey="energy" 
                            stroke="#A855F7" 
                            strokeWidth={4} 
                            strokeOpacity={0.15}
                            dot={false}
                            animationDuration={0}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            
            <div className="flex justify-between items-center text-[9px] font-bold text-white/10 uppercase tracking-widest border-t border-white/5 pt-3">
                <span>90m History</span>
                <span className="text-white/30 tracking-tight font-mono">
                    VAR: ±{(data.length > 2 ? Math.max(...data.map(d => d.energy)) - Math.min(...data.map(d => d.energy)) : 0).toExponential(2)}
                </span>
            </div>
        </div>
    );
};

export default EnergyGraph;
