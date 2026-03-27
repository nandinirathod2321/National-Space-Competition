import numpy as np

# Exact constants from the Problem Statement [cite: 65, 67]
MU = 398600.4418      # km^3/s^2
R_E = 6378.137        # km
J2 = 1.08263e-3       # J2 coefficient

def get_total_acceleration(pos):
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
        return v, get_total_acceleration(p)

    # k1
    kv1, ka1 = f(pos, vel)
    # k2
    kv2, ka2 = f(pos + kv1 * dt/2, vel + ka1 * dt/2)
    # k3
    kv3, ka3 = f(pos + kv2 * dt/2, vel + ka2 * dt/2)
    # k4
    kv4, ka4 = f(pos + kv3 * dt, vel + ka3 * dt)

    new_pos = pos + (dt/6.0) * (kv1 + 2*kv2 + 2*kv3 + kv4)
    new_vel = vel + (dt/6.0) * (ka1 + 2*ka2 + 2*ka3 + ka4)

    return new_pos, new_vel

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