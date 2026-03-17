import os
import sys

# Ensure the repo root is on sys.path so shared modules like global_map can be imported
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from fastapi import FastAPI
from schemas import TelemetryPayload
from state_store import store
from physics_engine import rk4_step, get_eci_to_rtn_matrix, calculate_fuel_consumed
from global_map import acm_global_map, SpaceObject, Vector3D
import numpy as np

app = FastAPI(title="Akashveer Telemetry Service")

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
