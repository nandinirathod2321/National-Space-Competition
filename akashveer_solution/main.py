import os
import sys

# Ensure the project root and current dir are on sys.path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CURRENT_DIR = os.path.abspath(os.path.dirname(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from typing import Optional, List, Dict, Any
import numpy as np
import math
import csv
import json
import asyncio
import time
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from schemas import (
    TelemetryPayload, KeplerianInitRequest, HohmannRequest, 
    PlaneChangeRequest, PhasingRequest, KeplerianElements,
    DecisionRequest, ExecuteDecisionRequest,
    ClockControlRequest, CommandValidateRequest, RTNTransformRequest
)

from state_store import store
from physics_engine import rk4_step, get_eci_to_rtn_matrix, calculate_fuel_consumed
from global_map import SpaceObject, Vector3D, acm_global_map
from orbital_mechanics import (
    state_to_orbital_elements, 
    orbital_elements_to_state, 
    hohmann_transfer, 
    circular_orbit_velocity, 
    mean_anomaly_to_true_anomaly
)
from ground_track import subsatellite_point, terminator_line, predict_ground_track, historical_ground_track
from conjunction_analysis import conjunctions_for_satellite
import maneuver_engine as ME
from telemetry_manager import telemetry_manager
from orbit_propagator import propagator
from kepler_converter import converter
from decision_engine import decision_engine

# --- New v3 Imports ---
from simulation_clock import sim_clock
from ground_station_engine import gs_engine
from command_validator import validator
from rtn_transform import rtn_calc

# ── Directory Paths ──
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
REACT_TELEMETRY_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist-telemetry"))

# Global registries for simulation state
object_metadata: Dict[str, Any] = {}
simulation_telemetry: Dict[str, Any] = {}
simulation_metrics: Dict[str, Any] = {
    "energy": 0,
    "energy_error": 0,
    "dt": 1.0,
    "stability": "stable"
}

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        
        try:
            payload = json.dumps(message)
        except Exception as e:
            print(f"❌ BROADCAST SERIALIZATION ERROR: {e}")
            return
            
        print(f"📡 Broadcasting to {len(self.active_connections)} subscribers...")
        
        # Filter dead connections
        dead_connections = []
        tasks = []
        for connection in self.active_connections:
            try:
                tasks.append(connection.send_text(payload))
            except Exception:
                dead_connections.append(connection)
        
        if dead_connections:
            for dc in dead_connections:
                self.disconnect(dc)

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

manager = ConnectionManager()

app = FastAPI(title="Akashveer Telemetry Service")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ManeuverRequest(BaseModel):
    """Request to perform an orbital maneuver."""
    satellite_id: str
    target_altitude_km: float  # Target circular orbit altitude
    target_inclination_deg: Optional[float] = None

class ManeuverPlan(BaseModel):
    """Plan for a maneuver (returns delta-V and timing info)."""
    satellite_id: str
    current_altitude_km: float
    target_altitude_km: float
    dv_required: float
    fuel_required_kg: float
    can_execute: bool
    reason: str

# ── New maneuver models ──────────────────────────────────────────────────────
class RTNBurnRequest(BaseModel):
    satellite_id: str
    dv_r: float = 0.0   # km/s  Radial
    dv_t: float = 0.0   # km/s  Transverse (prograde/retrograde)
    dv_n: float = 0.0   # km/s  Normal (plane change)
    bypass_los: bool = False
    bypass_cooldown: bool = False

class ECIBurnRequest(BaseModel):
    satellite_id: str
    dv_x: float = 0.0
    dv_y: float = 0.0
    dv_z: float = 0.0
    bypass_los: bool = False
    bypass_cooldown: bool = False

class ScheduleRequest(BaseModel):
    satellite_id: str
    burn_time_s: float          # simulation time offset for burn
    dv_r: float = 0.0
    dv_t: float = 0.0
    dv_n: float = 0.0

class OrbitRecommendRequest(BaseModel):
    satellite_id: str
    candidate_altitudes_km: Optional[List[float]] = None

class COLARequest(BaseModel):
    satellite_id: str
    dv_budget_kms: float = 0.05
    bypass_cooldown: bool = False

class TelemetryInbound(BaseModel):
    satellite_id: str
    timestamp: float
    position: List[float] # [x, y, z] km
    velocity: List[float] # [vx, vy, vz] km/s
    fuel: float          # kg


@app.get("/")
async def root():
    """Serve the main dashboard HTML."""
    frontend_index = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(frontend_index):
        return FileResponse(frontend_index)
    # Fallback API response if HTML not found
    return {"status": "online", "service": "Akashveer"}


