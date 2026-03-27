import React, { useState } from 'react';
import { Rocket, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ShieldAlert, Zap, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CommandValidationPanel from './CommandValidationPanel';
import RTNVisualizer from './RTNVisualizer';

const ManeuverPanel = ({ satelliteId, fuel, onManeuverComplete }) => {
    const [type, setType] = useState('HOhmann'); // types: HOhmann, PlaneChange, Phasing, COLA, RTN
    const [params, setParams] = useState({ target_alt: 800, delta_inc: 1, delta_alt: 10, r: 0, t: 0, n: 0 });
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const handleExecute = async () => {
        if (loading) return;
        setLoading(true);
        setResult(null);

        let endpoint = '/api/maneuver/hohmann';
        let body = { satellite_id: satelliteId };

        if (type === 'HOhmann') {
            endpoint = '/api/maneuver/hohmann';
            body.target_altitude_km = parseFloat(params.target_alt);
        } else if (type === 'PlaneChange') {
            endpoint = '/api/maneuver/plane-change';
            body.delta_inclination_deg = parseFloat(params.delta_inc);
        } else if (type === 'Phasing') {
            endpoint = '/api/maneuver/phasing';
            body.delta_altitude_km = parseFloat(params.delta_alt);
        } else if (type === 'COLA') {
            endpoint = '/api/maneuver/collision-avoidance';
        } else if (type === 'RTN') {
            endpoint = '/api/decision/execute'; 
            body.maneuver_type = 'RTN_MANUAL';
            body.dv_rtn = [parseFloat(params.r), parseFloat(params.t), parseFloat(params.n)];
        }

        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await resp.json();
            setResult(data);
            if (data.status === 'EXECUTED' && onManeuverComplete) {
                onManeuverComplete(data);
            }
        } catch (e) {
            setResult({ status: 'ERROR', reason: e.message });
        } finally {
            setLoading(false);
            setTimeout(() => setResult(null), 8000);
        }
    };

    const isCritical = fuel < 5;
    const manualDv = type === 'RTN' ? [parseFloat(params.r), parseFloat(params.t), parseFloat(params.n)] : null;

    return (
        <div className="flex flex-col gap-6">
            <div className="bg-black/80 border border-white/10 rounded-2xl p-6 flex flex-col gap-6 shadow-2xl backdrop-blur-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 blur-[80px] -z-10 group-hover:bg-accent/10 transition-colors" />
                
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <h3 className="text-[12px] text-white/90 tracking-[0.3em] font-black uppercase flex items-center gap-2 italic">
                            <Rocket className="w-4 h-4 text-accent" /> Maneuver Console
                        </h3>
                        <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-1">Unified Astrodynamics Engine v3.0</span>
                    </div>
                </div>

                {/* Maneuver Type Selector */}
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-[0.2em] px-1">Mission Type</label>
                    <div className="grid grid-cols-5 gap-2">
                        {[
                            { id: 'HOhmann', icon: <Zap className="w-3 h-3" />, label: 'Hohmann' },
                            { id: 'PlaneChange', icon: <ChevronDown className="w-3 h-3" />, label: 'Plane' },
                            { id: 'Phasing', icon: <Target className="w-3 h-3" />, label: 'Phase' },
                            { id: 'COLA', icon: <ShieldAlert className="w-3 h-3" />, label: 'COLA' },
                            { id: 'RTN', icon: <Zap className="w-3 h-3" />, label: 'Manual' },
                        ].map(m => (
                            <button 
                                key={m.id}
                                onClick={() => setType(m.id)}
                                className={`p-2 rounded-xl border flex flex-col items-center gap-2 transition-all duration-300 ${
                                    type === m.id 
                                    ? 'bg-accent/20 border-accent/60 shadow-[0_0_15px_rgba(30,144,255,0.2)] text-white' 
                                    : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10 hover:border-white/20'
                                }`}
                            >
                                {m.icon}
                                <span className="text-[7px] font-black uppercase tracking-widest">{m.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Dynamic Inputs */}
                <AnimatePresence mode="wait">
                    <motion.div 
                        key={type}
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                        className="grid grid-cols-1 gap-4"
                    >
                        {type === 'HOhmann' && (
                            <div className="flex flex-col gap-2">
                                <label className="text-[9px] text-white/40 uppercase font-black px-1">Target Altitude (KM)</label>
                                <input 
                                    type="number" 
                                    value={params.target_alt}
                                    onChange={(e) => setParams({...params, target_alt: e.target.value})}
                                    className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs font-mono text-white focus:outline-none focus:border-accent/50 transition-all"
                                />
                            </div>
                        )}

                        {type === 'PlaneChange' && (
                            <div className="flex flex-col gap-2">
                                <label className="text-[9px] text-white/40 uppercase font-black px-1">ΔInclination (DEG)</label>
                                <input 
                                    type="number" 
                                    value={params.delta_inc}
                                    onChange={(e) => setParams({...params, delta_inc: e.target.value})}
                                    className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs font-mono text-white focus:outline-none focus:border-accent/50 transition-all"
                                />
                            </div>
                        )}

                        {type === 'Phasing' && (
                            <div className="flex flex-col gap-2">
                                <label className="text-[9px] text-white/40 uppercase font-black px-1">ΔAltitude for Phasing (KM)</label>
                                <input 
                                    type="number" 
                                    value={params.delta_alt}
                                    onChange={(e) => setParams({...params, delta_alt: e.target.value})}
                                    className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs font-mono text-white focus:outline-none focus:border-accent/50 transition-all"
                                />
                            </div>
                        )}

                        {type === 'COLA' && (
                            <div className="bg-red-900/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-4">
                                <ShieldAlert className="w-6 h-6 text-red-500" />
                                <p className="text-[9px] text-red-200/70 font-bold uppercase tracking-widest leading-relaxed">
                                    AUTO-COLA will detect critical threats and execute an optimal avoidance burn.
                                </p>
                            </div>
                        )}

                        {type === 'RTN' && (
                            <div className="grid grid-cols-3 gap-3">
                                {['R', 'T', 'N'].map(axis => (
                                    <div key={axis} className="flex flex-col gap-2">
                                        <label className="text-[8px] text-white/30 uppercase font-black px-1">{axis}-KM/S</label>
                                        <input 
                                            type="number" 
                                            step="0.001"
                                            value={params[axis.toLowerCase()]}
                                            onChange={(e) => setParams({...params, [axis.toLowerCase()]: e.target.value})}
                                            className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs font-mono text-white focus:outline-none focus:border-accent/50 transition-all"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>

                <button 
                    onClick={handleExecute}
                    disabled={loading || isCritical}
                    className={`w-full py-4 rounded-xl font-black text-[10px] tracking-[0.4em] flex items-center justify-center gap-2 uppercase transition-all duration-500 ${
                        loading ? 'bg-white/5 text-white/20 cursor-wait' : 
                        isCritical ? 'bg-red-950/20 text-red-900 border border-red-900/30 cursor-not-allowed' :
                        'bg-accent/20 text-accent border border-accent/30 hover:bg-accent hover:text-white hover:shadow-[0_0_30px_rgba(30,144,255,0.4)] active:scale-[0.98]'
                    }`}
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    {isCritical ? 'LOW PROPELLANT' : type === 'COLA' ? 'INITIATE AUTO-COLA' : 'EXECUTE MANEUVER'}
                </button>

                <AnimatePresence>
                    {result && (
                        <motion.div 
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            className={`p-4 rounded-xl border flex flex-col gap-2 shadow-xl ${
                                result.status === 'EXECUTED' ? 'bg-green-900/10 border-green-500/30' : 'bg-red-900/10 border-red-500/30'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                {result.status === 'EXECUTED' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}
                                <span className={`text-[10px] font-black tracking-widest uppercase ${result.status === 'EXECUTED' ? 'text-green-400' : 'text-red-400'}`}>
                                    {result.status}
                                </span>
                            </div>
                            {result.reason && (
                                <p className="text-[9px] text-white/60 font-medium px-1 mt-1 leading-tight">{result.reason}</p>
                            )}
                            {result.dv_mag_kms !== undefined && (
                                <div className="flex justify-between items-center text-[9px] font-mono text-white/40 px-1 pt-1 border-t border-white/5">
                                    <span className="uppercase tracking-tighter italic">Total Delta-v Applied:</span>
                                    <span className="text-white font-bold">{result.dv_mag_kms.toFixed(6)} KM/S</span>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {type === 'RTN' && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="flex flex-col gap-6"
                    >
                        <RTNVisualizer satelliteId={satelliteId} dvRtn={manualDv} />
                        <CommandValidationPanel satelliteId={satelliteId} manualDv={manualDv} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ManeuverPanel;
