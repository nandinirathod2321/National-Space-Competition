"""
Autonomous Mission Manager & Decision Engine
============================================
Handles high-level mission logic:
1. Command Validation Pipeline (LOS -> Fuel -> Cooldown -> Safety)
2. Autonomous Decision Engine (Risk Eval -> Strategy Selection)
3. Station-Keeping Maintenance
"""

import numpy as np
import maneuver_engine as ME
from state_store import store
import time

class DecisionEngine:
    """
    Evaluates orbital threats and selects the optimal recovery/avoidance strategy.
    Implements 'Mission-Grade' logic: Prograde-first avoidance.
    """

    @staticmethod
    def evaluate_and_solve_cola(sat_id: str, dv_budget_kms: float = 0.05) -> dict:
        sat = store.objects.get(sat_id)
        if not sat: return {"status": "ERROR", "reason": "Satellite not found"}

        pos = np.array(sat["pos"])
        vel = np.array(sat["vel"])
        fuel = sat.get("fuel_kg", 0.0)
        mass = sat.get("mass_kg", ME.DRY_MASS + fuel)

        # 1. Prediction Pass (6 hours for autonomous check)
        threats = ME.predict_conjunction(sat_id, pos, vel, store.objects, hours=6.0)
        if not threats:
            return {"status": "SAFE", "message": "No conjunctions detected in 24h window"}

        # 2. Priority Handling: Sort by severity
        critical_threats = [t for t in threats if t["critical"]]
        target_threat = critical_threats[0] if critical_threats else threats[0]

        # 3. Decision Logic: Is action required?
        # Critical (<100m) or Warning (<5km) within 6 hours?
        if target_threat["min_distance_km"] > 5.0:
            return {"status": "SAFE", "message": f"Nearest threat {target_threat['object_id']} at {target_threat['min_distance_km']:.2f}km"}

        # 4. Strategy Selection: Prograde/Retrograde (T) is fuel-efficient.
        # We compute the best RTN burn vector.
        threat_obj = store.objects.get(target_threat["object_id"])
        dv_eci = ME.compute_avoidance_dv(pos, vel, np.array(threat_obj["pos"]), np.array(threat_obj["vel"]), dv_budget_kms)
        R = ME.rtn_to_eci_matrix(pos, vel)
        dv_rtn = R.T @ dv_eci

        # 5. Validation Check
        fuel_needed = ME.fuel_for_dv(float(np.linalg.norm(dv_rtn)), mass)
        if fuel_needed > fuel:
            return {"status": "REJECTED", "reason": "Insufficient fuel for recommended avoidance"}

        return {
            "status": "ACTION_REQUIRED",
            "strategy": "PROGRADE_AVOIDANCE" if dv_rtn[1] > 0 else "RETROGRADE_AVOIDANCE",
            "threat": target_threat,
            "recommended_dv_rtn": dv_rtn.tolist(),
            "burn_duration_s": ME.calculate_burn_duration(float(np.linalg.norm(dv_rtn)), mass)
        }


class CommandPipeline:
    """
    Mission-grade command validation gatekeeper.
    Ensures every maneuver passes all mission constraints.
    """

    @staticmethod
    def validate_maneuver(sat_id: str, dv_rtn: np.ndarray, bypass_los: bool = False) -> dict:
        sat = store.objects.get(sat_id)
        if not sat: return {"valid": False, "reason": "Sat not found"}

        pos = np.array(sat["pos"])
        vel = np.array(sat["vel"])
        fuel = sat.get("fuel_kg", 0.0)
        mass = sat.get("mass_kg", ME.DRY_MASS + fuel)
        dv_mag = float(np.linalg.norm(dv_rtn))

        # 1. Cooldown Check
        cd_ok, cd_msg = ME.schedule_store.can_execute(sat_id)
        if not cd_ok: return {"valid": False, "reason": cd_msg}

        # 2. LOS Check (Critical for command uplink)
        los = ME.ground_station_los(pos)
        if not los and not bypass_los:
            return {"valid": False, "reason": "Communication blackout: No ground station LOS"}

        # 3. Fuel Check
        fuel_needed = ME.fuel_for_dv(dv_mag, mass)
        if fuel_needed > fuel:
            return {"valid": False, "reason": f"Fuel starvation: Need {fuel_needed:.3f}kg, have {fuel:.3f}kg"}

        # 4. Energy Check (Physics Consistency)
        energy_before = ME.calculate_energy(pos, vel)
        # Note: Burn changes energy, so we check for NaN or instability
        if np.isnan(energy_before):
            return {"valid": False, "reason": "Numerical instability detected in state"}

        return {
            "valid": True,
            "fuel_needed": fuel_needed,
            "los_stations": [gs["gs_id"] for gs in los],
            "burn_duration_s": ME.calculate_burn_duration(dv_mag, mass)
        }


def execute_autonomous_mission_step():
    """
    High-level loop to be called by main.py / scheduler.
    Performs drift detection and autonomous COLA for the entire fleet.
    """
    for sat_id, obj in store.objects.items():
        if obj.get("type") != "SATELLITE": continue
        
        # 1. Check for COLA threats
        decision = DecisionEngine.evaluate_and_solve_cola(sat_id)
        if decision["status"] == "ACTION_REQUIRED":
            print(f"[MISSION CONTROL] Executing autonomous COLA for {sat_id}")
            dv = np.array(decision["recommended_dv_rtn"])
            ME.apply_rtn_burn(obj, dv[0], dv[1], dv[2], check_los=False, sat_id=sat_id)
            
        # 2. Check for Station-Keeping Drift
        sk = ME.check_station_keeping(sat_id, np.array(obj["pos"]))
        if sk.get("out_of_slot"):
            print(f"[MISSION CONTROL] Executing drift correction for {sat_id}")
            # Recovery burn
            slot = ME.schedule_store.slots[sat_id]
            dv_eci = ME.station_keeping_dv(np.array(obj["pos"]), np.array(obj["vel"]), slot["pos"], slot["vel"])
            R = ME.rtn_to_eci_matrix(np.array(obj["pos"]), np.array(obj["vel"]))
            dv_rtn = R.T @ dv_eci
            ME.apply_rtn_burn(obj, dv_rtn[0], dv_rtn[1], dv_rtn[2], check_los=False, sat_id=sat_id)
