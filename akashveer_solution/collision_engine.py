import numpy as np
import math
from typing import List, Dict, Tuple, Optional

# Constants from maneuver_engine
MU    = 398600.4418     # km³/s²
R_E   = 6378.137        # km

class CollisionEngine:
    """
    Advanced Collision Probability Engine.
    Estimates risk based on TCA (Time of Closest Approach) and error ellipses.
    """
    
    def __init__(self, safety_radius_km: float = 0.5):
        self.sigma = safety_radius_km # Safety radius (standard deviation)

    def calculate_tca(self, r_rel: np.ndarray, v_rel: np.ndarray) -> float:
        """Calculate Time to Closest Approach (TCA) assuming linear relative motion."""
        v_rel_sq = np.dot(v_rel, v_rel)
        if v_rel_sq < 1e-12:
            return 0.0
        t_ca = -np.dot(r_rel, v_rel) / v_rel_sq
        return max(0.0, float(t_ca))

    def calculate_d_min(self, r_rel: np.ndarray, v_rel: np.ndarray, t_ca: float) -> float:
        """Calculate minimum distance at TCA."""
        r_ca = r_rel + v_rel * t_ca
        return float(np.linalg.norm(r_ca))

    def estimate_probability(self, d_min: float) -> float:
        """Approximate collision probability using a 1D Gaussian model."""
        if self.sigma <= 0:
            return 1.0 if d_min < 0.01 else 0.0
        return float(math.exp(-(d_min**2) / (self.sigma**2)))

    def get_risk_level(self, prob: float) -> str:
        if prob > 0.05: return "critical"
        if prob > 0.005: return "warning"
        return "safe"

    def analyze_conjunction(self, p1: np.ndarray, v1: np.ndarray, p2: np.ndarray, v2: np.ndarray) -> dict:
        r_rel = p1 - p2
        v_rel = v1 - v2
        t_ca = self.calculate_tca(r_rel, v_rel)
        d_min = self.calculate_d_min(r_rel, v_rel, t_ca)
        prob = self.estimate_probability(d_min)
        
        return {
            "tca_s": round(t_ca, 2),
            "d_min_km": round(d_min, 4),
            "probability": round(prob, 6),
            "risk_level": self.get_risk_level(prob),
            "relative_velocity_kms": round(float(np.linalg.norm(v_rel)), 4)
        }

    def calculate_tca_and_risk(self, pos: np.ndarray, vel: np.ndarray, objects: dict, my_id: str) -> dict:
        """
        Optimized performance search using Spatial Partitioning (Grid).
        Only checks objects in the same and adjacent cells.
        """
        from state_store import store
        
        gx, gy, gz = (pos // store.grid_size).astype(int)
        nearby_objects = []
        
        # Check 27 neighboring cells (3x3x3 grid)
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                for dz in [-1, 0, 1]:
                    key = (gx + dx, gy + dy, gz + dz)
                    if key in store.grid:
                        nearby_objects.extend(store.grid[key])
        
        best_threat = {"probability": 0, "risk_level": "safe", "object_id": "None", "tca_s": 0, "d_min_km": 99999}
        
        for other_id in nearby_objects:
            if other_id == my_id: continue
            other = objects[other_id]
            res = self.analyze_conjunction(pos, vel, other["pos"], other["vel"])
            if res["probability"] > best_threat["probability"]:
                best_threat = res
                best_threat["object_id"] = other_id
        
        return best_threat

collision_engine = CollisionEngine()

collision_engine = CollisionEngine()
