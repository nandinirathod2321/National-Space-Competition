import numpy as np
import math
from typing import List, Dict, Any, Optional

class GroundStationEngine:
    R_E = 6378.137  # Earth radius km
    OMEGA_EARTH = 7.2921159e-5  # rad/s

    def __init__(self):
        # Default global stations
        self.stations = [
            {"id": "GS-MAA", "lat": 13.0827, "lon": 80.2707, "alt": 0, "name": "Chennai"},
            {"id": "GS-AMD", "lat": 23.0225, "lon": 72.5714, "alt": 50, "name": "Ahmedabad"},
            {"id": "GS-BLR", "lat": 12.9716, "lon": 77.5946, "alt": 900, "name": "ISRO ISTRAC"},
            {"id": "GS-SJL", "lat": -33.4489, "lon": -70.6693, "alt": 520, "name": "Santiago"},
            {"id": "GS-SVAL", "lat": 78.2232, "lon": 15.6267, "alt": 10, "name": "Svalbard"}
        ]

    def get_station_eci(self, station: Dict[str, Any], sim_seconds: float) -> np.ndarray:
        """Calculates ground station position in ECI frame at simulation time t."""
        lat_rad = math.radians(station["lat"])
        lon_rad = math.radians(station["lon"])
        
        # Earth rotation angle
        theta = self.OMEGA_EARTH * sim_seconds
        
        # Geodetic to Cartesian
        r_eff = self.R_E + (station["alt"] / 1000.0)
        
        x = r_eff * math.cos(lat_rad) * math.cos(lon_rad + theta)
        y = r_eff * math.cos(lat_rad) * math.sin(lon_rad + theta)
        z = r_eff * math.sin(lat_rad)
        
        return np.array([x, y, z])

    def check_visibility(self, sat_pos: np.ndarray, gs_pos: np.ndarray) -> bool:
        """
        LOS Check: Satellite is visible if the angle between the Zenith and Sat 
        is less than 90 degrees (above horizon).
        Effective dot product check: dot(r_sat, r_gs) > |r_gs|^2
        """
        r_gs_mag_sq = np.dot(gs_pos, gs_pos)
        return np.dot(sat_pos, gs_pos) > r_gs_mag_sq

    def get_elevation_angle(self, sat_pos: np.ndarray, gs_pos: np.ndarray) -> float:
        """Computes elevation angle in degrees."""
        r_rel = sat_pos - gs_pos
        unit_gs = gs_pos / np.linalg.norm(gs_pos)
        unit_rel = r_rel / np.linalg.norm(r_rel)
        
        sin_el = np.dot(unit_gs, unit_rel)
        return math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))

    def get_fleet_visibility(self, fleet: Dict[str, Any], sim_seconds: float) -> Dict[str, List[Dict[str, Any]]]:
        """Returns visible stations for every satellite in the fleet."""
        visibility = {}
        for sid, sat in fleet.items():
            if sat.get("type") != "SATELLITE":
                continue
            
            sat_pos = np.array(sat["pos"])
            visible_to_sat = []
            
            for gs in self.stations:
                gs_pos = self.get_station_eci(gs, sim_seconds)
                if self.check_visibility(sat_pos, gs_pos):
                    el = self.get_elevation_angle(sat_pos, gs_pos)
                    dist = np.linalg.norm(sat_pos - gs_pos)
                    
                    visible_to_sat.append({
                        "id": gs["id"],
                        "name": gs["name"],
                        "elevation_deg": round(el, 2),
                        "distance_km": round(dist, 2),
                        "signal_strength": round(100 * (self.R_E / dist), 1) # simple inverse
                    })
            
            # Sort by elevation (best station first)
            visible_to_sat.sort(key=lambda x: x["elevation_deg"], reverse=True)
            visibility[sid] = visible_to_sat
            
        return visibility

# Singleton
gs_engine = GroundStationEngine()