# ── New React Telemetry Routes ───────────────────────────────────────────
@app.get("/telemetry", response_class=FileResponse)
async def serve_telemetry_index():
    index_path = os.path.join(REACT_TELEMETRY_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html")) # Fallback if not built

# Mount React static files
if os.path.exists(REACT_TELEMETRY_DIR):
    app.mount("/telemetry/assets", StaticFiles(directory=os.path.join(REACT_TELEMETRY_DIR, "assets")), name="telemetry-assets")

@app.post("/api/telemetry")
async def ingest_telemetry_batch(payload: TelemetryPayload):
    """
    Ingest a batch of telemetry objects (Legacy/Simulation format).
    Updates simulation state and broadcasts to all subscribers.
    """
    for obj in payload.objects:
        metadata = object_metadata.get(obj.id, {})
        # Update simulation store
        store.update_object(
            obj.id,
            [obj.r.x, obj.r.y, obj.r.z],
            [obj.v.x, obj.v.y, obj.v.z],
            payload.timestamp,
            obj.type,
            metadata
        )
        
        # Track for global map
        if obj.type == "SATELLITE":
            telemetry_manager.ingest({
                "satellite_id": obj.id,
                "timestamp": payload.timestamp.timestamp(),
                "position": [obj.r.x, obj.r.y, obj.r.z],
                "velocity": [obj.v.x, obj.v.y, obj.v.z],
                "fuel": 50.0 # Default starting fuel
            })

    # Broadcast update
    await manager.broadcast({
        "type": "TELEMETRY_BATCH",
        "data": [o.dict() for o in payload.objects],
        "timestamp": payload.timestamp.isoformat()
    })
    return {"status": "ACK", "count": len(payload.objects)}

@app.post("/api/telemetry/v1")
async def ingest_telemetry_single(data: TelemetryInbound):
    """Ingest high-frequency telemetry for a single object (FastAPI/React format)."""
    payload = data.dict()
    is_valid, msg = telemetry_manager.validate(payload)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Validation failed: {msg}")
    
    state = telemetry_manager.ingest(payload)
    
    # Mirror into simulation state store
    store.update_object(
        state["satellite_id"],
        state["pos"],
        state["vel"],
        datetime.fromtimestamp(state["timestamp"]),
        "SATELLITE",
        object_metadata.get(state["satellite_id"], {})
    )
    
    if state["satellite_id"] in store.objects:
        store.objects[state["satellite_id"]]["fuel_kg"] = state["fuel_kg"]

    await manager.broadcast({"type": "TELEMETRY_UPDATE", "data": state})
    return {"status": "ACK"}
    
@app.get("/api/states")
async def get_all_states():
    """Returns all tracked objects for the simulation (used by both 3D and Telemetry dashboards)."""
    result = []
    for obj_id, data in store.objects.items():
        result.append({
            "id": obj_id,
            "type": data.get("type", "DEBRIS"),
            "pos": data["pos"].tolist() if hasattr(data["pos"], 'tolist') else data["pos"],
            "vel": data["vel"].tolist() if hasattr(data["vel"], 'tolist') else data["vel"],
            "fuel_kg": float(data.get("fuel_kg", 0)),
            "mass_kg": float(data.get("mass_kg", 0)),
            "timestamp": str(data.get("timestamp", "")),
            "metadata": object_metadata.get(obj_id, {})
        })
    return {"objects": result, "count": len(result)}

@app.get("/api/objects")
async def get_objects_alias():
    return await get_all_states()


@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    """Real-time streaming pipe for satellite fleet status."""
    await manager.connect(websocket)
    try:
        # Send initial state snapshot
        await websocket.send_json({
            "type": "INIT_SNAPSHOT",
            "data": telemetry_manager.get_latest_state()
        })
        
        while True:
            # Keep connection open, wait for any incoming messages from client (optional)
            data = await websocket.receive_text()
            # Handle heartbeats or commands if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WS Error: {e}")
        manager.disconnect(websocket)


def autonomous_cola(sat_id):
    """Checks for critical threats and performs a burn if necessary."""
    if sat_id not in store.objects:
        return False

    sat = store.objects[sat_id]
    current_pos = sat["pos"]
    current_vel = sat["vel"]

    # 1. Check for critical threats (< 100 meters / 0.1 km)
    is_critical = False
    current_key = store._get_grid_key(current_pos)

    # Search neighbors for anything within 100 meters
    for dx in [-1, 0, 1]:
        for dy in [-1, 0, 1]:
            for dz in [-1, 0, 1]:
                neighbor_key = (current_key[0] + dx, current_key[1] + dy, current_key[2] + dz)
                for other_id in store.grid.get(neighbor_key, []):
                    if other_id == sat_id:
                        continue

                    dist = np.linalg.norm(current_pos - store.objects[other_id]["pos"])
                    if dist < 0.1:  # 100 meter threshold
                        is_critical = True
                        break
                if is_critical:
                    break
            if is_critical:
                break

    # 2. Perform Avoidance if critical
    if is_critical and sat.get("fuel_kg", 0) > 0:
        # Plan a 5 m/s Transverse burn (Efficient avoidance)
        dv_rtn = np.array([0, 0.005, 0])  # 5 m/s = 0.005 km/s

        rot_matrix = get_eci_to_rtn_matrix(current_pos, current_vel)
        dv_eci = rot_matrix @ dv_rtn

        # Apply Burn
        sat["vel"] = current_vel + dv_eci
        fuel_used = calculate_fuel_consumed(sat.get("mass_kg", 0), 5.0)
        sat["fuel_kg"] = max(0.0, sat.get("fuel_kg", 0) - fuel_used)
        sat["mass_kg"] = max(0.0, sat.get("mass_kg", 0) - fuel_used)

        print(f"🚀 AUTO-COLA: Sat {sat_id} performed evasion! Fuel left: {sat['fuel_kg']:.2f}kg")
        return True

    return False





@app.post("/api/tick")
async def simulation_tick(dt: float = 1.0):
    """Refined simulation tick using high-accuracy propagator + autonomous logic."""
    start_time = time.time()
    states = store.objects
    count = 0
    total_error = 0.0
    total_energy = 0.0
    
    # AI Logic and Decisions
    fleet_decisions = {}
    
    for obj_id, data in states.items():
        # 1. High-Accuracy Propagate
        result = propagator.propagate(obj_id, data["pos"], data["vel"], dt)
        
        # 2. Collision & Decision Analysis (Satellites only)
        if data["type"] == "SATELLITE":
            decision = decision_engine.evaluate_threat(obj_id, result["pos"], result["vel"], states)
            fleet_decisions[obj_id] = decision
            
            # 3. Autonomous Execution
            if decision["decision"] == "maneuver" and decision.get("auto_executable"):
                dv_rtn = decision["suggested_dv_rtn_kms"]
                res = ME.apply_rtn_burn(
                    data, dv_rtn[0], dv_rtn[1], dv_rtn[2],
                    check_los=False, check_cooldown=True, sat_id=obj_id
                )
                if res["status"] == "EXECUTED":
                    # Update state again with new velocity
                    result["vel"] = np.array(data["vel"])
                    decision["executed"] = True
                    decision["burn_details"] = res

        # 4. Update store with new state
        store.update_object(
            obj_id, 
            result["pos"], 
            result["vel"], 
            data["timestamp"], 
            data["type"],
            object_metadata.get(obj_id, {})
        )
        
        # Preserve mass/fuel from internal state
        if data["type"] == "SATELLITE":
            store.objects[obj_id]["fuel_kg"] = data.get("fuel_kg", 100.0)
            store.objects[obj_id]["mass_kg"] = data.get("mass_kg", 500.0)
        
        total_error += result["energy_error"]
        total_energy += result["energy"]
        count += 1
    
    if count > 0:
        simulation_metrics.update({
            "energy": total_energy / count,
            "energy_error": total_error / count,
            "dt": propagator.current_dt,
            "stability": propagator.stability,
            "decisions": fleet_decisions
        })

    # Broadcast extended telemetry via WebSocket
    # 6. Global Systems (Clock + GS)
    sim_time = sim_clock.tick(1.0) # Tick 1s real time
    visibility = gs_engine.get_fleet_visibility(store.objects, sim_clock.elapsed_sim_seconds)
    
    # Update metrics with new subsystems
    simulation_metrics.update({
        "time": sim_clock.get_state(),
        "visible_stations_count": sum(len(v) for v in visibility.values()),
        "performance": {
            "objects_tracked": count,
            "compute_time_ms": round((time.time() - start_time) * 1000, 2)
        }
    })

    await manager.broadcast({
        "type": "SIMULATION_UPDATE",
        "metrics": simulation_metrics,
        "object_count": count,
        "decisions": fleet_decisions,
        "visibility": visibility
    })

    return {"status": "OK", "metrics": simulation_metrics}

@app.get("/api/simulation/metrics")
async def get_simulation_metrics():
    """Returns numerical stability and energy conservation metrics."""
    return simulation_metrics


# Removed duplicate get_all_states endpoint (already defined above)


@app.post("/api/reload-data")
async def reload_data():
    """Reload demo and CSV data"""
    await seed_demo_data()
    load_ground_station_data()
    return {"status": "reloaded"}


@app.get("/api/status")
async def get_status():
    """Dashboard status summary."""
    objects = store.objects
    sats = [o for o in objects.values() if o.get("type") == "SATELLITE"]
    debris = [o for o in objects.values() if o.get("type") == "DEBRIS"]
    total_fuel = sum(o.get("fuel_kg", 0) for o in sats)
    
    # Global collision warning check
    critical_warnings = 0
    if len(sats) > 0 and len(debris) > 0:
        for sat in sats:
            for d in debris:
                # Fast distance check
                dist = np.linalg.norm(sat["pos"] - d["pos"])
                if dist < 100.0:  # Critical < 100km
                    critical_warnings += 1
                    
    return {
        "total_objects": len(objects),
        "satellites": len(sats),
        "debris": len(debris),
        "total_fuel_kg": round(total_fuel, 2),
        "critical_warnings": critical_warnings,
    }


    return {"status": "reloaded"}


@app.get("/api/orbits")
async def get_orbital_elements():
    """Returns orbital elements for all satellites (for visualization)."""
    orbits = []
    for obj_id, data in store.objects.items():
        if data.get("type") == "SATELLITE":
            try:
                elements = state_to_orbital_elements(data["pos"], data["vel"])
                orbits.append({
                    "id": obj_id,
                    "elements": elements.to_dict(),
                    "position": data["pos"].tolist(),
                    "velocity": data["vel"].tolist(),
                    "fuel_kg": data.get("fuel_kg", 0),
                    "mass_kg": data.get("mass_kg", 0),
                })
            except Exception as e:
                print(f"Error calculating orbital elements for {obj_id}: {e}")
    return {"orbits": orbits, "count": len(orbits)}


@app.post("/api/maneuver/plan")
async def plan_maneuver(request: ManeuverRequest):
    """Plans an orbital maneuver and returns delta-V requirements."""
    sat_id = request.satellite_id
    
    if sat_id not in store.objects:
        raise HTTPException(status_code=404, detail=f"Satellite {sat_id} not found")
    
    sat = store.objects[sat_id]
    if sat.get("type") != "SATELLITE":
        raise HTTPException(status_code=400, detail=f"Object {sat_id} is not a satellite")
    
    try:
        # Get current orbital elements
        current_pos = sat["pos"]
        current_vel = sat["vel"]
        current_elements = state_to_orbital_elements(current_pos, current_vel)
        current_altitude = current_elements.a * (1 - current_elements.e) - 6378.137
        
        # Calculate Hohmann transfer delta-V
        transfer = hohmann_transfer(current_pos, current_vel, request.target_altitude_km)
        
        if not transfer:
            return {
                "satellite_id": sat_id,
                "can_execute": False,
                "reason": "Cannot transfer to lower orbit with Hohmann (already in lower orbit)",
                "dv_required": 0,
                "fuel_required_kg": 0,
            }
        
        dv_required = transfer["dv_total"]
        
        # Calculate fuel required using Tsiolkovsky equation
        isp = 300.0  # seconds
        g0 = 9.80665 / 1000  # convert to km/s^2
        m_initial = sat.get("mass_kg", 550)
        
        # From Tsiolkovsky: dv = isp * g0 * ln(m_initial / m_final)
        # Solving for fuel: fuel = m_initial * (1 - e^(-dv / (isp * g0)))
        exp_term = math.exp(-dv_required / (isp * g0))
        m_final = m_initial * exp_term
        fuel_required = m_initial - m_final
        
        current_fuel = sat.get("fuel_kg", 0)
        can_execute = current_fuel >= fuel_required
        
        return {
            "satellite_id": sat_id,
            "current_altitude_km": float(current_altitude),
            "target_altitude_km": request.target_altitude_km,
            "dv_required": float(dv_required),
            "fuel_required_kg": float(fuel_required),
            "current_fuel_kg": float(current_fuel),
            "can_execute": can_execute,
            "reason": "Ready to execute" if can_execute else f"Insufficient fuel: have {current_fuel:.2f}kg, need {fuel_required:.2f}kg",
            "transfer_time_seconds": float(transfer.get("transfer_time", 0)),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error planning maneuver: {str(e)}")


@app.post("/api/maneuver/execute")
async def execute_maneuver(request: ManeuverRequest):
    """Executes an orbital maneuver (Hohmann transfer)."""
    sat_id = request.satellite_id
    
    if sat_id not in store.objects:
        raise HTTPException(status_code=404, detail=f"Satellite {sat_id} not found")
    
    sat = store.objects[sat_id]
    if sat.get("type") != "SATELLITE":
        raise HTTPException(status_code=400, detail=f"Object {sat_id} is not a satellite")
    
    try:
        current_pos = sat["pos"].copy()
        current_vel = sat["vel"].copy()
        
        # Get transfer info
        transfer = hohmann_transfer(current_pos, current_vel, request.target_altitude_km)
        if not transfer:
            return {"status": "FAILED", "reason": "Cannot transfer to lower orbit"}
        
        # Get current elements
        current_elements = state_to_orbital_elements(current_pos, current_vel)
        
        # Calculate new velocity after first burn (in direction of velocity)
        v_mag = np.linalg.norm(current_vel)
        dv1 = transfer["dv1"]
        
        # Apply delta-V in the direction of motion
        dv_vector = (current_vel / v_mag) * dv1
        new_vel = current_vel + dv_vector
        
        # Update satellite state
        sat["vel"] = new_vel
        
        # Calculate fuel consumed
        isp = 300.0
        g0 = 9.80665 / 1000
        m_initial = sat.get("mass_kg", 550)
        fuel_burned = m_initial * (1 - math.exp(-dv1 / (isp * g0)))
        
        sat["fuel_kg"] = max(0, sat.get("fuel_kg", 0) - fuel_burned)
        sat["mass_kg"] = max(0, sat.get("mass_kg", 0) - fuel_burned)
        
        # Log the maneuver
        print(f"🚀 MANEUVER EXECUTED: {sat_id}")
        print(f"   ΔV: {dv1:.3f} km/s")
        print(f"   Fuel burned: {fuel_burned:.2f} kg")
        print(f"   Remaining fuel: {sat['fuel_kg']:.2f} kg")
        
        return {
            "status": "EXECUTED",
            "satellite_id": sat_id,
            "dv_applied": float(dv1),
            "fuel_burned_kg": float(fuel_burned),
            "remaining_fuel_kg": float(sat["fuel_kg"]),
            "new_velocity": new_vel.tolist(),
            "transfer_time_seconds": float(transfer.get("transfer_time", 0)),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error executing maneuver: {str(e)}")


# ========== GROUND TRACK & VISUALIZATION ENDPOINTS ==========

@app.get("/api/ground-track")
async def get_ground_track_data():
    """Returns ground track map data for all satellites (Mercator projection)."""
    features = []
    
    for sat_id, data in store.objects.items():
        if data.get("type") != "SATELLITE":
            continue
        
        try:
            # Current sub-satellite point
            current_track = subsatellite_point(data["pos"])
            
            # Predicted track (next 90 minutes)
            predicted = predict_ground_track(data["pos"], data["vel"], duration_seconds=5400)
            
            # Historical track (last 90 minutes)
            historical = historical_ground_track(data)
            
            features.append({
                "satellite_id": sat_id,
                "current_position": current_track,
                "predicted_track": predicted,
                "historical_track": historical,
                "fuel_kg": data.get("fuel_kg", 0),
                "altitude_km": current_track["altitude"]
            })
        except Exception as e:
            print(f"Error computing ground track for {sat_id}: {e}")
    
    # Terminator line (day/night boundary)
    if store.objects:
        first_ts = str(next(iter(store.objects.values())).get("timestamp", ""))
        terminator = terminator_line(first_ts)
    else:
        terminator = []

    return {
        "satellites": features,
        "terminator_line": terminator,
        "timestamp": first_ts if store.objects else ""
    }


@app.get("/api/conjunctions/{sat_id}")
async def get_conjunctions(sat_id: str):
    """Returns nearby debris for a satellite (Bullseye polar chart data)."""
    
    if sat_id not in store.objects:
        raise HTTPException(status_code=404, detail=f"Satellite {sat_id} not found")
    
    sat_data = store.objects[sat_id]
    if sat_data.get("type") != "SATELLITE":
        raise HTTPException(status_code=400, detail=f"Object {sat_id} is not a satellite")
    
    try:
        # Get all debris and other satellites
        all_objects = {k: v for k, v in store.objects.items() if k != sat_id}
        
        conjunctions = conjunctions_for_satellite(sat_id, sat_data, all_objects)
        
        return {
            "satellite_id": sat_id,
            "conjunctions": conjunctions[:20],  # Top 20 closest approaches
            "total_nearby": len(conjunctions),
            "critical_count": len([c for c in conjunctions if c["risk_level"] == "red"]),
            "warning_count": len([c for c in conjunctions if c["risk_level"] == "yellow"])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing conjunctions: {str(e)}")


@app.get("/api/telemetry-heatmap")
async def get_telemetry_heatmap():
    """Returns fleet-wide telemetry for heatmap visualization."""
    satellites = []
    
    for sat_id, data in store.objects.items():
        if data.get("type") != "SATELLITE":
            continue
        
        try:
            fuel_percent = (data.get("fuel_kg", 0) / 50.0) * 100  # Assume 50kg capacity
            
            # Calculate delta-V efficiency (mocked for now)
            dv_budget = 2.5  # km/s budgeted
            fuel_used = 50 - data.get("fuel_kg", 0)
            isp = 300.0
            g0 = 9.80665 / 1000
            dv_spent = isp * g0 * math.log((1 + fuel_used/0.5) / 1)  # Approximation
            
            satellites.append({
                "satellite_id": sat_id,
                "fuel_kg": float(data.get("fuel_kg", 0)),
                "fuel_percent": min(100, float(fuel_percent)),
                "mass_kg": float(data.get("mass_kg", 0)),
                "altitude_km": float(np.linalg.norm(data["pos"]) - 6378.137),
                "dv_spent_kmps": float(dv_spent),
                "dv_budget_kmps": 2.5,
                "collisions_avoided": 0  # Would be tracked in real system
            })
        except Exception as e:
            print(f"Error computing telemetry for {sat_id}: {e}")
    
    return {
        "satellites": satellites,
        "fleet_fuel_total_kg": float(sum(s["fuel_kg"] for s in satellites)),
        "fleet_health_percent": float(np.mean([s["fuel_percent"] for s in satellites]) if satellites else 0)
    }


@app.get("/api/maneuver-timeline")
async def get_maneuver_timeline():
    """Returns past and future maneuver schedule (Gantt chart data)."""
    # Mock timeline - in real system would query maneuver history database
    timeline = [
        {
            "event_id": "burn-001",
            "satellite_id": "SAT-001",
            "event_type": "BURN_START",
            "timestamp": "2026-03-20T12:00:00Z",
            "duration_seconds": 30,
            "dv_ms": 1500
        },
        {
            "event_id": "burn-001-end",
            "satellite_id": "SAT-001",
            "event_type": "BURN_END",
            "timestamp": "2026-03-20T12:00:30Z",
            "duration_seconds": 0
        },
        {
            "event_id": "cooldown-001",
            "satellite_id": "SAT-001",
            "event_type": "COOLDOWN",
            "timestamp": "2026-03-20T12:00:30Z",
            "duration_seconds": 600
        }
    ]
    
    return {
        "maneuvers": timeline,
        "upcoming_count": len([m for m in timeline if m["timestamp"] > "2026-03-20T00:00:00Z"]),
        "conflicts": []  # Flag any overlaps
    }


@app.post("/api/seed-demo")
async def seed_demo_data():
    """Hints the dashboard with temporary objects for quick local demo."""
    import datetime
    import random

    now = datetime.datetime.utcnow().isoformat() + "Z"
    demo_objects = []
    
    # 5 Satellites in diverse circular LEO
    for i in range(5):
        r = 6378.137 + 400.0 + (i * 50)  # slightly different altitudes
        v = circular_orbit_velocity(r)
        
        # Give diverse positions around the globe
        angle = (i * math.pi / 2.5)
        inclination = (i * math.pi / 6)  # diverse inclinations
        
        pos = [
            r * math.cos(angle) * math.cos(inclination),
            r * math.sin(angle) * math.cos(inclination),
            r * math.sin(inclination) # Latitude variation
        ]
        
        # Velocity in perpendicular direction
        vel = [
            -v * math.sin(angle),
            v * math.cos(angle),
            v * math.sin(inclination) * 0.5
        ]
        
        demo_objects.append({
            "id": f"SAT-{(i+1):03d}",
            "type": "SATELLITE",
            "pos": pos,
            "vel": vel,
            "fuel_kg": 50.0 - (i*5),
            "mass_kg": 500.0,
            "timestamp": now
        })
        
    # 15 Debris objects scattered
    for i in range(15):
        r = 6378.137 + 350.0 + random.uniform(0, 300)
        v = circular_orbit_velocity(r)
        angle = random.uniform(0, 2*math.pi)
        inc = random.uniform(-math.pi/2, math.pi/2)
        
        pos = [
            r * math.cos(angle) * math.cos(inc),
            r * math.sin(angle) * math.cos(inc),
            r * math.sin(inc)
        ]
        vel = [
            -v * math.sin(angle) + random.uniform(-0.5, 0.5),
            v * math.cos(angle) + random.uniform(-0.5, 0.5),
            v * math.sin(inc) * random.uniform(0.1, 1.0)
        ]
        
        demo_objects.append({
            "id": f"DEBRIS-{(i+1):03d}",
            "type": "DEBRIS",
            "pos": pos,
            "vel": vel,
            "timestamp": now
        })

    for obj in demo_objects:
        store.update_object(obj["id"], obj["pos"], obj["vel"], obj["timestamp"], obj["type"])
        if "fuel_kg" in obj:
            store.objects[obj["id"]]["fuel_kg"] = obj["fuel_kg"]
            store.objects[obj["id"]]["mass_kg"] = obj["mass_kg"]

    return {"status": "demo seeded", "objects": len(demo_objects)}


@app.on_event("startup")
async def startup_seed_demo():
    # Preload the store so the dashboard renders immediately.
    await seed_demo_data()
    # Load ground station data
    load_ground_station_data()


def load_ground_station_data():
    """Load satellite and debris data from ground_station.csv"""
    print("Starting load_ground_station_data")
    # Check root first, then current dir
    root_csv = os.path.join(BASE_DIR, "ground_station.csv")
    curr_csv = os.path.join(CURRENT_DIR, "ground_station.csv")
    
    csv_path = root_csv if os.path.exists(root_csv) else curr_csv
    
    if not os.path.exists(csv_path):
        print(f"❌ ground_station.csv not found at {root_csv} or {curr_csv}, skipping load")
        return
    
    objects = []
    successful = 0
    failed = 0
    debris_count = 0
    sat_count = 0
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row_num, row in enumerate(reader, 1):
            try:
                # Parse orbital elements
                semimajor = row['SEMIMAJOR_AXIS'].strip()
                ecc = row['ECCENTRICITY'].strip()
                inc = row['INCLINATION'].strip()
                raan = row['RA_OF_ASC_NODE'].strip()
                arg_peri = row['ARG_OF_PERICENTER'].strip()
                mean_anom = row['MEAN_ANOMALY'].strip()
                if not semimajor or not ecc or not inc or not raan or not arg_peri or not mean_anom:
                    failed += 1
                    continue
                
                # Check for DEBRIS or PAYLOAD in row
                row_type = row.get('OBJECT_TYPE', 'DEBRIS').strip().upper()
                obj_type = 'SATELLITE' if 'PAYLOAD' in row_type else 'DEBRIS'
                
                if obj_type == 'DEBRIS':
                    if debris_count >= 5000:
                        continue
                    debris_count += 1
                else:
                    if sat_count >= 150:
                        continue
                    sat_count += 1
                
                a = float(semimajor)
                e = float(ecc)
                i = math.radians(float(inc))
                raan_rad = math.radians(float(raan))
                w = math.radians(float(arg_peri))
                M = math.radians(float(mean_anom))
                
                # Convert mean anomaly to true anomaly
                v = mean_anomaly_to_true_anomaly(M, e)
                
                # Get position and velocity
                r, vel = orbital_elements_to_state(a, e, i, raan_rad, w, v)
                
                # obj_type already normalized above
                
                # Create telemetry object
                obj_id = row['OBJECT_ID'].strip() or row['NORAD_CAT_ID'].strip()
                if not obj_id:
                    failed += 1
                    continue
                
                # Store additional metadata
                metadata = {
                    "name": row.get('OBJECT_NAME', '').strip(),
                    "norad_id": row.get('NORAD_CAT_ID', '').strip(),
                    "country": row.get('COUNTRY_CODE', '').strip(),
                    "launch_date": row.get('LAUNCH_DATE', '').strip(),
                    "rcs_size": row.get('RCS_SIZE', '').strip(),
                    "classification": row.get('CLASSIFICATION_TYPE', '').strip(),
                    "period": float(row.get('PERIOD', 0)),
                    "apoapsis": float(row.get('APOAPSIS', 0)),
                    "periapsis": float(row.get('PERIAPSIS', 0))
                }
                
                obj = {
                    "id": obj_id,
                    "type": obj_type,
                    "r": {"x": r[0], "y": r[1], "z": r[2]},
                    "v": {"x": vel[0], "y": vel[1], "z": vel[2]}
                }
                objects.append(obj)
                successful += 1
                
                # Store metadata for later use
                object_metadata[obj_id] = metadata
                    
            except (ValueError, KeyError) as ex:
                failed += 1
                if failed <= 5:  # Only print first 5 errors
                    print(f"Error parsing row {row_num} for {row.get('OBJECT_NAME', 'unknown')}: {ex}")
                continue
    
    print(f"CSV processing complete: {successful} successful, {failed} failed")
    
    if objects:
        # Create payload
        payload = TelemetryPayload(
            timestamp=datetime.now(),
            objects=objects
        )
        
        # Ingest the data
        for obj in payload.objects:
            metadata = object_metadata.get(obj.id, {})
            store.update_object(
                obj.id,
                [obj.r.x, obj.r.y, obj.r.z],
                [obj.v.x, obj.v.y, obj.v.z],
                payload.timestamp,
                obj.type,
                metadata
            )
        
        # Update global map
        global_objs = []
        for obj in payload.objects:
            fuel = store.objects.get(obj.id, {}).get("fuel_kg", 50.0) if obj.type == "SATELLITE" else 0.0
            global_objs.append(
                SpaceObject(
                    id=obj.id,
                    type=obj.type,
                    r=Vector3D(x=obj.r.x, y=obj.r.y, z=obj.r.z),
                    v=Vector3D(x=obj.v.x, y=obj.v.y, z=obj.v.z),
                    fuel_kg=fuel,
                )
            )
        acm_global_map.update_from_telemetry(payload.timestamp, global_objs)
        
        print(f"Loaded {len(objects)} objects from ground_station.csv")


# =========================================================================
# NEW MANEUVER ENGINE ENDPOINTS
# =========================================================================

def _get_sat(sat_id: str) -> dict:
    """Helper: fetch satellite from store or raise 404."""
    if sat_id not in store.objects:
        raise HTTPException(404, f"Satellite '{sat_id}' not found")
    sat = store.objects[sat_id]
    if sat.get("type") != "SATELLITE":
        raise HTTPException(400, f"Object '{sat_id}' is not a satellite")
    return sat


@app.post("/api/v2/maneuver/rtn")
async def maneuver_rtn(req: RTNBurnRequest):
    """Apply an impulsive burn in RTN (Radial-Transverse-Normal) frame."""
    sat = _get_sat(req.satellite_id)
    # Keep numpy arrays in sync with maneuver engine
    ME.spatial_grid.update(req.satellite_id, sat["pos"], sat["vel"], "SATELLITE")
    result = ME.apply_rtn_burn(
        sat, req.dv_r, req.dv_t, req.dv_n,
        check_los=not req.bypass_los,
        check_cooldown=not req.bypass_cooldown,
        sat_id=req.satellite_id,
    )
    if result["status"] == "EXECUTED":
        store.update_object(req.satellite_id, sat["pos"], sat["vel"],
                            store.objects[req.satellite_id]["timestamp"], "SATELLITE")
        store.objects[req.satellite_id]["fuel_kg"] = sat["fuel_kg"]
        store.objects[req.satellite_id]["mass_kg"] = sat["mass_kg"]
        # Log to maneuver history
        ME.schedule_store.history.append({
            "satellite_id": req.satellite_id,
            "frame": "RTN",
            "dv_rtn": [req.dv_r, req.dv_t, req.dv_n],
            "dv_mag_kms": result["dv_mag_kms"],
            "fuel_burned_kg": result["fuel_burned_kg"],
            "fuel_remaining_kg": result["fuel_remaining_kg"],
            "sim_time_s": ME.schedule_store.sim_time,
        })
    return result


@app.post("/api/v2/maneuver/eci")
async def maneuver_eci(req: ECIBurnRequest):
    """Apply an impulsive burn in ECI frame (km/s)."""
    sat = _get_sat(req.satellite_id)
    ME.spatial_grid.update(req.satellite_id, sat["pos"], sat["vel"], "SATELLITE")
    result = ME.apply_eci_burn(
        sat, req.dv_x, req.dv_y, req.dv_z,
        sat_id=req.satellite_id,
        check_los=not req.bypass_los,
        check_cooldown=not req.bypass_cooldown,
    )
    if result["status"] == "EXECUTED":
        store.update_object(req.satellite_id, sat["pos"], sat["vel"],
                            store.objects[req.satellite_id]["timestamp"], "SATELLITE")
        store.objects[req.satellite_id]["fuel_kg"] = sat["fuel_kg"]
        store.objects[req.satellite_id]["mass_kg"] = sat["mass_kg"]
    return result


@app.post("/api/v2/maneuver/schedule")
async def schedule_maneuver(req: ScheduleRequest):
    """Validate and queue a future maneuver burn."""
    sat = _get_sat(req.satellite_id)
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])
    fuel = sat.get("fuel_kg", 0.0)
    mass = sat.get("mass_kg", ME.DRY_MASS + fuel)

    dv_rtn = np.array([req.dv_r, req.dv_t, req.dv_n])
    dv_mag = float(np.linalg.norm(dv_rtn))

    # Validate
    cooldown_ok, cd_msg = ME.schedule_store.can_execute(req.satellite_id)
    los = ME.ground_station_los(pos)
    fuel_needed = ME.fuel_for_dv(dv_mag, mass) if dv_mag > 0 else 0.0
    fuel_ok = fuel_needed <= fuel

    entry = {
        "satellite_id": req.satellite_id,
        "burn_time_s": req.burn_time_s,
        "dv_r": req.dv_r, "dv_t": req.dv_t, "dv_n": req.dv_n,
        "dv_mag_kms": round(dv_mag, 6),
        "fuel_required_kg": round(fuel_needed, 4),
        "status": "QUEUED",
    }

    valid = cooldown_ok and fuel_ok and len(los) > 0
    if valid:
        ME.schedule_store.scheduled.append(entry)

    return {
        "valid": valid,
        "queued": valid,
        "fuel_available_kg": round(fuel, 3),
        "fuel_required_kg": round(fuel_needed, 4),
        "fuel_ok": fuel_ok,
        "cooldown_ok": cooldown_ok,
        "cooldown_msg": cd_msg,
        "los_stations": los,
        "los_ok": len(los) > 0,
        "entry": entry,
        "reason": "Maneuver queued" if valid else f"Validation failed: {'no LOS' if not los else cd_msg if not cooldown_ok else 'insufficient fuel'}",
    }


@app.get("/api/v2/satellite/{sat_id}")
async def get_satellite_full(sat_id: str):
    """Comprehensive state for a single satellite: orbit elements, fuel, station-keeping, LOS."""
    sat = _get_sat(sat_id)
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])
    fuel = sat.get("fuel_kg", 0.0)
    mass = sat.get("mass_kg", ME.DRY_MASS + fuel)

    elements = ME.state_to_elements(pos, vel)
    los = ME.ground_station_los(pos)
    slot = ME.check_station_keeping(sat_id, pos)
    cooldown_ok, cd_msg = ME.schedule_store.can_execute(sat_id)
    max_dv = ME.dv_for_fuel(fuel, mass)

    return {
        "satellite_id": sat_id,
        "position_km": pos.tolist(),
        "velocity_kms": vel.tolist(),
        "orbital_elements": elements,
        "fuel_kg": round(fuel, 3),
        "fuel_percent": round(fuel / ME.FUEL_INIT * 100, 2),
        "mass_kg": round(mass, 2),
        "max_dv_kms": round(max_dv, 5),
        "eol_warning": fuel / ME.FUEL_INIT * 100 < 5.0,
        "los_stations": los,
        "has_los": len(los) > 0,
        "cooldown_ok": cooldown_ok,
        "cooldown_msg": cd_msg,
        "station_keeping": slot,
        "metadata": store.objects[sat_id].get("metadata", {}),
    }


