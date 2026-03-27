import React from 'react';
import FuelBar from './FuelBar';
import { Activity } from 'lucide-react';

const TelemetryPanel = ({ satelliteId, telemetry }) => {
    if (!telemetry) return (
        <div className="h-full bg-[#111116] border border-[#ffffff10] rounded-xl flex items-center justify-center text-xs tracking-widest text-gray-700 animate-pulse">
            Awaiting Uplink Synchronization...
        </div>
    );

    const formatCoord = (val) => (val * 1000).toLocaleString(undefined, { minimumFractionDigits: 1 });
    const formatVel = (val) => val.toFixed(4);

    return (
        <div className="h-full bg-[#111116] border border-[#ffffff10] rounded-xl p-5 shadow-[0_10px_30px_#00000040]">
            <h3 className="text-[11px] text-accent tracking-widest uppercase mb-6 flex items-center gap-2 font-bold">
                <Activity className="w-3 h-3" /> Live Data Channel — {satelliteId}
            </h3>

            <div className="space-y-6">
                {/* Position Group */}
                <div className="grid grid-cols-1 gap-2">
                    <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Position (m ECI)</span>
                    <div className="grid grid-cols-3 gap-2">
                        {['X', 'Y', 'Z'].map((axis, i) => (
                            <div key={axis} className="bg-black/40 border border-white/5 p-3 rounded-lg flex flex-col items-center">
                                <span className="text-[8px] text-gray-700 font-bold mb-1">{axis}</span>
                                <span className="text-xs font-mono text-white tabular-nums">{formatCoord(telemetry.position[i])}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Velocity Group */}
                <div className="grid grid-cols-1 gap-2">
                    <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Velocity (km/s)</span>
                    <div className="grid grid-cols-3 gap-2">
                        {['VX', 'VY', 'VZ'].map((axis, i) => (
                            <div key={axis} className="bg-black/40 border border-white/5 p-3 rounded-lg flex flex-col items-center">
                                <span className="text-[8px] text-gray-700 font-bold mb-1">{axis}</span>
                                <span className="text-xs font-mono text-accent tabular-nums">{formatVel(telemetry.velocity[i])}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Fuel Group */}
                <div className="pt-2">
                    <FuelBar fuel={telemetry.fuel} />
                </div>

                <div className="bg-[#ffffff02] p-3 rounded border border-white/5">
                    <div className="flex justify-between text-[9px] uppercase font-bold text-gray-600">
                        <span>Timestamp (UTC)</span>
                        <span className="text-white font-mono">{new Date(telemetry.timestamp * 1000).toISOString().slice(11, 23)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TelemetryPanel;
