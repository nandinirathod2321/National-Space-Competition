import React from 'react';
import { motion } from 'framer-motion';

const FuelBar = ({ fuel, maxFuel = 50 }) => {
    const percentage = (fuel / maxFuel) * 100;
    const isCritical = fuel < 5;

    return (
        <div className="w-full">
            <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Propellant</span>
                <span className={`text-xs font-mono ${isCritical ? 'text-red-500 font-bold' : 'text-accent'}`}>{fuel.toFixed(2)} kg</span>
            </div>
            <div className="h-2 w-full bg-gray-900 rounded-full border border-white/5 overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    className={`h-full ${isCritical ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : 'bg-accent/60 shadow-[0_0_15px_#00D4FF40]'}`}
                />
            </div>
            {isCritical && (
                <motion.p 
                    animate={{ opacity: [1, 0.4, 1] }} 
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="text-[8px] text-red-500 uppercase font-bold mt-1 text-right"
                >
                    Fuel Consumption Alert
                </motion.p>
            )}
        </div>
    );
};

export default FuelBar;
