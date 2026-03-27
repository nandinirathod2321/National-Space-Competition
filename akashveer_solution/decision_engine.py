import numpy as np
import math
from typing import List, Dict, Tuple, Optional
from collision_engine import collision_engine
import maneuver_engine as ME

class DecisionEngine:
    """
    Autonomous Orbital Decision Engine.
    Evaluates risks, suggests optimal maneuvers, and manages AI state.
    """
    
    def __init__(self, prob_threshold: float = 0.01):
        self.prob_threshold = prob_threshold
        self.auto_mode: Dict[str, bool] = {} # sat_id -> auto_on

    def set_auto_mode(self, sat_id: str, status: bool):
        self.auto_mode[sat_id] = status

    def get_auto_mode(self, sat_id: str) -> bool:
        return self.auto_mode.get(sat_id, False)

    def evaluate_threat(self, sat_id: str, sat_pos: np.ndarray, sat_vel: np.ndarray, objects: dict) -> dict:
        """
        Evaluate all nearby threats and suggest a decision.
        """
        threats = []
        # Get candidates from spatial grid
        candidates = ME.spatial_grid.candidates(sat_pos, n=2)
        
        for oid in set(candidates):
            if oid == sat_id or oid not in objects: continue
            obj = objects[oid]
            
            analysis = collision_engine.analyze_conjunction(
                sat_pos, sat_vel, 
                np.array(obj["pos"]), np.array(obj["vel"])
            )
            
            # Filter threats
            if analysis["probability"] > 1e-6 or analysis["d_min_km"] < 5.0:
                threats.append({
                    "object_id": oid,
                    "type": obj.get("type", "DEBRIS"),
                    **analysis
                })

        threats.sort(key=lambda x: -x["probability"])
        
        if not threats:
            return {"decision": "nominal", "reason": "No critical threats detected"}

        top_threat = threats[0]
        if top_threat["probability"] > self.prob_threshold:
            # Suggest maneuver
            s_pos = sat_pos.copy()
            s_vel = sat_vel.copy()
            t_pos = np.array(objects[top_threat["object_id"]]["pos"])
            t_vel = np.array(objects[top_threat["object_id"]]["vel"])
            
            # Find best avoidance burn (prefer Transverse)
            suggested_dv = self._optimize_avoidance(s_pos, s_vel, t_pos, t_vel)
            
            return {
                "decision": "maneuver",
                "type": "collision_avoidance",
                "threat": top_threat,
                "suggested_dv_rtn_kms": suggested_dv.tolist(),
                "dv_mag_kms": float(np.linalg.norm(suggested_dv)),
                "auto_executable": self.get_auto_mode(sat_id)
            }

        return {"decision": "monitor", "threat": top_threat}

    def _optimize_avoidance(self, s_p: np.ndarray, s_v: np.ndarray, t_p: np.ndarray, t_v: np.ndarray) -> np.ndarray:
        """
        Try prograde, retrograde, and normal-out burns to find max d_min increase.
        Uses a small 0.01 km/s impulse for evaluation.
        """
        best_dv = np.array([0.0, 0.005, 0.0]) # default prograde
        max_d_min = 0.0
        
        R = ME.rtn_to_eci_matrix(s_p, s_v)
        
        # Test directions: Transverse +/- and Normal +/-
        test_dvs = [
            np.array([0.0, 0.01, 0.0]),
            np.array([0.0,-0.01, 0.0]),
            np.array([0.0, 0.0, 0.01]),
            np.array([0.0, 0.0,-0.01])
        ]
        
        for dv_rtn in test_dvs:
            dv_eci = R @ dv_rtn
            new_s_v = s_v + dv_eci
            
            res = collision_engine.analyze_conjunction(s_p, new_s_v, t_p, t_v)
            if res["d_min_km"] > max_d_min:
                max_d_min = res["d_min_km"]
                best_dv = dv_rtn
                
        return best_dv

decision_engine = DecisionEngine()