@app.get("/api/v2/conjunctions/{sat_id}")
async def get_conjunctions_v2(sat_id: str, hours: float = 24.0):
    """24-hour collision prediction using spatial grid + RK4 propagation."""
    sat = _get_sat(sat_id)
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])

    # Sync spatial grid
    for oid, obj in store.objects.items():
        ME.spatial_grid.update(oid, np.array(obj["pos"]), np.array(obj["vel"]), obj.get("type", "DEBRIS"))

    conjunctions = ME.predict_conjunction(sat_id, pos, vel, store.objects, hours=hours)
    return {
        "satellite_id": sat_id,
        "conjunctions": conjunctions,
        "total": len(conjunctions),
        "critical": sum(1 for c in conjunctions if c["critical"]),
        "warnings": sum(1 for c in conjunctions if c["risk"] == "yellow"),
    }


@app.post("/api/v2/cola/auto")
async def auto_cola(req: COLARequest):
    """Autonomously compute and apply collision avoidance maneuver."""
    sat = _get_sat(req.satellite_id)
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])

    # Sync spatial grid
    for oid, obj in store.objects.items():
        ME.spatial_grid.update(oid, np.array(obj["pos"]), np.array(obj["vel"]), obj.get("type", "DEBRIS"))

    # Find nearest threat
    threats = ME.predict_conjunction(req.satellite_id, pos, vel, store.objects, hours=2.0, step_s=30.0)
    if not threats:
        return {"status": "SAFE", "message": "No threats detected in 2-hour window"}

    top = threats[0]
    if top["min_distance_km"] > 5.0:
        return {"status": "SAFE", "message": f"Nearest object {top['object_id']} at {top['min_distance_km']:.2f} km — no action needed"}

    # Compute avoidance dv
    threat_obj = store.objects.get(top["object_id"])
    if not threat_obj:
        return {"status": "ERROR", "message": "Threat object not found"}

    dv_eci = ME.compute_avoidance_dv(
        pos, vel,
        np.array(threat_obj["pos"]), np.array(threat_obj["vel"]),
        req.dv_budget_kms,
    )
    R = ME.rtn_to_eci_matrix(pos, vel)
    dv_rtn = R.T @ dv_eci

    result = ME.apply_rtn_burn(
        sat, float(dv_rtn[0]), float(dv_rtn[1]), float(dv_rtn[2]),
        check_los=False,   # Autonomous COLA bypasses LOS
        check_cooldown=not req.bypass_cooldown,
        sat_id=req.satellite_id,
    )
    if result["status"] == "EXECUTED":
        store.update_object(req.satellite_id, sat["pos"], sat["vel"],
                            store.objects[req.satellite_id]["timestamp"], "SATELLITE")
        store.objects[req.satellite_id]["fuel_kg"] = sat["fuel_kg"]
        store.objects[req.satellite_id]["mass_kg"] = sat["mass_kg"]

    return {
        "status": result["status"],
        "threat": top,
        "avoidance": result,
    }


