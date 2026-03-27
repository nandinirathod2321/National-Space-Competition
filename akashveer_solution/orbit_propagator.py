import numpy as np
import math
import logging
from typing import Dict, Any, Tuple, Optional
from datetime import datetime

# Performance: use numpy for vector ops
MU = 398600.4418      # km^3/s^2
EARTH_RADIUS = 6378.137 # km

logger = logging.getLogger("OrbitPropagator")

class OrbitPropagator:
    def __init__(self, tolerance: float = 1e-3, base_dt: float = 1.0):
        self.tolerance = tolerance
        self.base_dt = base_dt
        self.current_dt = base_dt
        self.stability = "stable"
        self.energy_drift_log = [] # List of (time, drift)
        self.last_energy = {} # sat_id -> energy
        self.max_dt_limit = 60.0 # seconds
        self.min_dt_limit = 0.01 # seconds
        
    def get_acceleration(self, pos: np.ndarray) -> np.ndarray:
        """Newtonian gravity acceleration: a = -μ * r / |r|^3"""
        r_mag = np.linalg.norm(pos)
        if r_mag < EARTH_RADIUS:
            # Avoid singularity at center and collision logic
            return np.zeros(3)
        return -MU * pos / (r_mag**3)

    def calculate_energy(self, pos: np.ndarray, vel: np.ndarray) -> float:
        """Specific orbital energy: E = (1/2)|v|^2 - μ / |r|"""
        r_mag = np.linalg.norm(pos)
        v_mag = np.linalg.norm(vel)
        if r_mag < EARTH_RADIUS:
            return 0.0
        return 0.5 * (v_mag**2) - (MU / r_mag)

    def rk4_step(self, pos: np.ndarray, vel: np.ndarray, dt: float) -> Tuple[np.ndarray, np.ndarray]:
        """
        4th Order Runge-Kutta numerical integration.
        Returns (new_pos, new_vel).
        """
        def deriv(p, v):
            return v, self.get_acceleration(p)

        k1_r, k1_v = deriv(pos, vel)
        k2_r, k2_v = deriv(pos + 0.5 * dt * k1_r, vel + 0.5 * dt * k1_v)
        k3_r, k3_v = deriv(pos + 0.5 * dt * k2_r, vel + 0.5 * dt * k2_v)
        k4_r, k4_v = deriv(pos + dt * k3_r, vel + dt * k3_v)

        r_new = pos + (dt / 6.0) * (k1_r + 2 * k2_r + 2 * k3_r + k4_r)
        v_new = vel + (dt / 6.0) * (k1_v + 2 * k2_v + 2 * k3_v + k4_v)

        return r_new, v_new

    def propagate(self, sat_id: str, pos: np.ndarray, vel: np.ndarray, dt_requested: float) -> Dict[str, Any]:
        """Propagates state forward while monitoring stability and energy."""
        # Calculate stability limit: dt < period / 1000
        r_mag = np.linalg.norm(pos)
        period = 2 * math.pi * math.sqrt(r_mag**3 / MU)
        stability_dt_limit = period / 1000.0
        
        # Adaptive Timestep Strategy
        target_dt = min(dt_requested, self.max_dt_limit, stability_dt_limit)
        
        # Current energy (pre-step)
        e_init = self.calculate_energy(pos, vel)
        
        # Step
        r_new, v_new = self.rk4_step(pos, vel, target_dt)
        
        # NEW energy (post-step)
        e_final = self.calculate_energy(r_new, v_new)
        
        error = abs(e_final - e_init)
        if e_init != 0:
            error_relative = error / abs(e_init)
        else:
            error_relative = 0.0
            
        # Stability decision
        if error_relative > self.tolerance:
            self.stability = "warning"
            # Trigger adaptive: reduce dt
            self.current_dt = max(self.min_dt_limit, target_dt * 0.5)
            if error_relative > self.tolerance * 10:
                self.stability = "unstable"
                logger.warning(f"Unstable simulation detected for {sat_id}: Rel Error {error_relative:.2e}")
        else:
            self.stability = "stable"
            # Adaptive: slowly increase dt towards requested if stable
            self.current_dt = min(self.max_dt_limit, target_dt * 1.1)

        return {
            "pos": r_new,
            "vel": v_new,
            "energy": e_final,
            "energy_error": error_relative,
            "dt": target_dt,
            "stability": self.stability
        }

# Global Instance
propagator = OrbitPropagator()
