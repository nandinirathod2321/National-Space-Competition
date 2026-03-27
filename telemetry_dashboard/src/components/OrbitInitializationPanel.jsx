import React, { useState } from 'react';
import { Globe, Loader2, CheckCircle2, AlertTriangle, Database, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const OrbitInitializationPanel = () => {
    const [satId, setSatId] = useState('AKASH-' + Math.floor(Math.random() * 900 + 100));
    const [elements, setElements] = useState({
        a: 7000,
        e: 0.001,
        i: 45,
        raan: 30,
        arg_p: 60,
        nu: 10
    });
    const [fuel, setFuel] = useState(120);
    const [mass, setMass] = useState(500);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);

    const handleInitialize = async () => {
        if (loading) return;
        setLoading(true);
        setStatus(null);

        try {
            const resp = await fetch('/api/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: satId,
                    keplerian: {
                        a: parseFloat(elements.a),
                        e: parseFloat(elements.e),
                        i: parseFloat(elements.i),
                        raan: parseFloat(elements.raan),
                        arg_perigee: parseFloat(elements.arg_p),
                        true_anomaly: parseFloat(elements.nu)
                    },
                    fuel: parseFloat(fuel),
                    mass: parseFloat(mass)
                })
            });

            const data = await resp.json();
            setStatus({ type: 'SUCCESS', data });
        } catch (e) {
            setStatus({ type: 'ERROR', message: e.message });
        } finally {
            setLoading(false);
            setTimeout(() => setStatus(null), 10000);
        }
    };

    return (
        <div className="bg-black/60 border border-white/5 rounded-2xl p-6 flex flex-col gap-6 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-emerald-500" />
                    <div>
                        <h3 className="text-[11px] text-white font-black uppercase tracking-[0.2em]">Orbit Initialization</h3>
                        <p className="text-[8px] text-white/30 font-bold uppercase tracking-widest mt-0.5">Keplerian State Vector Synthesis</p>
                    </div>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-[8px] text-emerald-500/50 font-black uppercase">Standard ECI</span>
                    <span className="text-[10px] text-white/60 font-mono">J2000.0</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex flex-col gap-2">
                    <label className="text-[9px] text-white/40 uppercase font-black px-1">Satellite Identifier</label>
                    <div className="relative">
                        <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
                        <input 
                            value={satId}
                            onChange={(e) => setSatId(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 pl-10 text-xs font-mono text-white focus:outline-none focus:border-emerald-500/50 transition-all font-bold"
                        />
                    </div>
                </div>

                {[
                    { key: 'a', label: 'SMA (a) km', min: 6500, max: 42000 },
                    { key: 'e', label: 'ECC (e)', min: 0, max: 0.9 },
                    { key: 'i', label: 'INC (i) deg', min: 0, max: 180 },
                    { key: 'raan', label: 'RAAN (Ω) deg', min: 0, max: 360 },
                    { key: 'arg_p', label: 'AOP (ω) deg', min: 0, max: 360 },
                    { key: 'nu', label: 'TA (ν) deg', min: 0, max: 360 },
                ].map(el => (
                    <div key={el.key} className="flex flex-col gap-2">
                        <label className="text-[8px] text-white/40 uppercase font-black px-1 leading-none">{el.label}</label>
                        <input 
                            type="number"
                            step={el.key === 'e' ? '0.0001' : '1'}
                            value={elements[el.key]}
                            onChange={(e) => setElements({...elements, [el.key]: e.target.value})}
                            className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-[11px] font-mono text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                        />
                    </div>
                ))}

                <div className="flex flex-col gap-2">
                    <label className="text-[8px] text-white/40 uppercase font-black px-1">Fuel (kg)</label>
                    <input 
                        type="number"
                        value={fuel}
                        onChange={(e) => setFuel(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-[11px] font-mono text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-[8px] text-white/40 uppercase font-black px-1">Dry Mass (kg)</label>
                    <input 
                        type="number"
                        value={mass}
                        onChange={(e) => setMass(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-[11px] font-mono text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                    />
                </div>
            </div>

            <button 
                onClick={handleInitialize}
                disabled={loading}
                className={`w-full py-4 rounded-xl font-black text-[10px] tracking-[0.3em] flex items-center justify-center gap-3 uppercase transition-all duration-500 ${
                    loading ? 'bg-white/5 text-white/20 cursor-wait' : 
                    'bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white hover:shadow-[0_0_25px_rgba(16,185,129,0.3)]'
                }`}
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Sync with Constellation
            </button>

            <AnimatePresence>
                {status && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                        className={`p-4 rounded-xl border flex flex-col gap-2 ${
                            status.type === 'SUCCESS' ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-red-900/10 border-red-500/20'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            {status.type === 'SUCCESS' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}
                            <span className="text-[10px] font-black uppercase tracking-widest">{status.type === 'SUCCESS' ? 'Uplink Confirmed' : 'Initialization Failed'}</span>
                        </div>
                        <p className="text-[9px] text-white/50 leading-relaxed font-medium">
                            {status.type === 'SUCCESS' ? `Active presence established for ${status.data.id}. Cartesian state broadcasted to tracking station.` : status.message}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="bg-white/[0.02] rounded-xl p-3 flex items-start gap-3 border border-white/5">
                <Info className="w-4 h-4 text-white/20 shrink-0 mt-0.5" />
                <p className="text-[8px] text-white/20 leading-relaxed uppercase font-bold tracking-wider">
                    All values are relative to the IERS Reference Meridian and J2000 epoch. Valid propagation depends on correct SMA/ECC ratios.
                </p>
            </div>
        </div>
    );
};

export default OrbitInitializationPanel;
