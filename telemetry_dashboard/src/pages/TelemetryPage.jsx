import React, { useEffect, useState } from 'react';
import useTelemetryStore from '../store/useTelemetryStore';
import { startTelemetryWS, stopTelemetryWS } from '../services/websocket';
import { Signal, SignalLow, Database, ShieldAlert, Plus, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Built Components
import SatelliteList from '../components/SatelliteList';
import TelemetryPanel from '../components/TelemetryPanel';
import GraphPanel from '../components/GraphPanel';
import OrbitView from '../components/OrbitView';
import Alerts from '../components/Alerts';
import ManeuverPanel from '../components/ManeuverPanel';
import StabilityPanel from '../components/StabilityPanel';
import EnergyGraph from '../components/EnergyGraph';
import OrbitInitializationPanel from '../components/OrbitInitializationPanel';
import CollisionRiskPanel from '../components/CollisionRiskPanel';
import DecisionPanel from '../components/DecisionPanel';
import TimeControlPanel from '../components/TimeControlPanel';
import GroundStationMap from '../components/GroundStationMap';
import PerformanceDashboard from '../components/PerformanceDashboard';
import CommandValidationPanel from '../components/CommandValidationPanel';
import RTNVisualizer from '../components/RTNVisualizer';
import FleetHeatmap from '../components/FleetHeatmap';
import ManeuverHistory from '../components/ManeuverHistory';

const TelemetryPage = () => {
    const { 
        satellites, 
        selectedSatId, 
        updateTelemetry, 
        setConnectionStatus, 
        connectionStatus,
        alerts,
        simulationMetrics,
        updateSimulationMetrics
    } = useTelemetryStore();
    
    const [lastSync, setLastSync] = useState(Date.now());
    const [transferTrajectory, setTransferTrajectory] = useState(null);
    const [showPlanning, setShowPlanning] = useState(false);
    
    const selectedSat = satellites[selectedSatId];

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('view') === 'planning') {
            setShowPlanning(true);
        }
    }, []);

    useEffect(() => {
        // Initialize WebSocket Connection with metrics handler
        startTelemetryWS(updateTelemetry, setConnectionStatus, updateSimulationMetrics);
        
        // Fallback polling (every 3s if disconnected)
        const poller = setInterval(() => {
            if (connectionStatus === 'disconnected') {
                fetch('/api/states')
                    .then(res => res.json())
                    .then(data => {
                        if (data && data.objects) {
                            data.objects.forEach(obj => {
                                if (obj.type === 'SATELLITE') {
                                    updateTelemetry({
                                        satellite_id: obj.id,
                                        timestamp: obj.timestamp || Date.now() / 1000,
                                        pos: obj.pos,
                                        vel: obj.vel,
                                        fuel_kg: obj.fuel_kg || 0
                                    });
                                }
                            });
                        }
                    })
                    .catch(e => console.error('Fallback Polling Error:', e));
                
                // Fetch metrics too
                fetch('/api/simulation/metrics')
                    .then(res => res.json())
                    .then(updateSimulationMetrics)
                    .catch(() => {});
            }
        }, 3000);

        return () => {
            stopTelemetryWS();
            clearInterval(poller);
        };
    }, []); // Run on mount only

    // Cleanup trajectory after 10s
    useEffect(() => {
        if (transferTrajectory) {
            const timer = setTimeout(() => setTransferTrajectory(null), 10000);
            return () => clearTimeout(timer);
        }
    }, [transferTrajectory]);

    const isAlert = selectedSat && selectedSat.fuel < 5;

    return (
        <div className="min-h-screen bg-black text-silver/80 font-sans selection:bg-white selection:text-black antialiased">
            {/* Celestial Accents - Derived from the Star Chart image */}
            <div className="fixed top-[-20%] left-[-10%] w-1/2 h-1/2 bg-celestial/5 blur-[200px] pointer-events-none rounded-full" />
            <div className="fixed bottom-[-10%] right-[0%] w-1/3 h-1/3 bg-glimmer/5 blur-[150px] pointer-events-none rounded-full" />
            
            {/* Subtle Grid / Chart Plot points */}
            <div className="fixed inset-0 opacity-[0.03] pointer-events-none" 
                 style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '100px 100px' }} />

            {/* Dash Header */}
            <header className="h-20 border-b border-white/5 backdrop-blur-xl bg-black/40 flex items-center justify-between px-10 sticky top-0 z-50">
                <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-5">
                             <div className="flex flex-col">
                                <h1 className="text-3xl celestial-title celestial-glow silver-text leading-none">AKASHVEER</h1>
                                <span className="text-[8px] text-celestial/60 tracking-[0.6em] font-black uppercase mt-1">Celestial Mission Control SOL-V</span>
                             </div>
                             <div className="h-10 w-[0.5px] diagram-border" />
                             <div className="flex flex-col">
                                <span className="text-[8px] text-white/20 tracking-widest font-bold uppercase">Authorized Reconstruction</span>
                                <span className="text-[9px] text-silver/40 italic font-serif">Unauthorized Reproduction Prohibited ©2026</span>
                             </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-8">
                    {/* Toggle Planning View */}
                    <button 
                        onClick={() => setShowPlanning(!showPlanning)}
                        className={`px-6 py-2 rounded-full border text-[9px] font-black tracking-[0.2em] uppercase transition-all duration-700 ${showPlanning ? 'bg-celestial text-white border-white/20 shadow-[0_0_20px_rgba(30,144,255,0.4)]' : 'bg-transparent border-white/10 text-white/30 hover:border-celestial/50 hover:text-celestial'}`}
                    >
                        {showPlanning ? 'DISABLE PLANNING' : 'ORBIT PLANNING'}
                    </button>

                    {/* Stability Badge */}
                    <div className="flex items-center gap-4 bg-black/40 border border-white/5 px-5 py-2 rounded-full">
                        <div className={`w-1.5 h-1.5 rounded-full ${simulationMetrics.stability === 'stable' ? 'bg-celestial shadow-[0_0_8px_#1e90ff]' : 'bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]'}`} />
                        <span className="text-[9px] font-black tracking-[0.2em] uppercase text-silver/60">SIMULATION:{simulationMetrics.stability}</span>
                    </div>
                    
                    <button 
                      onClick={() => window.location.href = '/'} 
                      className="px-5 py-2 bg-transparent hover:bg-white/5 border border-white/10 rounded-md transition-all text-[11px] font-bold tracking-widest uppercase silver-text"
                    >
                        RETURN TO ORBIT GLOBE
                    </button>
                </div>
            </header>

            {/* Grid Layout */}
            <main className="p-6 grid grid-cols-12 gap-6 h-[calc(100vh-64px)] overflow-hidden">
                
                {/* 1. Fleet Selection */}
                <div className="col-span-12 md:col-span-3 lg:col-span-2 h-full flex flex-col gap-6 overflow-hidden">
                    <SatelliteList />
                    <TimeControlPanel />
                    <StabilityPanel metrics={simulationMetrics} />
                </div>

                {/* 2. Primary Telemetry Display */}
                <div className="col-span-12 md:col-span-9 lg:col-span-10 grid grid-cols-12 grid-rows-6 gap-6 h-full overflow-y-auto custom-scrollbar pr-1 md:pr-0">
                    <AnimatePresence mode="wait">
                        {showPlanning ? (
                            <motion.div 
                                className="col-span-12 row-span-6 grid grid-cols-12 gap-6"
                                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                            >
                                <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
                                    <OrbitInitializationPanel />
                                    <div className="bg-blue-900/10 border border-blue-500/20 rounded-2xl p-6">
                                        <h4 className="text-[10px] text-blue-300 font-black uppercase tracking-widest mb-2 italic">Astrodynamics Briefing</h4>
                                        <p className="text-[9px] text-white/50 leading-relaxed uppercase font-bold">
                                            New payloads are automatically propagated via RK4 after initialization. Use the "Manual Burn" tab in the Maneuver Console to fine-tune states.
                                        </p>
                                    </div>
                                </div>
                                <div className="col-span-12 lg:col-span-8 border border-white/5 rounded-2xl bg-white/[0.01] flex items-center justify-center relative overflow-hidden">
                                     <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#7b2fff05_0%,transparent_70%)]" />
                                     <div className="flex flex-col items-center text-center max-w-md z-10 p-8">
                                         <Plus className="w-16 h-16 text-emerald-500/20 mb-6" />
                                         <h2 className="text-xl font-black silver-text tracking-[0.4em] uppercase mb-4 italic">Deploy New Payload</h2>
                                         <p className="text-[10px] text-white/30 font-bold tracking-widest leading-loose">
                                             Define Keplerian elements on the left to synthesize a new orbital presence. Real-time Cartesian state vectors will be calculated and synchronized with mission control.
                                         </p>
                                     </div>
                                </div>
                            </motion.div>
                        ) : !selectedSat ? (
                            <motion.div 
                                initial={{ opacity: 0 }} 
                                animate={{ opacity: 1 }}
                                className="col-span-12 row-span-6 flex flex-col items-center justify-center border border-white/5 rounded-2xl bg-white/[0.01]"
                            >
                                <RefreshCcw className="w-16 h-16 mb-6 text-white/10 animate-spin-slow" />
                                <h2 className="text-lg font-bold tracking-widest uppercase mb-2 silver-text">Awaiting Radio Uplink</h2>
                                <p className="text-[10px] text-gray-600 uppercase tracking-[0.3em]">Initialize satellite selection to synchronize telemetry streams.</p>
                            </motion.div>
                        ) : (
                            <>
                                {/* Telemetry Details & Maneuver */}
                                <motion.div 
                                    className="col-span-12 lg:col-span-4 row-span-4 flex flex-col gap-6"
                                    initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                                >
                                    <TelemetryPanel satelliteId={selectedSatId} telemetry={selectedSat} />
                                    
                                    {/* AI Decision and Risk Analysis */}
                                    {selectedSat && (
                                        <div className="flex flex-col gap-6">
                                            <CollisionRiskPanel risk={selectedSat.collisionRisk} />
                                            <DecisionPanel 
                                                satelliteId={selectedSatId} 
                                                decision={selectedSat.decision} 
                                                autoMode={selectedSat.autoMode} 
                                            />
                                        </div>
                                    )}

                                    <ManeuverPanel 
                                        satelliteId={selectedSatId} 
                                        fuel={selectedSat.fuel} 
                                        onManeuverComplete={(res) => {
                                            if (res.transfer_trajectory) setTransferTrajectory(res.transfer_trajectory);
                                        }}
                                    />
                                </motion.div>

                                {/* 2D View */}
                                <motion.div 
                                    className="col-span-12 lg:col-span-8 row-span-3"
                                    initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                                >
                                    <OrbitView 
                                        satelliteId={selectedSatId} 
                                        telemetry={selectedSat} 
                                        transferTrajectory={transferTrajectory}
                                    />
                                </motion.div>

                                {/* Alert Ribbon */}
                                {isAlert && (
                                    <motion.div 
                                        className="col-span-12 bg-red-900/10 border border-red-500/20 rounded-xl p-3 flex items-center justify-between"
                                        initial={{ height: 0 }} animate={{ height: 'auto' }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <ShieldAlert className="w-4 h-4 text-red-500" />
                                            <span className="text-[10px] text-red-200 font-bold uppercase tracking-widest">Low Propellant Alert: Reserves below 5.0kg mark.</span>
                                        </div>
                                    </motion.div>
                                )}

                                {/* Graphs & Stability */}
                                <motion.div 
                                    className="col-span-12 lg:col-span-4 row-span-3"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
                                >
                                    <EnergyGraph history={simulationMetrics.energyHistory} />
                                </motion.div>

                                <motion.div 
                                    className="col-span-12 lg:col-span-4 row-span-3"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                                >
                                    <GraphPanel 
                                        title="Velocity Magnitude (km/s)" 
                                        data={selectedSat.history} 
                                        dataKey="velocity_mag" 
                                        color="#1e90ff" 
                                        type="line" 
                                    />
                                </motion.div>

                                <motion.div 
                                    className="col-span-12 lg:col-span-4 row-span-3"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                                >
                                    <PerformanceDashboard />
                                </motion.div>

                                <motion.div 
                                    className="col-span-12 lg:col-span-4 row-span-3"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                                >
                                    <GroundStationMap 
                                        satelliteId={selectedSatId} 
                                        visibleStations={selectedSat.visibleStations} 
                                    />
                                </motion.div>

                                {/* Fleet Intelligence & Operation History */}
                                <motion.div 
                                    className="col-span-12 lg:col-span-6 row-span-4"
                                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                                >
                                    <FleetHeatmap />
                                </motion.div>

                                <motion.div 
                                    className="col-span-12 lg:col-span-6 row-span-4"
                                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
                                >
                                    <ManeuverHistory />
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                </div>
            </main>

            {/* Global Alerts Portal */}
            <Alerts alerts={alerts} />

            {/* Bottom Bar */}
            <footer className="h-10 fixed bottom-0 w-full border-t border-white/10 bg-black/80 backdrop-blur-md px-6 flex items-center justify-between text-[10px] font-bold text-gray-700 tracking-[0.2em] uppercase">
                <div className="flex gap-10">
                    <div className="flex gap-2"><span>Radio:</span> <span className="text-gray-400">Stable</span></div>
                    <div className="flex gap-2"><span>Latency:</span> <span className="text-gray-400">{(simulationMetrics.performance?.compute_time_ms || 0).toFixed(1)}ms</span></div>
                    <div className="flex gap-2"><span>Sim Time:</span> <span className="text-accent underline decoration-dotted">{simulationMetrics.time?.utc.slice(11, 19)}</span></div>
                </div>
                <div>Proprietary System — Akashveer Sol-V</div>
            </footer>
        </div>
    );
};

export default TelemetryPage;
