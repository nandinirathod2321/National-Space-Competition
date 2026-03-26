"""
Orbital Maneuver & Collision Avoidance Engine
=============================================
Physics: RK4 propagation + J2 perturbation
Fuel:    Tsiolkovsky Rocket Equation (Isp = 300s)
Frames:  ECI (km, km/s) | RTN (Radial-Transverse-Normal)
COLA:    Spatial grid + 24-hour forward scan
"""

import numpy as np
import math
from typing import Optional, Dict, List, Tuple
import time

# ─── Physical Constants ────────────────────────────────────────────────────────
MU    = 398600.4418     # km³/s²
R_E   = 6378.137        # km
J2    = 1.08263e-3
ISP   = 300.0           # s  (specific impulse)
G0    = 9.80665 / 1000  # km/s² (standard gravity)
DRY_MASS  = 500.0       # kg
FUEL_INIT = 50.0        # kg
COOLDOWN_S = 600        # s between burns
CMD_DELAY_S = 10        # s uplink delay

# Station-keeping slot tolerance
SLOT_TOLERANCE_KM = 10.0

# Collision avoidance threshold
COLA_THRESHOLD_KM = 0.1   # 100 m

# Ground stations (lat, lon, min_elevation_deg)
GROUND_STATIONS = [
    {"id": "GS-INDIA",   "lat":  13.0, "lon":  77.6, "min_el": 5.0},
    {"id": "GS-USA",     "lat":  28.5, "lon": -80.6, "min_el": 5.0},
    {"id": "GS-EUROPE",  "lat":  52.5, "lon":  13.4, "min_el": 5.0},
    {"id": "GS-PACIFIC", "lat": -33.9, "lon": 151.2, "min_el": 5.0},
]


# ─── Maneuver Schedule Store ───────────────────────────────────────────────────
class ManeuverSchedule:
    """Thread-safe (GIL) store for queued, executing, and completed maneuvers."""

    def __init__(self):
        self.scheduled:  List[dict] = []   # queued burns
        self.history:    List[dict] = []   # completed burns
        self.cooldowns:  Dict[str, float] = {}  # sat_id → unix_ts of last burn
        self.slots:      Dict[str, dict]  = {}  # sat_id → {pos, vel} nominal slot
        self.sim_time:   float = 0.0       # cumulative simulation time (seconds)

    def can_execute(self, sat_id: str) -> Tuple[bool, str]:
        last = self.cooldowns.get(sat_id, 0.0)
        elapsed = self.sim_time - last
        if elapsed < COOLDOWN_S:
            remaining = COOLDOWN_S - elapsed
            return False, f"Cooldown active: {remaining:.0f}s remaining"
        return True, "OK"

    def record_burn(self, sat_id: str):
        self.cooldowns[sat_id] = self.sim_time

    def advance_time(self, dt: float):
        self.sim_time += dt

    def set_nominal_slot(self, sat_id: str, pos: np.ndarray, vel: np.ndarray):
        self.slots[sat_id] = {"pos": pos.copy(), "vel": vel.copy()}

    def slot_deviation_km(self, sat_id: str, current_pos: np.ndarray) -> Optional[float]:
        if sat_id not in self.slots:
            return None
        nominal = self.slots[sat_id]["pos"]
        return float(np.linalg.norm(current_pos - nominal))


schedule_store = ManeuverSchedule()


# ─── Physics Utilities ─────────────────────────────────────────────────────────

def _acceleration(pos: np.ndarray) -> np.ndarray:
    """Two-body + J2 acceleration (ECI, km/s²)."""
    r = np.linalg.norm(pos)
    x, y, z = pos
    a_kep = -MU * pos / r**3
    s = (1.5 * J2 * MU * R_E**2) / r**5
    zr = (z / r)**2
    a_j2 = s * np.array([x*(5*zr-1), y*(5*zr-1), z*(5*zr-3)])
    return a_kep + a_j2


def rk4_propagate(pos: np.ndarray, vel: np.ndarray, dt: float) -> Tuple[np.ndarray, np.ndarray]:
    """Single RK4 step."""
    def deriv(p, v):
        return v, _acceleration(p)
    k1v, k1a = deriv(pos, vel)
    k2v, k2a = deriv(pos + k1v*dt/2, vel + k1a*dt/2)
    k3v, k3a = deriv(pos + k2v*dt/2, vel + k2a*dt/2)
    k4v, k4a = deriv(pos + k3v*dt,   vel + k3a*dt)
    new_pos = pos + (dt/6)*(k1v + 2*k2v + 2*k3v + k4v)
    new_vel = vel + (dt/6)*(k1a + 2*k2a + 2*k3a + k4a)
    return new_pos, new_vel


