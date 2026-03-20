import os
import sys

# Ensure the repo root is on sys.path so shared modules like global_map can be imported
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from schemas import TelemetryPayload
from state_store import store
from physics_engine import rk4_step, get_eci_to_rtn_matrix, calculate_fuel_consumed
from global_map import acm_global_map, SpaceObject, Vector3D
from orbital_mechanics import state_to_orbital_elements, orbital_elements_to_state, hohmann_transfer, circular_orbit_velocity
from ground_track import subsatellite_point, terminator_line, predict_ground_track, historical_ground_track
from conjunction_analysis import conjunctions_for_satellite
from pydantic import BaseModel
from typing import Optional
import numpy as np
import math
import os

app = FastAPI(title="Akashveer Telemetry Service")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== MODELS ==========
class ManeuverRequest(BaseModel):
    """Request to perform an orbital maneuver."""
    satellite_id: str
    target_altitude_km: float  # Target circular orbit altitude
    target_inclination_deg: Optional[float] = None  # Target inclination (if None, keep current)
    
class ManeuverPlan(BaseModel):
    """Plan for a maneuver (returns delta-V and timing info)."""
    satellite_id: str
    current_altitude_km: float
    target_altitude_km: float
    dv_required: float  # km/s
    fuel_required_kg: float
    can_execute: bool
    reason: str

@app.get("/")
async def root():
    return {"status": "online", "service": "Akashveer"}


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


@app.post("/api/telemetry")
async def ingest_telemetry(payload: TelemetryPayload):
    # 1. Update all object positions in the store
    for obj in payload.objects:
        store.update_object(
            obj.id,
            [obj.r.x, obj.r.y, obj.r.z],
            [obj.v.x, obj.v.y, obj.v.z],
            payload.timestamp,
            obj.type,
        )

    # 1b. Keep the Global Map (Digital Twin) in sync
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

    # 2. Check for collisions and trigger AUTO-COLA
    warnings = 0
    all_objs = store.objects
    for obj_id, data in all_objs.items():
        if data.get("type") == "SATELLITE":
            # Run the autonomous logic we defined above
            autonomous_cola(obj_id)

            # Still count warnings for the response (5km threshold)
            current_key = store._get_grid_key(data["pos"])
            for dx in [-1, 0, 1]:
                for dy in [-1, 0, 1]:
                    for dz in [-1, 0, 1]:
                        neighbor_key = (current_key[0] + dx, current_key[1] + dy, current_key[2] + dz)
                        for other_id in store.grid.get(neighbor_key, []):
                            if other_id == obj_id:
                                continue
                            dist = np.linalg.norm(data["pos"] - all_objs[other_id]["pos"])
                            if dist < 5.0:  # 5km threshold
                                warnings += 1

    return {
        "status": "ACK",
        "processed_count": len(payload.objects),
        "active_cdm_warnings": warnings,
    }


@app.post("/api/tick")
async def simulation_tick(dt: float = 1.0):
    states = store.objects
    for obj_id, data in states.items():
        new_p, new_v = rk4_step(data["pos"], data["vel"], dt)
        store.update_object(obj_id, new_p, new_v, data["timestamp"], data["type"])

    return {"status": "OK", "new_states_count": len(states)}


@app.get("/api/states")
async def get_all_states():
    """Returns all tracked objects for the frontend 3D visualization."""
    result = []
    for obj_id, data in store.objects.items():
        result.append({
            "id": obj_id,
            "type": data.get("type", "DEBRIS"),
            "pos": data["pos"].tolist(),
            "vel": data["vel"].tolist(),
            "fuel_kg": data.get("fuel_kg", 0),
            "mass_kg": data.get("mass_kg", 0),
            "timestamp": str(data.get("timestamp", "")),
        })
    return {"objects": result, "count": len(result)}


@app.get("/api/status")
async def get_status():
    """Dashboard status summary."""
    objects = store.objects
    sats = [o for o in objects.values() if o.get("type") == "SATELLITE"]
    debris = [o for o in objects.values() if o.get("type") == "DEBRIS"]
    total_fuel = sum(o.get("fuel_kg", 0) for o in sats)
    return {
        "total_objects": len(objects),
        "satellites": len(sats),
        "debris": len(debris),
        "total_fuel_kg": round(total_fuel, 2),
    }


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
                "altitude_km": current_track["alt_km"]
            })
        except Exception as e:
            print(f"Error computing ground track for {sat_id}: {e}")
    
    # Terminator line (day/night boundary)
    terminator = terminator_line(str(store.objects[list(store.objects.keys())[0]].get("timestamp", "")))
    
    return {
        "satellites": features,
        "terminator_line": terminator,
        "timestamp": str(store.objects[list(store.objects.keys())[0]].get("timestamp", "")) if store.objects else ""
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


# Serve frontend
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/dashboard")
    async def serve_dashboard():
        # Serve the full 3D dashboard
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    
    @app.get("/3d")
    async def serve_3d_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    
    @app.get("/docs-dashboard")  
    async def serve_docs_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "simple.html"))
