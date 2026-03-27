import numpy as np
from typing import Tuple

class RTNTransform:
    @staticmethod
    def get_eci_to_rtn_matrix(pos: np.ndarray, vel: np.ndarray) -> np.ndarray:
        """
        Calculates the rotation matrix from ECI to RTN frame.
        R (Radial): Along the position vector
        T (Transverse): In the orbital plane, perpendicular to R
        N (Normal): Vector cross product (angular momentum direction)
        """
        r_mag = np.linalg.norm(pos)
        if r_mag == 0:
            return np.eye(3)
        
        # Radial unit vector
        r_unit = pos / r_mag
        
        # Angular momentum unit vector (Normal)
        h = np.cross(pos, vel)
        h_mag = np.linalg.norm(h)
        if h_mag == 0:
            # Handle degenerate cases (e.g. at singularity or purely radial motion)
            return np.column_stack((r_unit, np.array([0, 1, 0]), np.array([0, 0, 1])))
            
        n_unit = h / h_mag
        
        # Transverse unit vector
        t_unit = np.cross(n_unit, r_unit)
        
        # Columns: R, T, N unit vectors
        return np.column_stack((r_unit, t_unit, n_unit))

    @staticmethod
    def transform_rtn_to_eci(pos: np.ndarray, vel: np.ndarray, dv_rtn: np.ndarray) -> np.ndarray:
        """Transforms a delta-v in RTN frame to ECI frame."""
        M = RTNTransform.get_eci_to_rtn_matrix(pos, vel)
        return M @ dv_rtn

    @staticmethod
    def transform_eci_to_rtn(pos: np.ndarray, vel: np.ndarray, dv_eci: np.ndarray) -> np.ndarray:
        """Transforms a delta-v in ECI frame to RTN frame using inverse (transpose)."""
        M = RTNTransform.get_eci_to_rtn_matrix(pos, vel)
        return M.T @ dv_eci

# Singleton
rtn_calc = RTNTransform()
