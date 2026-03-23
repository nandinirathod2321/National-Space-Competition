import numpy as np
import math

# Constants
MU = 398600.4418      # km^3/s^2
R_E = 6378.137        # km

class OrbitalElements:
    """Represents classical orbital elements."""
    def __init__(self, a=None, e=None, i=None, raan=None, w=None, v=None):
        self.a = a          # Semi-major axis (km)
        self.e = e          # Eccentricity
        self.i = i          # Inclination (rad)
        self.raan = raan    # Right Ascension of Ascending Node (rad)
        self.w = w          # Argument of Perigee (rad)
        self.v = v          # True anomaly (rad)

    def to_dict(self):
        return {
            "a": float(self.a) if self.a else None,
            "e": float(self.e) if self.e else None,
            "i": float(self.i) if self.i else None,
            "raan": float(self.raan) if self.raan else None,
            "w": float(self.w) if self.w else None,
            "v": float(self.v) if self.v else None,
            "periapsis_km": float(self.a * (1 - self.e)) if (self.a and self.e) else None,
            "apoapsis_km": float(self.a * (1 + self.e)) if (self.a and self.e) else None,
            "period_minutes": float(2 * math.pi * math.sqrt((self.a**3) / MU) / 60) if self.a else None,
        }


def state_to_orbital_elements(r, v):
    """
    Converts position and velocity vectors (ECI) to classical orbital elements.
    
    Args:
        r: Position vector [km] (numpy array)
        v: Velocity vector [km/s] (numpy array)
    
    Returns:
        OrbitalElements object
    """
    r = np.array(r)
    v = np.array(v)
    
    r_mag = np.linalg.norm(r)
    v_mag = np.linalg.norm(v)
    
    # Specific orbital energy
    energy = (v_mag**2 / 2) - (MU / r_mag)
    
    # Semi-major axis
    a = -MU / (2 * energy)
    
    # Angular momentum
    h = np.cross(r, v)
    h_mag = np.linalg.norm(h)
    
    # Eccentricity vector
    e_vec = ((v_mag**2 - MU/r_mag) * r - np.dot(r, v) * v) / MU
    e = np.linalg.norm(e_vec)
    
    # Inclination
    i = math.acos(h[2] / h_mag)
    
    # Node vector (intersection of orbit with equatorial plane)
    n = np.array([-h[1], h[0], 0])
    n_mag = np.linalg.norm(n)
    
    # Right Ascension of Ascending Node
    if n_mag == 0:
        raan = 0
    else:
        raan = math.acos(n[0] / n_mag)
        if n[1] < 0:
            raan = 2 * math.pi - raan
    
    # Argument of Perigee
    if n_mag == 0:
        w = 0
    else:
        w = math.acos(np.dot(n, e_vec) / (n_mag * e))
        if e_vec[2] < 0:
            w = 2 * math.pi - w
    
    # True Anomaly
    v_true = math.acos(np.dot(e_vec, r) / (e * r_mag))
    if np.dot(r, v) < 0:
        v_true = 2 * math.pi - v_true
    
    return OrbitalElements(a=a, e=e, i=i, raan=raan, w=w, v=v_true)


def orbital_elements_to_state(a, e, i, raan, w, v):
    """
    Converts classical orbital elements to position and velocity vectors (ECI).
    
    Args:
        a: Semi-major axis (km)
        e: Eccentricity
        i: Inclination (rad)
        raan: Right Ascension of Ascending Node (rad)
        w: Argument of Perigee (rad)
        v: True anomaly (rad)
    
    Returns:
        r: Position vector [km]
        v: Velocity vector [km/s]
    """
    # Orbit radius
    p = a * (1 - e**2)
    r_orb = p / (1 + e * math.cos(v))
    
    # Position in perifocal frame (P, Q, W)
    r_perf = np.array([
        r_orb * math.cos(v),
        r_orb * math.sin(v),
        0
    ])
    
    # Velocity in perifocal frame
    v_perf = np.array([
        -math.sqrt(MU / p) * math.sin(v),
        math.sqrt(MU / p) * (e + math.cos(v)),
        0
    ])
    
    # Rotation matrix from perifocal to ECI
    # First rotate about W (true anomaly)
    c1, s1 = math.cos(w), math.sin(w)
    Rw = np.array([
        [c1, -s1, 0],
        [s1, c1, 0],
        [0, 0, 1]
    ])
    
    # Rotate about X (inclination)
    c2, s2 = math.cos(i), math.sin(i)
    Ri = np.array([
        [1, 0, 0],
        [0, c2, -s2],
        [0, s2, c2]
    ])
    
    # Rotate about Z (RAAN)
    c3, s3 = math.cos(raan), math.sin(raan)
    Rz = np.array([
        [c3, -s3, 0],
        [s3, c3, 0],
        [0, 0, 1]
    ])
    
    # Complete rotation matrix
    R = Rz @ Ri @ Rw
    
    # Transform to ECI
    r_eci = R @ r_perf
    v_eci = R @ v_perf
    
    return r_eci, v_eci


