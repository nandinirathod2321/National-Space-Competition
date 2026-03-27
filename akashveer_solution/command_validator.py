from typing import Dict, Any, Tuple, Optional, List
import numpy as np
from datetime import datetime

# Import siblings
try:
    from ground_station_engine import gs_engine
    from simulation_clock import sim_clock
    from collision_engine import collision_engine
    from maneuver_engine import DRY_MASS, FUEL_INIT
    import maneuver_engine as ME
except ImportError:
    pass

class CommandValidator:
    def __init__(self):
        self.COOLDOWN_S = 300.0 # 5 minutes default

    def validate_command(self, sat_id: str, dv_rtn: List[float], store: Any) -> Dict[str, Any]:
        """
        Validates an incoming command through a strict pipeline.
        Returns: {approved, reason, metrics}
        """
        if sat_id not in store.objects:
            return {"approved": False, "reason": "UNKNOWN_SATELLITE", "code": 404}
        
        sat = store.objects[sat_id]
        pos = np.array(sat["pos"])
        vel = np.array(sat["vel"])
        fuel = sat.get("fuel_kg", 0.0)
        mass = sat.get("mass_kg", DRY_MASS + fuel)
        elapsed_s = sim_clock.elapsed_sim_seconds

        # 1. VISIBILITY (Ground Station LOS)
        visible_gs = []
        for gs in gs_engine.stations:
            gs_pos = gs_engine.get_station_eci(gs, elapsed_s)
            if gs_engine.check_visibility(pos, gs_pos):
                visible_gs.append(gs["id"])
        
        if not visible_gs:
            return {"approved": False, "reason": "NO_GROUND_STATION_VISIBILITY", "gs_count": 0}

        # 2. FUEL ADEQUACY
        dv_mag = np.linalg.norm(np.array(dv_rtn))
        fuel_needed = ME.fuel_for_dv(dv_mag, mass) if dv_mag > 0 else 0.0
        
        if fuel_needed > fuel:
            return {"approved": False, "reason": "INSUFFICIENT_FUEL", "needed": fuel_needed, "have": fuel}

        # 3. STATION COOLDOWN
        last_burn = ME.schedule_store.cooldowns.get(sat_id, -1000.0)
        if elapsed_s - last_burn < self.COOLDOWN_S:
            rem = self.COOLDOWN_S - (elapsed_s - last_burn)
            return {"approved": False, "reason": "COMMAND_COOLDOWN_ACTIVE", "remaining_s": round(rem, 1)}

        # 4. COLLISION SAFETY (Check if Δv increases risk)
        # Fast forecast: new_vel = vel + dv_eci
        R_matrix = np.column_stack((pos/np.linalg.norm(pos), np.array([0,1,0]), np.array([0,0,1]))) # stub if rtn_calc not available
        try:
             from rtn_transform import rtn_calc
             dv_eci = rtn_calc.transform_rtn_to_eci(pos, vel, np.array(dv_rtn))
        except:
             dv_eci = np.dot(R_matrix, np.array(dv_rtn)) # fallback

        new_vel = vel + dv_eci
        # Evaluate risk at TCA for 2 hours ahead
        risk_pre = collision_engine.calculate_tca_and_risk(pos, vel, store.objects, sat_id)
        risk_post = collision_engine.calculate_tca_and_risk(pos, new_vel, store.objects, sat_id)
        
        if risk_post.get("probability", 0) > 0.05 and risk_post.get("probability", 0) > risk_pre.get("probability", 0):
             return {
                 "approved": False, 
                 "reason": "SAFETY_HAZARD_DETECTED", 
                 "prob_pre": risk_pre.get("probability"), 
                 "prob_post": risk_post.get("probability")
             }

        # Passed all checks
        return {
            "approved": True,
            "reason": "VALIDATED",
            "metrics": {
                "gs_access": visible_gs[0],
                "fuel_cons_kg": round(fuel_needed, 4),
                "margin_prob": risk_post.get("probability", 0)
            }
        }

# Singleton
validator = CommandValidator()
