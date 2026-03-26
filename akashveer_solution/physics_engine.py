import numpy as np

# Constants from maneuver_engine
MU = 398600.4418
R_E = 6378.137
J2 = 1.08263e-3

def calculate_orbital_energy(pos: np.ndarray, vel: np.ndarray) -> float:
    """Specific orbital energy: (v²/2) - (mu/r). Must remain constant in 2-body."""
    r = np.linalg.norm(pos)
    v = np.linalg.norm(vel)
    return (v**2 / 2.0) - (MU / r)

def recommended_dt(altitude_km: float) -> float:
    """Mission-grade dt recommendation base on altitude."""
    if altitude_km < 300: return 1.0   # Fast dynamics at low perigee
    if altitude_km < 1000: return 10.0 # Standard LEO
    return 60.0 # High altitude / MEO

def get_acceleration(pos):
    """
    Calculates the combined acceleration: 2-Body Gravity + J2 Perturbation.
    Formula source: [cite: 64, 66]
    """
    r_mag = np.linalg.norm(pos)
    x, y, z = pos

    # 1. Fundamental Keplerian Gravity [cite: 64]
    acc_kepler = -MU * pos / (r_mag**3)

    # 2. J2 Perturbation Acceleration [cite: 66]
    # Scaling factor: (3/2) * J2 * (MU * R_E^2) / r^5
    scaling = (1.5 * J2 * MU * R_E**2) / (r_mag**5)
    
    z_ratio = (z**2) / (r_mag**2)
    
    ax_j2 = x * (5 * z_ratio - 1)
    ay_j2 = y * (5 * z_ratio - 1)
    az_j2 = z * (5 * z_ratio - 3)
    
    acc_j2 = scaling * np.array([ax_j2, ay_j2, az_j2])

    return acc_kepler + acc_j2

def rk4_step(pos, vel, dt):
    """
    Propagates state forward by dt seconds using Runge-Kutta 4th Order.
    Requirement: [cite: 67]
    """
    def f(p, v):
        return v, get_acceleration(p)

    # k1
    k1v, k1a = f(pos, vel)
    # k2
    k2v, k2a = f(pos + k1v * dt/2, vel + k1a * dt/2)
    # k3
    k3v, k3a = f(pos + k2v * dt/2, vel + k2a * dt/2)
    # k4
    k4v, k4a = f(pos + k3v * dt, vel + k3a * dt)

    return pos + (dt/6.0)*(k1v + 2*k2v + 2*k3v + k4v), \
           vel + (dt/6.0)*(k1a + 2*k2a + 2*k3a + k4a)

def validate_stability(pos_initial, vel_initial, pos_final, vel_final, dt):
    """Checks for mission-grade stability: energy divergence."""
    e0 = calculate_orbital_energy(pos_initial, vel_initial)
    e1 = calculate_orbital_energy(pos_final, vel_final)
    divergence = abs((e1 - e0) / e0) if e0 != 0 else 0
    
    # Tolerant of J2 (which changes energy non-linearly), but alert on >1% drift
    if divergence > 0.01:
        return False, f"Stability Warning: Energy divergence {divergence:.4%} exceeded 1% (Check dt={dt}s)"
    return True, "Stable"

def get_eci_to_rtn_matrix(pos, vel):
    """Calculates the rotation matrix from ECI to RTN frame."""
    r_unit = pos / np.linalg.norm(pos)
    h = np.cross(pos, vel)
    n_unit = h / np.linalg.norm(h)
    t_unit = np.cross(n_unit, r_unit)
    
    # Matrix to go from RTN -> ECI
    return np.column_stack((r_unit, t_unit, n_unit))

def calculate_fuel_consumed(m_initial, dv_mag_ms):
    """
    Tsiolkovsky Rocket Equation: returns mass of fuel used.
    dv_mag_ms: Change in velocity in METERS PER SECOND.
    """
    Isp = 300.0  # seconds
    g0 = 9.80665 # m/s^2
    
    # Formula: m_final = m_initial * e^(-dv / (Isp * g0))
    # No need to convert to km/s if both dv and g0 are in m/s!
    m_final = m_initial * np.exp(-dv_mag_ms / (Isp * g0))
    return m_initial - m_final