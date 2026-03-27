import numpy as np
import math
from typing import Dict, Any, Tuple

# Constants
MU = 398600.4418  # Earth's gravitational parameter (km^3/s^2)

class KeplerConverter:
    @staticmethod
    def kepler_to_cartesian(a: float, e: float, i_deg: float, raan_deg: float, arg_p_deg: float, nu_deg: float) -> Tuple[np.ndarray, np.ndarray]:
        """
        Converts Keplerian orbital elements to Cartesian position and velocity in ECI frame.
        
        Args:
            a: Semi-major axis (km)
            e: Eccentricity (dimensionless)
            i_deg: Inclination (degrees)
            raan_deg: Right Ascension of Ascending Node (degrees)
            arg_p_deg: Argument of Perigee (degrees)
            nu_deg: True Anomaly (degrees)
            
        Returns:
            (pos, vel) as numpy arrays in km and km/s.
        """
        # Convert degrees to radians
        i = math.radians(i_deg)
        raan = math.radians(raan_deg)
        arg_p = math.radians(arg_p_deg)
        nu = math.radians(nu_deg)
        
        # 1. Parameter p (semi-latus rectum)
        p = a * (1 - e**2)
        
        # 2. Distance to central body
        if 1 + e * math.cos(nu) == 0:
            # Avoid division by zero for parabolic/hyperbolic edge cases
            r_mag = a # Fallback
        else:
            r_mag = p / (1 + e * math.cos(nu))
        
        # 3. Position and velocity in perifocal frame (PQW)
        r_pqw = np.array([
            r_mag * math.cos(nu),
            r_mag * math.sin(nu),
            0.0
        ])
        
        v_pqw = np.array([
            -math.sqrt(MU / p) * math.sin(nu),
            math.sqrt(MU / p) * (e + math.cos(nu)),
            0.0
        ])
        
        # 4. Rotation Matrices
        # R_z(raan) -> R_x(i) -> R_z(arg_p)
        
        cW = math.cos(raan)
        sW = math.sin(raan)
        ci = math.cos(i)
        si = math.sin(i)
        cw = math.cos(arg_p)
        sw = math.sin(arg_p)
        
        # Combined rotation matrix from PQW to ECI
        R = np.array([
            [cW*cw - sW*sw*ci, -cW*sw - sW*cw*ci,  sW*si],
            [sW*cw + cW*sw*ci, -sW*sw + cW*cw*ci, -cW*si],
            [sw*si,             cw*si,             ci]
        ])
        
        pos_eci = R @ r_pqw
        vel_eci = R @ v_pqw
        
        return pos_eci, vel_eci

    @staticmethod
    def cartesian_to_kepler(pos: np.ndarray, vel: np.ndarray) -> Dict[str, float]:
        """Inverse conversion from ECI Cartesian to Keplerian elements."""
        r_vec = np.array(pos)
        v_vec = np.array(vel)
        r = np.linalg.norm(r_vec)
        v = np.linalg.norm(v_vec)
        
        # 1. Specific Angular Momentum
        h_vec = np.cross(r_vec, v_vec)
        h = np.linalg.norm(h_vec)
        
        # 2. Inclination
        inc = math.acos(h_vec[2] / h)
        
        # 3. Node Vector
        n_vec = np.cross([0, 0, 1], h_vec)
        n = np.linalg.norm(n_vec)
        
        # 4. RAAN
        if n != 0:
            raan = math.acos(n_vec[0] / n)
            if n_vec[1] < 0:
                raan = 2 * math.pi - raan
        else:
            raan = 0
            
        # 5. Eccentricity Vector
        e_vec = ((v**2 - MU/r)*r_vec - np.dot(r_vec, v_vec)*v_vec) / MU
        e = np.linalg.norm(e_vec)
        
        # 6. Argument of Perigee
        if n != 0 and e > 1e-10:
            arg_p = math.acos(np.dot(n_vec, e_vec) / (n * e))
            if e_vec[2] < 0:
                arg_p = 2 * math.pi - arg_p
        else:
            arg_p = 0
            
        # 7. True Anomaly
        if e > 1e-10:
            nu = math.acos(np.dot(e_vec, r_vec) / (e * r))
            if np.dot(r_vec, v_vec) < 0:
                nu = 2 * math.pi - nu
        else:
            # For circular orbit, define nu from node or x-axis
            if n != 0:
                nu = math.acos(np.dot(n_vec, r_vec) / (n * r))
                if r_vec[2] < 0: nu = 2*math.pi - nu
            else:
                nu = math.atan2(r_vec[1], r_vec[0])

        # 8. Semi-major axis
        energy = v**2 / 2 - MU / r
        a = -MU / (2 * energy)
        
        return {
            "a": float(a),
            "e": float(e),
            "i": float(math.degrees(inc)),
            "raan": float(math.degrees(raan)),
            "arg_p": float(math.degrees(arg_p)),
            "nu": float(math.degrees(nu))
        }

converter = KeplerConverter()