def hohmann_transfer(r_current, v_current, r_target_altitude):
    """
    Calculates Hohmann transfer burn from current orbit to target altitude.
    Returns the delta-V magnitude required.
    
    Args:
        r_current: Current position vector (km)
        v_current: Current velocity vector (km/s)
        r_target_altitude: Target circular orbital altitude (km)
    
    Returns:
        {
            "dv1": delta-V for first burn (km/s),
            "dv2": delta-V for second burn (km/s),
            "dv_total": total delta-V (km/s),
            "transfer_time": time to transfer (seconds)
        }
    """
    elements = state_to_orbital_elements(r_current, v_current)
    r1 = elements.a * (1 - elements.e)  # Periapsis
    r2 = R_E + r_target_altitude
    
    if r1 >= r2:
        return None  # Can't transfer to lower orbit with Hohmann
    
    # Hohmann transfer orbit semi-major axis
    a_transfer = (r1 + r2) / 2
    
    # Current circular orbit speed
    v1_circular = math.sqrt(MU / r1)
    
    # Speed at periapsis of transfer orbit
    v_trans_peri = math.sqrt(MU * (2/r1 - 1/a_transfer))
    
    # Speed at apoapsis of transfer orbit
    v_trans_apo = math.sqrt(MU * (2/r2 - 1/a_transfer))
    
    # Target circular orbit speed
    v2_circular = math.sqrt(MU / r2)
    
    # Delta-V magnitudes
    dv1 = abs(v_trans_peri - v1_circular)
    dv2 = abs(v2_circular - v_trans_apo)
    
    # Transfer time (half the transfer orbit period)
    transfer_time = math.pi * math.sqrt((a_transfer**3) / MU)
    
    return {
        "dv1": dv1,
        "dv2": dv2,
        "dv_total": dv1 + dv2,
        "transfer_time": transfer_time,
    }


def circular_orbit_velocity(altitude_km):
    """Returns velocity for circular orbit at given altitude."""
    r = R_E + altitude_km
    return math.sqrt(MU / r)


def mean_anomaly_to_true_anomaly(M, e, tol=1e-8, max_iter=100):
    """
    Converts mean anomaly to true anomaly using Kepler's equation.
    
    Args:
        M: Mean anomaly (rad)
        e: Eccentricity
        tol: Tolerance for convergence
        max_iter: Maximum iterations
    
    Returns:
        True anomaly (rad)
    """
    # Initial guess for eccentric anomaly
    E = M if e < 0.8 else math.pi
    
    for _ in range(max_iter):
        # Kepler's equation: M = E - e * sin(E)
        f = E - e * math.sin(E) - M
        f_prime = 1 - e * math.cos(E)
        
        delta = f / f_prime
        E -= delta
        
        if abs(delta) < tol:
            break
    
    # True anomaly from eccentric anomaly
    cos_E = math.cos(E)
    sin_E = math.sin(E)
    
    cos_v = (cos_E - e) / (1 - e * cos_E)
    sin_v = (math.sqrt(1 - e**2) * sin_E) / (1 - e * cos_E)
    
    v = math.atan2(sin_v, cos_v)
    if v < 0:
        v += 2 * math.pi
    
    return v


def orbit_altitude_from_period(period_seconds):
    """Calculates orbital altitude from period using Kepler's 3rd law."""
    a = (MU * (period_seconds**2) / (4 * math.pi**2)) ** (1/3)
    altitude = a - R_E
    return altitude