def rtn_to_eci_matrix(pos: np.ndarray, vel: np.ndarray) -> np.ndarray:
    """Rotation matrix columns: R̂, T̂, N̂  →  ECI.  (RTN→ECI, multiply dv_rtn)"""
    r_hat = pos / np.linalg.norm(pos)
    h = np.cross(pos, vel)
    n_hat = h / np.linalg.norm(h)
    t_hat = np.cross(n_hat, r_hat)
    return np.column_stack((r_hat, t_hat, n_hat))


# ─── Tsiolkovsky Fuel ──────────────────────────────────────────────────────────

def fuel_for_dv(dv_kms: float, m_total_kg: float) -> float:
    """Propellant mass required for Δv (km/s) from Tsiolkovsky equation."""
    m_final = m_total_kg * math.exp(-dv_kms / (ISP * G0))
    return m_total_kg - m_final


def dv_for_fuel(fuel_kg: float, m_total_kg: float) -> float:
    """Maximum Δv achievable given available fuel."""
    return ISP * G0 * math.log(m_total_kg / (m_total_kg - fuel_kg + 1e-9))


# ─── Orbital Elements ─────────────────────────────────────────────────────────

def state_to_elements(pos: np.ndarray, vel: np.ndarray) -> dict:
    r = np.linalg.norm(pos)
    v = np.linalg.norm(vel)
    energy = v**2/2 - MU/r
    a = -MU/(2*energy)
    h_vec = np.cross(pos, vel)
    h = np.linalg.norm(h_vec)
    e_vec = ((v**2 - MU/r)*pos - np.dot(pos, vel)*vel) / MU
    e = np.linalg.norm(e_vec)
    inc = math.acos(np.clip(h_vec[2]/h, -1, 1))
    n_vec = np.array([-h_vec[1], h_vec[0], 0.0])
    n = np.linalg.norm(n_vec)
    raan = 0.0
    if n > 1e-10:
        raan = math.acos(np.clip(n_vec[0]/n, -1, 1))
        if n_vec[1] < 0: raan = 2*math.pi - raan
    altitude_km = a*(1-e) - R_E
    period_s = 2*math.pi*math.sqrt(a**3/MU)
    return {
        "a_km": float(a),
        "e": float(e),
        "inc_deg": float(math.degrees(inc)),
        "raan_deg": float(math.degrees(raan)),
        "altitude_km": float(altitude_km),
        "period_min": float(period_s/60),
        "speed_kms": float(v),
    }


# ─── Ground-Station Line-of-Sight ──────────────────────────────────────────────

def _eci_to_geodetic(pos: np.ndarray) -> Tuple[float, float, float]:
    """Convert ECI position to (lat_deg, lon_deg, alt_km) — simplified sphere."""
    r = np.linalg.norm(pos)
    lat = math.degrees(math.asin(np.clip(pos[2]/r, -1, 1)))
    lon = math.degrees(math.atan2(pos[1], pos[0]))
    alt = r - R_E
    return lat, lon, alt


