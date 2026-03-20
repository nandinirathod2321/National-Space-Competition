"""
Conjunction analysis and Time-to-Closest-Approach (TCA) calculations.
Computes relative positions for the Bullseye polar chart.
"""

import numpy as np
import math
from datetime import datetime

def closest_approach_vector(r_sat, v_sat, r_debris, v_debris, dt=600):
    """
    Computes relative position and time-to-closest-approach.
    
    Args:
        r_sat, v_sat: Satellite position and velocity (ECI)
        r_debris, v_debris: Debris position and velocity (ECI)
        dt: Time step for numerical integration (seconds)
    
    Returns:
        {
            "min_distance_km": float,
            "time_to_ca_seconds": float,
            "relative_pos": [dx, dy, dz],
            "relative_vel": [dvx, dvy, dvz],
            "approach_angle_deg": float
        }
    """
    r_sat = np.array(r_sat)
    v_sat = np.array(v_sat)
    r_debris = np.array(r_debris)
    v_debris = np.array(v_debris)
    
    # Relative state
    rel_r = r_debris - r_sat
    rel_v = v_debris - v_sat
    
    min_dist = np.inf
    min_time = 0
    
    # Scan forward 24 hours
    for t in range(0, 86400, dt):
        # Linear approximation for closest approach
        dist = np.linalg.norm(rel_r + rel_v * t)
        if dist < min_dist:
            min_dist = dist
            min_time = t
    
    # Approach angle
    if np.linalg.norm(rel_v) > 0:
        approach_angle = math.degrees(
            math.acos(np.dot(rel_r, rel_v) / (np.linalg.norm(rel_r) * np.linalg.norm(rel_v) + 1e-6))
        )
    else:
        approach_angle = 0
    
    return {
        "min_distance_km": float(min_dist),
        "time_to_ca_seconds": float(min_time),
        "relative_pos": rel_r.tolist(),
        "relative_vel": rel_v.tolist(),
        "approach_angle_deg": float(approach_angle),
        "is_critical": min_dist < 1.0,  # < 1 km = critical
        "is_warning": min_dist < 5.0,   # < 5 km = warning
    }


def compute_collision_risk_index(min_distance, tca_seconds):
    """
    Returns risk color and probability based on closest approach metrics.
    
    Returns:
        {risk_level: "green|yellow|red", probability: 0.0-1.0}
    """
    # Simple risk model
    if min_distance < 0.5:
        return {"risk_level": "red", "probability": 0.9, "description": "CRITICAL"}
    elif min_distance < 1.0:
        return {"risk_level": "red", "probability": 0.7, "description": "CRITICAL"}
    elif min_distance < 5.0:
        return {"risk_level": "yellow", "probability": 0.3, "description": "WARNING"}
    elif min_distance < 25.0:
        return {"risk_level": "orange", "probability": 0.1, "description": "CAUTION"}
    else:
        return {"risk_level": "green", "probability": 0.01, "description": "SAFE"}


def conjunctions_for_satellite(sat_id, sat_data, all_debris, time_window=86400):
    """
    Returns all nearby debris for a satellite, sorted by closest approach.
    
    Args:
        sat_id: Satellite ID
        sat_data: Satellite state {pos, vel}
        all_debris: Dict of all debris objects
        time_window: Look-ahead window (default 24 hours)
    
    Returns:
        List of conjunction objects, sorted by min_distance
    """
    conjunctions = []
    
    for debris_id, debris_data in all_debris.items():
        if debris_id == sat_id:
            continue
        
        ca = closest_approach_vector(
            sat_data["pos"],
            sat_data["vel"],
            debris_data["pos"],
            debris_data["vel"]
        )
        
        risk = compute_collision_risk_index(ca["min_distance_km"], ca["time_to_ca_seconds"])
        
        conjunctions.append({
            "debris_id": debris_id,
            "min_distance_km": ca["min_distance_km"],
            "time_to_ca_seconds": ca["time_to_ca_seconds"],
            "relative_position": ca["relative_pos"],
            "approach_angle_deg": ca["approach_angle_deg"],
            "risk_level": risk["risk_level"],
            "risk_probability": risk["probability"],
            "risk_description": risk["description"]
        })
    
    # Sort by time to closest approach
    conjunctions.sort(key=lambda x: x["time_to_ca_seconds"])
    
    return conjunctions