@app.post("/api/v2/orbit/recommend")
async def recommend_orbit(req: OrbitRecommendRequest):
    """Evaluate candidate orbits and return scored list (min fuel + max safety)."""
    sat = _get_sat(req.satellite_id)
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])
    fuel = sat.get("fuel_kg", 0.0)
    mass = sat.get("mass_kg", ME.DRY_MASS + fuel)

    recommendations = ME.recommend_orbits(
        req.satellite_id, pos, vel, fuel, mass,
        store.objects, req.candidate_altitudes_km
    )
    return {
        "satellite_id": req.satellite_id,
        "current_altitude_km": round(np.linalg.norm(pos) - ME.R_E, 2),
        "current_fuel_kg": round(fuel, 3),
        "recommendations": recommendations,
    }


@app.get("/api/v2/fuel/fleet")
async def fleet_fuel_status():
    """Real-time fuel budget for all satellites."""
    sats = []
    for sid, obj in store.objects.items():
        if obj.get("type") != "SATELLITE":
            continue
        fuel = obj.get("fuel_kg", 0.0)
        mass = obj.get("mass_kg", ME.DRY_MASS)
        pct  = fuel / ME.FUEL_INIT * 100
        max_dv = ME.dv_for_fuel(fuel, mass)
        sats.append({
            "satellite_id": sid,
            "fuel_kg": round(fuel, 3),
            "fuel_percent": round(pct, 2),
            "dry_mass_kg": ME.DRY_MASS,
            "total_mass_kg": round(mass, 2),
            "max_dv_kms": round(max_dv, 5),
            "eol_warning": pct < 5.0,
            "status": "EOL" if pct < 5.0 else ("LOW" if pct < 25.0 else "NOMINAL"),
        })
    sats.sort(key=lambda x: x["fuel_percent"])
    return {
        "satellites": sats,
        "total_fuel_kg": round(sum(s["fuel_kg"] for s in sats), 2),
        "fleet_avg_pct": round(sum(s["fuel_percent"] for s in sats)/max(len(sats),1), 2),
        "eol_count": sum(1 for s in sats if s["eol_warning"]),
    }


