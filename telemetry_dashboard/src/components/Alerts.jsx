import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Info } from 'lucide-react';

const Alerts = ({ alerts }) => {
    return (
        <div className="fixed bottom-12 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
            <AnimatePresence>
                {alerts.map((alert, idx) => (
                    <motion.div
                        key={`${alert.id}-${idx}`}
                        initial={{ x: 300, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 300, opacity: 0 }}
                        className={`pointer-events-auto p-4 rounded-xl border flex items-start gap-4 shadow-2xl backdrop-blur-md w-80 ${alert.type === 'error' ? 'bg-red-950/40 border-red-500/30' : 'bg-blue-950/40 border-blue-500/30'}`}
                    >
                        <div className={`p-2 rounded-lg ${alert.type === 'error' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500'}`}>
                            {alert.type === 'error' ? <ShieldAlert className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                        </div>
                        <div className="flex-1">
                            <h4 className={`text-[10px] font-black uppercase tracking-widest ${alert.type === 'error' ? 'text-red-500' : 'text-blue-400'}`}>
                                {alert.title}
                            </h4>
                            <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                                {alert.message}
                            </p>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
};

export default Alerts;
