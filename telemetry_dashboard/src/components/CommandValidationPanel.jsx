import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Cpu, Fuel, Thermometer, Radio, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

const CommandValidationPanel = ({ satelliteId, manualDv }) => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    const validate = async () => {
        if (!satelliteId || !manualDv) return;
        setLoading(true);
        try {
            const resp = await fetch('/api/command/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ satellite_id: satelliteId, dv_rtn: manualDv })
            });
            const data = await resp.json();
            setStatus(data);
        } catch (e) {
            console.error("Validation failed:", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (manualDv) validate();
    }, [manualDv, satelliteId]);

    const steps = [
        { id: 'LOS', icon: Radio, text: 'Ground Station visibility', fail: 'NO_GROUND_STATION_VISIBILITY' },
        { id: 'FUEL', icon: Fuel, text: 'Propellant availability', fail: 'INSUFFICIENT_FUEL' },
        { id: 'COOL', icon: Thermometer, text: 'Thruster thermal cooldown', fail: 'COMMAND_COOLDOWN_ACTIVE' },
        { id: 'SAFETY', icon: ShieldCheck, text: 'Orbital safety envelope', fail: 'SAFETY_HAZARD_DETECTED' }
    ];

    return (
        <div className="bg-[#111116] border border-[#ffffff10] rounded-xl p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] text-accent tracking-[0.2em] uppercase flex items-center gap-2 font-black italic">
                    <Cpu className="w-3 h-3" /> Command Pre-flight Audit (v3)
                </h3>
                {loading && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
            </div>

            <div className="space-y-3">
                {steps.map((step, idx) => {
                    const isFailed = status && status.reason === step.fail;
                    const isPassed = status && status.approved;
                    const isNeutral = !status;

                    return (
                        <div key={idx} className={`p-4 rounded-xl border flex items-center justify-between transition-all ${isFailed ? 'bg-red-500/10 border-red-500/20' : isPassed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/5 border-white/5 opacity-50'}`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isFailed ? 'bg-red-500/20 text-red-400' : isPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
                                    <step.icon className="w-4 h-4" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-white/80 uppercase tracking-widest">{step.id} CHECK</span>
                                    <span className="text-[8px] font-mono text-white/40 uppercase">{step.text}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {isPassed ? <ShieldCheck className="w-4 h-4 text-emerald-500" /> : isFailed ? <ShieldAlert className="w-4 h-4 text-red-500" /> : null}
                            </div>
                        </div>
                    );
                })}
            </div>

            {status && (
                <div className={`mt-2 p-4 rounded-xl border text-[9px] font-black uppercase tracking-widest text-center ${status.approved ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/20 border-red-500/30 text-red-500'}`}>
                    GO FOR BURN: {status.approved ? 'APPROVED' : 'REJECTED — ' + status.reason.replace(/_/g, ' ')}
                </div>
            )}
        </div>
    );
};

export default CommandValidationPanel;