@app.get("/api/v2/station-keeping/{sat_id}")
async def station_keeping_status(sat_id: str):
    """Check station-keeping slot deviation."""
    sat = _get_sat(sat_id)
    result = ME.check_station_keeping(sat_id, np.array(sat["pos"]))
    return {"satellite_id": sat_id, **result}


@app.post("/api/v2/station-keeping/{sat_id}/set-slot")
async def set_nominal_slot(sat_id: str):
    """Register current orbit as the nominal station-keeping slot."""
    sat = _get_sat(sat_id)
    ME.schedule_store.set_nominal_slot(sat_id, np.array(sat["pos"]), np.array(sat["vel"]))
    return {"satellite_id": sat_id, "slot_set": True,
            "position_km": sat["pos"].tolist()}


@app.post("/api/v2/station-keeping/{sat_id}/recover")
async def recover_slot(sat_id: str):
    """Apply small corrective burn to return toward nominal slot."""
    sat = _get_sat(sat_id)
    if sat_id not in ME.schedule_store.slots:
        raise HTTPException(400, "No nominal slot defined for this satellite. Call /set-slot first.")
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])
    slot = ME.schedule_store.slots[sat_id]
    dv_eci = ME.station_keeping_dv(pos, vel, slot["pos"], slot["vel"])
    R = ME.rtn_to_eci_matrix(pos, vel)
    dv_rtn = R.T @ dv_eci
    result = ME.apply_rtn_burn(
        sat, float(dv_rtn[0]), float(dv_rtn[1]), float(dv_rtn[2]),
        check_los=False, check_cooldown=False, sat_id=sat_id
    )
    if result["status"] == "EXECUTED":
        store.update_object(sat_id, sat["pos"], sat["vel"],
                            store.objects[sat_id]["timestamp"], "SATELLITE")
        store.objects[sat_id]["fuel_kg"] = sat["fuel_kg"]
        store.objects[sat_id]["mass_kg"] = sat["mass_kg"]
    return result