def ground_station_los(pos: np.ndarray) -> List[dict]:
    """Returns list of ground stations with line-of-sight to satellite."""
    sat_lat, sat_lon, sat_alt = _eci_to_geodetic(pos)
    visible = []
    for gs in GROUND_STATIONS:
        # Spherical great-circle angle
        dlat = math.radians(sat_lat - gs["lat"])
        dlon = math.radians(sat_lon - gs["lon"])
        a = math.sin(dlat/2)**2 + math.cos(math.radians(gs["lat"]))*math.cos(math.radians(sat_lat))*math.sin(dlon/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        gc_angle_rad = c
        # Elevation angle approximation
        if sat_alt > 0 and R_E > 0:
            el = math.degrees(math.atan2(math.cos(gc_angle_rad) - R_E/(R_E+sat_alt), math.sin(gc_angle_rad)))
        else:
            el = -90
        if el >= gs["min_el"]:
            visible.append({"gs_id": gs["id"], "elevation_deg": round(el, 2)})
    return visible


# ─── Collision Prediction (Spatial Grid) ──────────────────────────────────────

class SpatialGrid:
    """Lightweight spatial hash grid for O(1) neighbor lookup."""
    CELL = 50.0  # km – coarse pass

    def __init__(self):
        self.cells: Dict[tuple, List[str]] = {}
        self.states: Dict[str, dict] = {}

    def _key(self, pos: np.ndarray) -> tuple:
        return tuple((pos // self.CELL).astype(int))

    def update(self, obj_id: str, pos: np.ndarray, vel: np.ndarray, obj_type: str):
        old = self.states.get(obj_id)
        if old is not None:
            ok = self._key(old["pos"])
            if ok in self.cells and obj_id in self.cells[ok]:
                self.cells[ok].remove(obj_id)
        self.states[obj_id] = {"pos": pos.copy(), "vel": vel.copy(), "type": obj_type}
        nk = self._key(pos)
        self.cells.setdefault(nk, []).append(obj_id)

    def candidates(self, pos: np.ndarray, n: int = 1) -> List[str]:
        """Return IDs in surrounding n-radius cells."""
        base = self._key(pos)
        result = []
        for dx in range(-n, n+1):
            for dy in range(-n, n+1):
                for dz in range(-n, n+1):
                    result.extend(self.cells.get((base[0]+dx,base[1]+dy,base[2]+dz), []))
        return result


spatial_grid = SpatialGrid()


def predict_conjunction(
    sat_id: str,
    sat_pos: np.ndarray,
    sat_vel: np.ndarray,
    all_objects: dict,
    hours: float = 24.0,
    step_s: float = 60.0,
) -> List[dict]:
    """
    Propagate satellite + nearby objects forward and find minimum approach distances.
    Uses spatial grid for candidate filtering, then numerical propagation for verification.
    Returns sorted list of conjunctions.
    """
    results = []
    steps = int(hours * 3600 / step_s)

    # Build trajectory for the satellite
    sat_traj = [(sat_pos.copy(), sat_vel.copy())]
    p, v = sat_pos.copy(), sat_vel.copy()
    for _ in range(steps):
        p, v = rk4_propagate(p, v, step_s)
        sat_traj.append((p.copy(), v.copy()))

    # Get spatial candidates at t=0
    candidates = spatial_grid.candidates(sat_pos, n=2)

    for other_id in set(candidates):
        if other_id == sat_id or other_id not in all_objects:
            continue
        obj = all_objects[other_id]
        op = np.array(obj["pos"])
        ov = np.array(obj["vel"])

        min_dist = np.inf
        min_t = 0.0
        op_c, ov_c = op.copy(), ov.copy()

        for ti, (sp_c, _) in enumerate(sat_traj):
            dist = np.linalg.norm(sp_c - op_c)
            if dist < min_dist:
                min_dist = dist
                min_t = ti * step_s
            op_c, ov_c = rk4_propagate(op_c, ov_c, step_s)

        if min_dist < 200.0:  # Only report < 200 km
            risk = "red" if min_dist < 1.0 else "yellow" if min_dist < 5.0 else "green"
            results.append({
                "object_id": other_id,
                "object_type": obj.get("type", "DEBRIS"),
                "min_distance_km": round(min_dist, 4),
                "time_to_ca_s": round(min_t, 1),
                "risk": risk,
                "critical": min_dist < COLA_THRESHOLD_KM,
            })

    results.sort(key=lambda x: x["min_distance_km"])
    return results


# ─── COLA Delta-V Computation ─────────────────────────────────────────────────

def compute_avoidance_dv(
    sat_pos: np.ndarray,
    sat_vel: np.ndarray,
    threat_pos: np.ndarray,
    threat_vel: np.ndarray,
    dv_budget_kms: float = 0.05,
) -> np.ndarray:
    """
    Compute minimal Δv in RTN frame to avoid collision.
    Prefers prograde/retrograde burn (Transverse); uses Normal only if needed.
    Returns dv_eci (km/s).
    """
    R = rtn_to_eci_matrix(sat_pos, sat_vel)

    # Try transverse (T) direction – most fuel-efficient avoidance
    for sign in [+1, -1]:
        dv_rtn = np.array([0.0, sign * dv_budget_kms, 0.0])
        dv_eci = R @ dv_rtn
        new_vel = sat_vel + dv_eci
        # Quick check: does it increase miss distance at t=0?
        rel = threat_pos - sat_pos
        rel_v_old = threat_vel - sat_vel
        rel_v_new = threat_vel - new_vel
        # If closing velocity decreases, this direction is good
        if np.dot(rel, rel_v_new) > np.dot(rel, rel_v_old):
            return dv_eci

    # Fall back: radial burn
    dv_rtn = np.array([dv_budget_kms, 0.0, 0.0])
    return R @ dv_rtn


# ─── Smart Orbit Scoring ──────────────────────────────────────────────────────

def score_candidate_orbit(
    target_alt_km: float,
    sat_pos: np.ndarray,
    sat_vel: np.ndarray,
    all_objects: dict,
    sat_id: str,
    current_fuel_kg: float,
    current_mass_kg: float,
) -> dict:
    """
    Evaluates a candidate target altitude for:
      1. Fuel cost (Hohmann Δv)
      2. Collision risk in new orbit
      3. Debris cluster density

    Returns score dict.
    """
    r_current = np.linalg.norm(sat_pos)
    r_target = R_E + target_alt_km
    a_transfer = (r_current + r_target) / 2

    v_circ_cur = math.sqrt(MU / r_current)
    v_trans_1  = math.sqrt(MU * (2/r_current - 1/a_transfer))
    dv1 = abs(v_trans_1 - v_circ_cur)

    v_circ_tgt = math.sqrt(MU / r_target)
    v_trans_2  = math.sqrt(MU * (2/r_target - 1/a_transfer))
    dv2 = abs(v_circ_tgt - v_trans_2)

    dv_total = dv1 + dv2
    fuel_needed = fuel_for_dv(dv_total, current_mass_kg)
    feasible = fuel_needed <= current_fuel_kg

    # Debris density at target altitude
    debris_nearby = 0
    for oid, obj in all_objects.items():
        if oid == sat_id:
            continue
        alt = np.linalg.norm(np.array(obj["pos"])) - R_E
        if abs(alt - target_alt_km) < 20.0:
            debris_nearby += 1

    fuel_score   = 1.0 - min(dv_total / 2.0, 1.0)      # lower Δv = higher score
    safety_score = 1.0 / (1.0 + debris_nearby * 0.1)   # fewer debris = higher score
    total_score  = 0.4*fuel_score + 0.6*safety_score

    return {
        "target_alt_km": target_alt_km,
        "dv_total_kms": round(dv_total, 5),
        "dv1_kms": round(dv1, 5),
        "dv2_kms": round(dv2, 5),
        "fuel_required_kg": round(fuel_needed, 3),
        "fuel_feasible": feasible,
        "debris_nearby": debris_nearby,
        "fuel_score": round(fuel_score, 3),
        "safety_score": round(safety_score, 3),
        "total_score": round(total_score, 3),
    }


def recommend_orbits(
    sat_id: str,
    sat_pos: np.ndarray,
    sat_vel: np.ndarray,
    current_fuel_kg: float,
    current_mass_kg: float,
    all_objects: dict,
    candidates_km: Optional[List[float]] = None,
) -> List[dict]:
    """Return scored candidate orbits, best first."""
    if candidates_km is None:
        r_cur = np.linalg.norm(sat_pos) - R_E
        candidates_km = [r_cur + d for d in [-50,-30,-10,0,10,20,30,50,75,100] if r_cur+d > 200]

    scored = [
        score_candidate_orbit(alt, sat_pos, sat_vel, all_objects, sat_id, current_fuel_kg, current_mass_kg)
        for alt in candidates_km
    ]
    scored = [s for s in scored if s["fuel_feasible"]]
    scored.sort(key=lambda x: -x["total_score"])
    return scored


# ─── Station-Keeping ──────────────────────────────────────────────────────────

def check_station_keeping(sat_id: str, current_pos: np.ndarray) -> dict:
    dev = schedule_store.slot_deviation_km(sat_id, current_pos)
    if dev is None:
        return {"has_slot": False}
    out_of_slot = dev > SLOT_TOLERANCE_KM
    return {
        "has_slot": True,
        "deviation_km": round(dev, 3),
        "out_of_slot": out_of_slot,
        "status": "OUT_OF_SLOT" if out_of_slot else "NOMINAL",
    }


def station_keeping_dv(
    sat_pos: np.ndarray,
    sat_vel: np.ndarray,
    nominal_pos: np.ndarray,
    nominal_vel: np.ndarray,
) -> np.ndarray:
    """Compute small corrective Δv to return toward nominal slot (tangential correction)."""
    R = rtn_to_eci_matrix(sat_pos, sat_vel)
    # Difference in altitude → radial correction
    dr = np.linalg.norm(nominal_pos) - np.linalg.norm(sat_pos)
    # Proportional radial burn (very gentle)
    dv_r = np.clip(dr * 0.001, -0.005, 0.005)  # max 5 m/s radial
    dv_rtn = np.array([dv_r, 0.0, 0.0])
    return R @ dv_rtn


# ─── Apply Impulse Burn ────────────────────────────────────────────────────────

def apply_rtn_burn(
    sat: dict,
    dv_r: float,
    dv_t: float,
    dv_n: float,
    check_los: bool = True,
    check_cooldown: bool = True,
    sat_id: str = "",
) -> dict:
    """
    Apply impulsive burn in RTN frame.
    dv_r, dv_t, dv_n in km/s.
    Returns result dict with updated state or error.
    """
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])
    fuel = sat.get("fuel_kg", 0.0)
    mass = sat.get("mass_kg", DRY_MASS + fuel)

    dv_rtn = np.array([dv_r, dv_t, dv_n])
    dv_mag = float(np.linalg.norm(dv_rtn))

    if dv_mag < 1e-9:
        return {"status": "ERROR", "reason": "Zero Δv requested"}

    # ── Cooldown check ────────────────────────────────────────
    if check_cooldown and sat_id:
        ok, msg = schedule_store.can_execute(sat_id)
        if not ok:
            return {"status": "REJECTED", "reason": msg}

    # ── LOS check ────────────────────────────────────────────
    los = ground_station_los(pos)
    if check_los and len(los) == 0:
        return {"status": "REJECTED", "reason": "No ground-station LOS – uplink unavailable"}

    # ── Fuel check ───────────────────────────────────────────
    fuel_needed = fuel_for_dv(dv_mag, mass)
    if fuel_needed > fuel:
        max_dv = dv_for_fuel(fuel, mass)
        return {
            "status": "REJECTED",
            "reason": f"Insufficient fuel: need {fuel_needed:.3f} kg, have {fuel:.3f} kg",
            "max_dv_possible_kms": round(max_dv, 5),
            "fuel_available_kg": round(fuel, 3),
        }

    # ── Apply burn (impulsive – position unchanged) ───────────
    R = rtn_to_eci_matrix(pos, vel)
    dv_eci = R @ dv_rtn
    new_vel = vel + dv_eci
    new_fuel = fuel - fuel_needed
    new_mass = mass - fuel_needed

    sat["vel"] = new_vel
    sat["fuel_kg"] = max(0.0, new_fuel)
    sat["mass_kg"] = max(DRY_MASS, new_mass)

    if sat_id:
        schedule_store.record_burn(sat_id)

    eol_warning = (new_fuel / FUEL_INIT * 100) < 5.0

    return {
        "status": "EXECUTED",
        "dv_rtn_kms": dv_rtn.tolist(),
        "dv_eci_kms": dv_eci.tolist(),
        "dv_mag_kms": round(dv_mag, 6),
        "fuel_burned_kg": round(fuel_needed, 4),
        "fuel_remaining_kg": round(new_fuel, 4),
        "fuel_percent": round(new_fuel / FUEL_INIT * 100, 2),
        "eol_warning": eol_warning,
        "new_velocity_kms": new_vel.tolist(),
        "los_stations": los,
        "orbital_elements": state_to_elements(pos, new_vel),
    }


def apply_eci_burn(
    sat: dict,
    dv_x: float,
    dv_y: float,
    dv_z: float,
    sat_id: str = "",
    check_los: bool = True,
    check_cooldown: bool = True,
) -> dict:
    """Apply impulsive burn in ECI frame (km/s)."""
    pos = np.array(sat["pos"])
    vel = np.array(sat["vel"])

    # Convert ECI dv → RTN for unified path
    dv_eci = np.array([dv_x, dv_y, dv_z])
    R = rtn_to_eci_matrix(pos, vel)
    dv_rtn = R.T @ dv_eci   # inverse rotation

    return apply_rtn_burn(
        sat, float(dv_rtn[0]), float(dv_rtn[1]), float(dv_rtn[2]),
        check_los=check_los, check_cooldown=check_cooldown, sat_id=sat_id
    )
