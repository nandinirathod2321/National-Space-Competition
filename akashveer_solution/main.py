from fastapi import FastAPI
from schemas import TelemetryPayload
from state_store import store
from physics_engine import rk4_step, get_eci_to_rtn_matrix, calculate_fuel_consumed
import numpy as np

app = FastAPI(title="Akashveer Telemetry Service")

@app.get("/")
async def root():
    return {"status": "online", "service": "Akashveer"}

def autonomous_cola(sat_id):
    """Checks for critical threats and performs a burn if necessary."""
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
                neighbor_key = (current_key[0]+dx, current_key[1]+dy, current_key[2]+dz)
                for other_id in store.grid.get(neighbor_key, []):
                    if other_id == sat_id: continue
                    
                    dist = np.linalg.norm(current_pos - store.objects[other_id]["pos"])
                    if dist < 0.1: # 100 meter threshold
                        is_critical = True
                        break
    
    # 2. Perform Avoidance if critical
    if is_critical and sat.get("fuel_kg", 0) > 0:
        # Plan a 5 m/s Transverse burn (Efficient avoidance)
        dv_rtn = np.array([0, 0.005, 0]) # 5 m/s = 0.005 km/s
        
        rot_matrix = get_eci_to_rtn_matrix(current_pos, current_vel)
        dv_eci = rot_matrix @ dv_rtn
        
        # Apply Burn
        sat["vel"] = current_vel + dv_eci
        fuel_used = calculate_fuel_consumed(sat["mass_kg"], 5.0)
        sat["fuel_kg"] -= fuel_used
        sat["mass_kg"] -= fuel_used
        
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
            obj.type
        )
    
    # 2. Check for collisions and trigger AUTO-COLA
    warnings = 0
    all_objs = store.objects
    for obj_id, data in all_objs.items():
        if data["type"] == "SATELLITE":
            # Run the autonomous logic we defined above
            autonomous_cola(obj_id)
            
            # Still count warnings for the response (5km threshold)
            current_key = store._get_grid_key(data["pos"])
            for dx in [-1, 0, 1]:
                for dy in [-1, 0, 1]:
                    for dz in [-1, 0, 1]:
                        neighbor_key = (current_key[0]+dx, current_key[1]+dy, current_key[2]+dz)
                        for other_id in store.grid.get(neighbor_key, []):
                            if other_id == obj_id: continue
                            dist = np.linalg.norm(data["pos"] - all_objs[other_id]["pos"])
                            if dist < 5.0: # 5km threshold
                                warnings += 1
    
    return {
        "status": "ACK",
        "processed_count": len(payload.objects),
        "active_cdm_warnings": warnings
    }

@app.post("/api/tick")
async def simulation_tick(dt: float = 1.0):
    states = store.objects
    for obj_id, data in states.items():
        new_p, new_v = rk4_step(data["pos"], data["vel"], dt)
        store.update_object(obj_id, new_p, new_v, data["timestamp"], data["type"])
    
    return {"status": "OK", "new_states_count": len(states)}
import numpy as np

def calculate_fuel_consumed(current_mass, delta_v_km_s):
    """Implementation of Tsiolkovsky Rocket Equation [cite: 163-164]"""
    isp = 300.0  # seconds [cite: 159]
    g0 = 9.80665 # m/s^2 
    # delta_m = m * (1 - e^(-dv / (Isp * g0)))
    # Note: convert dv to m/s for formula
    dv_ms = delta_v_km_s * 1000
    fuel_used = current_mass * (1 - np.exp(-dv_ms / (isp * g0)))
    return fuel_used

def autonomous_cola(sat_id):
    sat = store.objects[sat_id]
    
    # --- OBJECTIVE 5: EOL MANAGEMENT  ---
    # Initial fuel was 50kg; 5% threshold is 2.5kg
    if sat["fuel_kg"] < 2.5 and sat["status"] != "GRAVEYARD":
        print(f"⚠️ EOL CRITICAL: Moving {sat_id} to Graveyard Orbit.")
        # Perform a high-deltaV maneuver to raise altitude (simplified logic)
        sat["status"] = "GRAVEYARD"
        return True

    # --- OBJECTIVE 6: OPTIMIZATION (Station-Keeping) [cite: 44, 48] ---
    # Only perform expensive evasion if the satellite is actually at risk
    # and has enough fuel to return to its 10km station-keeping box later.
    
    current_pos = np.array(sat["pos"])
    # 1. Critical Threat Check (100m) [cite: 70]
    is_critical = False
    # ... (Your existing grid-search logic from main.py) ...

    if is_critical and sat["fuel_kg"] > 0:
        # Optimization: Use the most fuel-efficient burn (Transverse) 
        dv_mag = 0.005 # 5 m/s
        fuel_used = calculate_fuel_consumed(sat["mass_dry"] + sat["fuel_kg"], dv_mag)
        
        # Deduct fuel mass [cite: 162]
        sat["fuel_kg"] -= fuel_used
        
        # Update Status to indicate mission interruption [cite: 171]
        sat["status"] = "OUT_OF_SLOT"
        
        # Execute burn logic...
        return True
    return False