@app.get("/api/v2/maneuver/history")
async def maneuver_history():
    """Return full maneuver history log."""
    return {
        "history": ME.schedule_store.history,
        "scheduled": ME.schedule_store.scheduled,
        "sim_time_s": ME.schedule_store.sim_time,
        "cooldowns": {
            k: {"last_burn": v, "ready_in_s": max(0, ME.COOLDOWN_S - (ME.schedule_store.sim_time - v))}
            for k, v in ME.schedule_store.cooldowns.items()
        },
    }


# =========================================================================
# ADVANCED ASTRODYNAMICS ENDPOINTS (KEPLERIAN + STRUCTURED MANEUVERS)
# =========================================================================

@app.post("/api/initialize")
async def initialize_satellite(req: KeplerianInitRequest):
    """Initialize a satellite using Keplerian elements."""
    pos, vel = converter.kepler_to_cartesian(
        req.keplerian.a, req.keplerian.e, req.keplerian.i,
        req.keplerian.raan, req.keplerian.arg_perigee, req.keplerian.true_anomaly
    )
    
    # Register in store
    store.update_object(req.id, pos.tolist(), vel.tolist(), datetime.now().timestamp(), "SATELLITE")
    store.objects[req.id]["fuel_kg"] = req.fuel
    store.objects[req.id]["mass_kg"] = req.mass
    
    return {
        "status": "INITIALIZED",
        "id": req.id,
        "cartesian": {"pos": pos.tolist(), "vel": vel.tolist()},
        "elements": converter.cartesian_to_kepler(pos, vel)
    }

