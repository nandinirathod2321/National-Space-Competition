"""
Telemetry Manager Module
------------------------
Handles validation, ingestion, and state management for high-frequency satellite telemetry.
Includes a circular buffer for historical state tracking.
"""

import numpy as np
import time
import math
from collections import deque
from typing import Dict, List, Optional, Tuple, Any
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TelemetryManager")

class TelemetryManager:
    def __init__(self, history_limit: int = 100):
        # satellite_id -> current_state
        self.registry: Dict[str, Dict[str, Any]] = {}
        # satellite_id -> deque of recent states
        self.history: Dict[str, deque] = {}
        self.history_limit = history_limit
        
        # Physical sanity limits
        self.MAX_ALTITUDE = 50000.0  # km (beyond GEO)
        self.MIN_ALTITUDE = 150.0    # km (re-entry)
        self.MAX_VELOCITY = 15.0     # km/s (escape velocity is ~11.2)
        self.EARTH_RADIUS = 6378.137 # km

    def validate(self, data: Dict[str, Any]) -> Tuple[bool, str]:
        """Validates incoming telemetry packet for schema and physical sanity."""
        required = ["satellite_id", "timestamp", "position", "velocity", "fuel"]
        for field in required:
            if field not in data:
                return False, f"Missing required field: {field}"
        
        sat_id = data["satellite_id"]
        pos = data["position"]
        vel = data["velocity"]
        fuel = data["fuel"]

        # 1. Type and Length checks
        if not isinstance(pos, list) or len(pos) != 3:
            return False, "Position must be a 3-element list"
        if not isinstance(vel, list) or len(vel) != 3:
            return False, "Velocity must be a 3-element list"

        # 2. NaN/Inf checks
        try:
            p_arr = np.array(pos, dtype=float)
            v_arr = np.array(vel, dtype=float)
            if np.any(np.isnan(p_arr)) or np.any(np.isinf(p_arr)):
                return False, "Position contains NaN or Inf"
            if np.any(np.isnan(v_arr)) or np.any(np.isinf(v_arr)):
                return False, "Velocity contains NaN or Inf"
        except (ValueError, TypeError):
            return False, "Numeric values required for pos/vel"

        # 3. Physical Sanity Checks
        alt = np.linalg.norm(p_arr) - self.EARTH_RADIUS
        if alt > self.MAX_ALTITUDE:
            return False, f"Altitude too high: {alt:.2f} km"
        if alt < self.MIN_ALTITUDE:
            return False, f"Altitude too low (re-entry/collision): {alt:.2f} km"
        
        v_mag = np.linalg.norm(v_arr)
        if v_mag > self.MAX_VELOCITY:
            return False, f"Velocity physically impossible: {v_mag:.2f} km/s"
            
        if fuel < 0 or fuel > 1000: # Assuming 1000kg max for this class
            return False, f"Invalid fuel mass: {fuel}"

        return True, "Valid"

    def ingest(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Processes and stores telemetry data."""
        sat_id = data["satellite_id"]
        
        # Prepare state object
        state = {
            "satellite_id": sat_id,
            "timestamp": data["timestamp"],
            "pos": data["position"],
            "vel": data["velocity"],
            "fuel_kg": float(data["fuel"]),
            "last_updated": time.time(),
            "type": "SATELLITE"
        }
        
        # Update registry
        self.registry[sat_id] = state
        
        # Update history buffer
        if sat_id not in self.history:
            self.history[sat_id] = deque(maxlen=self.history_limit)
        self.history[sat_id].append(state)
        
        return state

    def get_latest_state(self, satellite_id: Optional[str] = None) -> Any:
        """Returns the latest state for one or all satellites."""
        if satellite_id:
            return self.registry.get(satellite_id)
        return self.registry

    def get_history(self, satellite_id: str) -> List[Dict[str, Any]]:
        """Returns history of telemetry for a specific satellite."""
        if satellite_id in self.history:
            return list(self.history[satellite_id])
        return []

# Singleton instance
telemetry_manager = TelemetryManager()
