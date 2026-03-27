import { create } from 'zustand';

const useTelemetryStore = create((set) => ({
    // Map of sat_id -> telemetry state
    satellites: {},
    selectedSatId: null,
    connectionStatus: 'disconnected',
    alerts: [],
    
    // Global simulation metrics (for OrbitPropagator)
    simulationMetrics: {
        energy: 0,
        energy_error: 0,
        dt: 1.0,
        stability: 'stable',
        energyHistory: [], // last 100 points
        fleetDecisions: {}, // sat_id -> decision object
        visibility: {},      // sat_id -> list of visible stations
        time: { utc: new Date().toISOString(), speed: 1.0, is_paused: false },
        performance: { objects_tracked: 0, compute_time_ms: 0 }
    },

    fleetHeatmap: [],
    maneuverGantt: { events: [], scheduled: [] },

    fetchFleetHeatmap: async () => {
        try {
            const resp = await fetch('/api/heatmap');
            const data = await resp.json();
            set({ fleetHeatmap: data });
        } catch (e) { console.error("Heatmap Fetch Error:", e); }
    },

    fetchManeuverGantt: async () => {
        try {
            const resp = await fetch('/api/gantt');
            const data = await resp.json();
            set({ maneuverGantt: data });
        } catch (e) { console.error("Gantt Fetch Error:", e); }
    },

    startHighFreqSim: async () => {
        try {
            const resp = await fetch('/api/simulation/start-telemetry', { method: 'POST' });
            return await resp.json();
        } catch (e) { console.error("Sim Trigger Error:", e); }
    },

    updateSimulationMetrics: (metrics) => set((state) => {
        const newHistory = [...state.simulationMetrics.energyHistory, {
            time: Date.now(),
            energy: metrics.energy || 0,
            error: metrics.energy_error || 0
        }].slice(-100);

        return {
            simulationMetrics: {
                ...state.simulationMetrics,
                ...metrics,
                energyHistory: newHistory,
                fleetDecisions: metrics.decisions || state.simulationMetrics.fleetDecisions,
                visibility: metrics.visibility || state.simulationMetrics.visibility
            }
        };
    }),

    setSimClock: async (params) => {
        try {
            const resp = await fetch('/api/time/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const data = await resp.json();
            set(state => ({
                simulationMetrics: { ...state.simulationMetrics, time: data }
            }));
        } catch (e) { console.error("SimClock Error:", e); }
    },

    toggleAutoMode: async (satId, currentMode) => {
        try {
            const resp = await fetch('/api/decision/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ satellite_id: satId, auto_mode: !currentMode })
            });
            const data = await resp.json();
            // Backend update handled in state via simulation stream
            return data;
        } catch (e) {
            console.error('Failed to toggle auto-mode:', e);
        }
    },

    addAlert: (alert) => set((state) => ({ 
        alerts: [alert, ...state.alerts].slice(0, 5) 
    })),
    
    removeAlert: (id) => set((state) => ({ 
        alerts: state.alerts.filter(a => a.id !== id) 
    })),

    updateTelemetry: (data) => {
        set((state) => {
            const satId = data.satellite_id;
            const decision = state.simulationMetrics.fleetDecisions[satId] || {};
            const threat = decision.threat || {};
            const visibleStations = state.simulationMetrics.visibility[satId] || [];

            const existing = state.satellites[satId] || {
                history: [],
                position: [0, 0, 0],
                velocity: [0, 0, 0],
                fuel: 0,
                timestamp: 0,
                autoMode: false
            };

            // Update history and cap at 100 points
            const newHistory = [...existing.history, {
                timestamp: data.timestamp,
                fuel: data.fuel_kg,
                velocity_mag: Math.sqrt(data.vel[0]**2 + data.vel[1]**2 + data.vel[2]**2),
                collision_probability: threat.probability || 0
            }].slice(-100);

            return {
                satellites: {
                    ...state.satellites,
                    [satId]: {
                        ...existing,
                        position: data.pos,
                        velocity: data.vel,
                        fuel: data.fuel_kg,
                        timestamp: data.timestamp,
                        history: newHistory,
                        collisionRisk: threat,
                        decision: decision,
                        autoMode: decision.auto_executable || false,
                        visibleStations: visibleStations
                    }
                }
            };
        });

        // Trigger side-effects (alerts)
        if (data.fuel_kg < 5) {
            set((state) => {
                const alreadyAlerted = state.alerts.some(a => a.id === `fuel-${data.satellite_id}`);
                if (alreadyAlerted) return state;

                return {
                    alerts: [{
                        id: `fuel-${data.satellite_id}`,
                        type: 'error',
                        title: 'Critical Fuel Alert',
                        message: `${data.satellite_id} propellant levels are below 5kg. Maintenance required.`
                    }, ...state.alerts].slice(0, 5)
                };
            });
        }

        // Collision Alert
        const satId = data.satellite_id;
        set((state) => {
            const decision = state.simulationMetrics.fleetDecisions[satId] || {};
            const threat = decision.threat || {};
            if (threat.probability > 0.01) {
                const alreadyAlerted = state.alerts.some(a => a.id === `collision-${satId}`);
                if (alreadyAlerted) return state;

                return {
                    alerts: [{
                        id: `collision-${satId}`,
                        type: threat.risk_level === 'critical' ? 'error' : 'warning',
                        title: 'Orbital Intersection Detected',
                        message: `Risk level ${threat.risk_level.toUpperCase()}. Prob: ${(threat.probability * 100).toFixed(2)}% with ${threat.object_id}.`
                    }, ...state.alerts].slice(0, 5)
                };
            }
            return state;
        });
    },

    setSelectedSatId: (id) => set({ selectedSatId: id }),
    setConnectionStatus: (status) => set({ connectionStatus: status }),
    
    // Fallback sync for REST API bulk state
    syncFullState: (fullState) => {
        set((state) => {
            const newSats = { ...state.satellites };
            Object.values(fullState).forEach(sat => {
                const id = sat.satellite_id;
                if (!newSats[id]) {
                    newSats[id] = {
                        history: [],
                        position: sat.pos,
                        velocity: sat.vel,
                        fuel: sat.fuel_kg,
                        timestamp: sat.timestamp
                    };
                }
            });
            return { satellites: newSats };
        });
    }
}));

export default useTelemetryStore;