@app.post("/api/maneuver/hohmann")
async def maneuver_hohmann(req: HohmannRequest):
    """Execute a Hohmann transfer to a new circular altitude."""
    sat = _get_sat(req.satellite_id)
    r_cur_vec = np.array(sat["pos"])
    r_cur = np.linalg.norm(r_cur_vec)
    r_tgt = ME.R_E + req.target_altitude_km
    
    # Compute Δv (Transverse only)
    # v1_trans, v_circ_2, v_trans_2 calculations are inside Hohmann utility
    v_circ_1 = math.sqrt(ME.MU / r_cur)
    a_trans  = (r_cur + r_tgt) / 2
    v_trans_1 = math.sqrt(ME.MU * (2/r_cur - 1/a_trans))
    dv1 = abs(v_trans_1 - v_circ_1)
    
    # Build Transfer Trajectory for Visualization
    traj = []
    p, v = r_cur_vec.copy(), np.array(sat["vel"]).copy()
    # Boost velocity to transfer elliptical
    R = ME.rtn_to_eci_matrix(p, v)
    dv1_eci = R @ np.array([0.0, dv1, 0.0])
    v += dv1_eci
    
    # Propagate half orbit (180 degrees)
    period_trans = 2 * math.pi * math.sqrt(a_trans**3 / ME.MU)
    dt_step = 60.0 # 1 minute steps
    steps = int((period_trans / 2) / dt_step)
    
    for _ in range(steps):
        p, v = ME.rk4_propagate(p, v, dt_step)
        traj.append(p.tolist())
    
    # Final circularization Δv
    v_circ_2 = math.sqrt(ME.MU / r_tgt)
    v_trans_2 = math.sqrt(ME.MU * (2/r_tgt - 1/a_trans))
    dv2 = abs(v_circ_2 - v_trans_2)
    
    # Apply BOTH burns sequentially for the final state
    result = ME.apply_rtn_burn(sat, 0.0, float(dv1 + dv2), 0.0, sat_id=req.satellite_id)
    if result["status"] == "EXECUTED":
        store.update_object(req.satellite_id, sat["pos"], sat["vel"], datetime.now().timestamp(), "SATELLITE")
        result["transfer_trajectory"] = traj  # Send points for frontend to draw
        result["dv1_kms"] = round(dv1, 6)
        result["dv2_kms"] = round(dv2, 6)
        
    return result

@app.post("/api/maneuver/plane-change")
async def maneuver_plane_change(req: PlaneChangeRequest):
    """Execute an inclination plane change at the node."""
    sat = _get_sat(req.satellite_id)
    v_mag = np.linalg.norm(sat["vel"])
    
    # Compute Δv (Normal only)
    dv_n = ME.plane_change_dv(v_mag, req.delta_inclination_deg)
    
    # Apply burn
    result = ME.apply_rtn_burn(sat, 0.0, 0.0, float(dv_n), sat_id=req.satellite_id)
    if result["status"] == "EXECUTED":
        store.update_object(req.satellite_id, sat["pos"], sat["vel"], datetime.now().timestamp(), "SATELLITE")
    
    return result

@app.post("/api/maneuver/phasing")
async def maneuver_phasing(req: PhasingRequest):
    """Execute a phasing burn to shift position in-track."""
    sat = _get_sat(req.satellite_id)
    elements = converter.cartesian_to_kepler(sat["pos"], sat["vel"])
    
    # Compute Δv (Transverse only)
    dv_t = ME.phasing_maneuver_dv(elements["a"], req.delta_altitude_km)
    
    # Apply burn
    result = ME.apply_rtn_burn(sat, 0.0, float(dv_t), 0.0, sat_id=req.satellite_id)
    if result["status"] == "EXECUTED":
        store.update_object(req.satellite_id, sat["pos"], sat["vel"], datetime.now().timestamp(), "SATELLITE")
    
    return result

@app.post("/api/maneuver/collision-avoidance")
async def maneuver_cola(req: Dict[str, str]):
    """Trigger automated collision avoidance for a specific satellite."""
    sat_id = req["satellite_id"]
    sat = _get_sat(sat_id)
    
    # Get conjunctions
    threats = ME.predict_conjunction(sat_id, np.array(sat["pos"]), np.array(sat["vel"]), store.objects)
    if not threats or not threats[0]["critical"]:
        return {"status": "SKIPPED", "reason": "No critical threats detected."}
    
    top = threats[0]
    threat_obj = store.objects[top["object_id"]]
    
    # Compute avoidance Δv
    dv_eci = ME.compute_avoidance_dv(
        np.array(sat["pos"]), np.array(sat["vel"]),
        np.array(threat_obj["pos"]), np.array(threat_obj["vel"])
    )
    
    # Apply burn
    result = ME.apply_eci_burn(sat, float(dv_eci[0]), float(dv_eci[1]), float(dv_eci[2]), sat_id=sat_id)
    if result["status"] == "EXECUTED":
        store.update_object(sat_id, sat["pos"], sat["vel"], datetime.now().timestamp(), "SATELLITE")
    
    return {"status": "EXECUTED", "burn": result, "avoided_threat": top}


# =========================================================================
# AUTONOMOUS DECISION & COLLISION API
# =========================================================================

@app.get("/api/collision/risk")
async def get_collision_risk():
    """Returns probability for all satellites."""
    risks = []
    for sid, sat in store.objects.items():
        if sat.get("type") == "SATELLITE":
            decision = decision_engine.evaluate_threat(sid, sat["pos"], sat["vel"], store.objects)
            threat = decision.get("threat", {})
            risks.append({
                "satellite_id": sid,
                "probability": threat.get("probability", 0.0),
                "risk_level": threat.get("risk_level", "safe"),
                "tca_s": threat.get("tca_s", 0.0),
                "d_min_km": threat.get("d_min_km", 0.0),
                "object_id": threat.get("object_id", "N/A"),
                "decision": decision["decision"]
            })
    return {"risks": risks}

