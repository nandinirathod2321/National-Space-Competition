import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Activity, Zap } from 'lucide-react';

const GraphPanel = ({ title, data, dataKey, color, type = 'area' }) => {
    return (
        <div className="h-full bg-[#111116] border border-[#ffffff10] rounded-xl p-5 flex flex-col">
            <h3 className="text-[11px] text-gray-400 tracking-widest uppercase mb-6 flex items-center gap-2 font-bold">
                {type === 'area' ? <Zap className="w-3 h-3 text-emerald-500" /> : <Activity className="w-3 h-3 text-purple-500" />}
                {title}
            </h3>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    {type === 'area' ? (
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor={color} stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis hide dataKey="timestamp" />
                            <YAxis hide domain={['dataMin - 0.1', 'dataMax + 0.1']} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', fontSize: '10px' }}
                                itemStyle={{ color: color }}
                            />
                            <Area 
                                type="monotone" 
                                dataKey={dataKey} 
                                stroke={color} 
                                fillOpacity={1} 
                                fill={`url(#grad-${dataKey})`} 
                                animationDuration={500}
                                isAnimationActive={false} // Faster updates
                            />
                        </AreaChart>
                    ) : (
                        <LineChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis hide dataKey="timestamp" />
                            <YAxis hide domain={['dataMin - 0.5', 'dataMax + 0.5']} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', fontSize: '10px' }}
                                itemStyle={{ color: color }}
                            />
                            <Line 
                                type="stepAfter" 
                                dataKey={dataKey} 
                                stroke={color} 
                                strokeWidth={2} 
                                dot={false}
                                animationDuration={300}
                                isAnimationActive={false}
                            />
                        </LineChart>
                    )}
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default GraphPanel;
