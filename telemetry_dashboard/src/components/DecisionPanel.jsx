import React, { useState } from 'react';
import { Target, ShieldCheck, Zap, ToggleLeft, ToggleRight, Radio, ShieldAlert } from 'lucide-react';
import useTelemetryStore from '../store/useTelemetryStore';
import { motion, AnimatePresence } from 'framer-motion';

const DecisionPanel = ({ satelliteId, decision, autoMode }) => {
    const { toggleAutoMode, addAlert } = useTelemetryStore();
    const [executing, setExecuting] = useState(false);

    if (!decision) return null;

    const handleToggle = async () => {
        const res = await toggleAutoMode(satelliteId, autoMode);
        if (res) addAlert({
            id: `auto-${satelliteId}`,
            type: res.auto_mode ? 'success' : 'warning',
            title: `Mode Updated: ${satelliteId}`,
            message: `Satellite guidance system set to ${res.auto_mode ? 'AUTONOMOUS' : 'MANUAL'}.`
        });
    };

    const handleManualExecute = async () => {
        setExecuting(true);
        try {
            const resp = await fetch('/api/decision/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    satellite_id: satelliteId,
                    maneuver_type: decision.type,
                    dv_rtn: decision.suggested_dv_rtn_kms
                })
            });
            const res = await resp.json();
            if (res.status === 'EXECUTED') {
                addAlert({
                    id: `burn-${satelliteId}`,
                    type: 'success',
                    title: 'Avoidance Burn Executed',
                    message: `Propellant expelled: ${res.fuel_burned_kg.toFixed(3)}kg. Risk neutralized.`
                });
            }
        } catch (e) {
            addAlert({ id: `error-${satelliteId}`, type: 'error', title: 'Burn Failure', message: 'Failed to apply manual evasion.' });
        } finally {
            setExecuting(false);
        }
    };

    const isManeuver = decision.decision === 'maneuver';
    const bgGlow = isManeuver ? 'bg-amber-500/5' : 'bg-emerald-500/5';
    const borderColor = isManeuver ? 'border-amber-500/20' : 'border-emerald-500/20';

    return (
        <div className={`rounded-xl border ${borderColor} p-5 ${bgGlow} flex flex-col gap-4 relative overflow-hidden transition-all duration-500`}>
            {/* AI Core Pulse */}
            <div className="absolute top-[-30px] left-[-30px] w-48 h-48 blur-[80px] bg-white/5 opacity-20 pointer-events-none rounded-full" />

            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-white/40 tracking-[0.3em] uppercase flex items-center gap-2 font-black italic">
                    <Target className="w-4 h-4 text-accent" /> AI Decision Core Sol-V
                </h3>
                
                <button 
                  onClick={handleToggle}
                  className={`flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-black uppercase transition-all duration-300 border ${autoMode ? 'bg-emerald-500 border-emerald-400 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-white/40'}`}
                >
                    {autoMode ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                    {autoMode ? 'AUTONOMOUS' : 'MANUAL'}
                </button>
            </div>

            {/* Recommendation Status */}
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-[8px] text-gray-700 font-bold uppercase mb-1 tracking-widest italic">Logic Output</span>
                    <span className={`text-[13px] font-black uppercase tracking-widest ${isManeuver ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {isManeuver ? 'AVOIDANCE MANEUVER RECON' : 'STATION-KEEPING NOMINAL'}
                    </span>
                </div>
                {isManeuver ? <ShieldAlert className="w-6 h-6 text-amber-500 animate-pulse" /> : <ShieldCheck className="w-6 h-6 text-emerald-500" />}
            </div>

            <AnimatePresence>
            {isManeuver && (
                <motion.div 
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="flex flex-col gap-3"
                >
                    <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                        <p className="text-[10px] text-white/60 font-bold leading-relaxed uppercase tracking-tighter">
                            Recommendation: Execute {decision.type.replace('_', ' ')} via the transverse vector to shift orbital period by {((decision.suggested_dv_rtn_kms?.[1] || 0) * 1000).toFixed(2)} m/s.
                        </p>
                    </div>

                    {!autoMode && (
                        <button 
                            disabled={executing}
                            onClick={handleManualExecute}
                            className={`w-full bg-amber-500 hover:bg-amber-400 text-black py-4 rounded-xl text-xs font-black tracking-widest uppercase transition-all active:scale-[0.98] flex items-center justify-center gap-3 ${executing ? 'animate-pulse' : ''}`}
                        >
                            <Zap className="w-4 h-4 fill-black" />
                            {executing ? 'BURNING...' : 'APPLY AI EVASION RECOMMENDATION'}
                        </button>
                    )}
                </motion.div>
            )}
            </AnimatePresence>
            
            <div className="flex justify-between items-center text-[8px] uppercase font-black text-white/20 tracking-widest italic pt-2">
                <span>Core Latency: 4ms</span>
                <span className="flex items-center gap-1"><Radio className="w-2 h-2" /> Synced with Backend</span>
            </div>
        </div>
    );
};

export default DecisionPanel;