@app.post("/api/decision/mode")
async def set_decision_mode(req: DecisionRequest):
    """Toggle Auto/Manual mode for a satellite."""
    decision_engine.set_auto_mode(req.satellite_id, req.auto_mode)
    return {"satellite_id": req.satellite_id, "auto_mode": req.auto_mode}

@app.post("/api/decision/evaluate")
async def evaluate_threat(req: Dict[str, str]):
    """Evaluate threat for a specific satellite and return recommended action."""
    sid = req["satellite_id"]
    sat = _get_sat(sid)
    return decision_engine.evaluate_threat(sid, sat["pos"], sat["vel"], store.objects)

@app.post("/api/decision/execute")
async def execute_mission_maneuver(req: ExecuteDecisionRequest):
    """Execute a manual or AI-recommended maneuver in RTN frame."""
    sat = _get_sat(req.satellite_id)
    
    # 1. Validate Command (Safety Gate)
    safety_check = validator.validate_command(req.satellite_id, req.dv_rtn, store)
    if not safety_check["go_nogo"]:
        return {"status": "REJECTED", "reason": f"Safety Violation: {safety_check['rejections'][0]}"}
        
    # 2. Transform RTN to ECI (for internal physics application)
    # ME.apply_rtn_burn already does the conversion internally
    
    # 3. Apply Burn
    res = ME.apply_rtn_burn(
        sat, 
        float(req.dv_rtn[0]), float(req.dv_rtn[1]), float(req.dv_rtn[2]), 
        sat_id=req.satellite_id
    )
    
    if res["status"] == "EXECUTED":
        # 4. Update Simulation Store
        store.update_object(
            req.satellite_id, 
            sat["pos"], sat["vel"], 
            datetime.now().timestamp(), 
            "SATELLITE"
        )
        # Preserve fuel metadata
        store.objects[req.satellite_id]["fuel_kg"] = sat["fuel_kg"]
        
    return res

# ── New v3 Advanced Routes ──────────────────────────────────────────────────

@app.get("/api/ground/visibility")
async def get_visibility():
    return gs_engine.get_fleet_visibility(store.objects, sim_clock.elapsed_sim_seconds)

@app.get("/api/ground/stations")
async def get_stations():
    return gs_engine.stations

@app.post("/api/command/validate")
async def validate_mission_command(req: CommandValidateRequest):
    return validator.validate_command(req.satellite_id, req.dv_rtn, store)

@app.get("/api/ground-track")
async def get_ground_track_data():
    """Returns ground track points, historical paths, and predicted orbits for all satellites."""
    results = []
    for sid, sat in store.objects.items():
        if sat.get("type") != "SATELLITE":
            continue
            
        pos = np.array(sat["pos"])
        vel = np.array(sat["vel"])
        
        results.append({
            "satellite_id": sid,
            "fuel_kg": float(sat.get("fuel_kg", 0)),
            "current_position": subsatellite_point(pos),
            "historical_track": historical_ground_track(sat, history_points=60, duration_seconds=5400),
            "predicted_track": predict_ground_track(pos, vel, steps=60, duration_seconds=5400)
        })
    
    return {
        "satellites": results,
        "terminator_line": terminator_line(datetime.now().isoformat()),
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/conjunctions/{sat_id}")
async def get_satellite_conjunctions(sat_id: str):
    """Returns localized conjunction risk analysis (Bullseye chart data)."""
    if sat_id not in store.objects:
        raise HTTPException(status_code=404, detail="Entity not found")
        
    conjunctions = conjunctions_for_satellite(sat_id, store.objects)
    return {
        "satellite_id": sat_id,
        "conjunctions": conjunctions,
        "summary": {
            "critical": len([c for c in conjunctions if c["risk_level"] == "red"]),
            "warning": len([c for c in conjunctions if c["risk_level"] in ["yellow", "orange"]])
        }
    }

@app.get("/api/heatmap")
async def get_fleet_heatmap():
    """Returns aggregate fleet health and resource levels for visualization."""
    stats = []
    for sid, sat in store.objects.items():
        if sat.get("type") != "SATELLITE":
            continue
        
        # Calculate derived metrics
        fuel_current = float(sat.get("fuel_kg", 0))
        fuel_pct = min(100.0, (fuel_current / 120.0) * 100)
        
        # Simple health heuristic
        health = "nominal"
        if fuel_pct < 10: health = "critical"
        elif fuel_pct < 25: health = "warning"
        
        stats.append({
            "id": sid,
            "fuel": fuel_current,
            "fuel_pct": fuel_pct,
            "mass": float(sat.get("mass_kg", 0)),
            "health": health,
            "altitude_km": float(np.linalg.norm(sat["pos"]) - 6378.137),
            "last_seen": datetime.now().timestamp()
        })
    return stats

@app.post("/api/simulation/start-telemetry")
async def start_telemetry_simulator():
    """Triggers the standalone telemetry_sim.py process to feed live data."""
    import subprocess
    import sys
    
    sim_path = os.path.join(BASE_DIR, "akashveer_solution", "telemetry_sim.py")
    if not os.path.exists(sim_path):
        sim_path = os.path.join(CURRENT_DIR, "telemetry_sim.py")
        
    try:
        # Start as a detached process
        subprocess.Popen([sys.executable, sim_path], 
                         stdout=subprocess.DEVNULL, 
                         stderr=subprocess.DEVNULL,
                         creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0)
        return {"status": "STARTED", "process": "telemetry_sim.py"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start simulator: {str(e)}")

@app.get("/api/gantt")
async def get_maneuver_gantt():
    """Returns maneuver history and scheduled burns for Gantt chart."""
    return {
        "events": ME.schedule_store.history,
        "scheduled": ME.schedule_store.scheduled,
        "sim_time": ME.schedule_store.sim_time
    }

@app.get("/api/time")
async def get_sim_time():
    return sim_clock.get_state()

@app.post("/api/time/control")
async def control_sim_time(req: ClockControlRequest):
    if req.speed is not None:
        sim_clock.set_speed(req.speed)
    if req.paused is not None:
        if req.paused: sim_clock.pause()
        else: sim_clock.resume()
    return sim_clock.get_state()

@app.post("/api/transform/rtn-to-eci")
async def transform_rtn(req: RTNTransformRequest):
    sat = _get_sat(req.satellite_id)
    dv_eci = rtn_calc.transform_rtn_to_eci(
        np.array(sat["pos"]), np.array(sat["vel"]), np.array(req.dv_rtn)
    )
    return {"dv_eci": dv_eci.tolist()}

@app.get("/api/system/performance")
async def get_system_performance():
    return {
        "status": "nominal",
        "objects": len(store.objects),
        "hz": 1.0,
        "memory_mb": 128 # placeholder
    }

# =========================================================================
# =========================================================================
# ORIGINAL MODELS (kept for compat)
# =========================================================================
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/dashboard")
    async def serve_dashboard():
        # Serve the full 3D dashboard
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    
    @app.get("/3d")
    async def serve_3d_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# --- React Dashboard Mounting ---
if os.path.isdir(REACT_TELEMETRY_DIR):
    # Mount at /telemetry for the React build
    app.mount("/telemetry", StaticFiles(directory=REACT_TELEMETRY_DIR, html=True), name="telemetry")
    
    @app.get("/docs-dashboard")  
    async def serve_docs_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "simple.html"))
    
    @app.get("/advanced")
    async def serve_advanced_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "advanced.html"))

    @app.get("/maneuver")
    async def serve_maneuver_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "maneuver.html"))
