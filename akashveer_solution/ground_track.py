"""
Ground track and visibility analysis utilities.
Converts ECI coordinates to geographic and manages orbit predictions.
"""

import numpy as np
import math
from datetime import datetime, timedelta

# Constants
R_E = 6378.137  # Earth radius in km
MU = 398600.4418  # Earth gravitational parameter

def eci_to_geodetic(r_eci):
    """
    Converts ECI position vector to Geodetic coordinates (latitude, longitude, altitude).
    Uses iterative algorithm for precision.
    
    Args:
        r_eci: Position vector in ECI [x, y, z] km
    
    Returns:
        {lat_deg, lon_deg, alt_km}
    """
    x, y, z = r_eci
    
    # Initial estimates
    p = np.sqrt(x**2 + y**2)
    lat = np.arctan2(z, p * (1 - 0.00335281))  # Flattening coefficient
    
    # Iterative refinement (WGS84)
    e2 = 0.00669438  # First eccentricity squared
    for _ in range(3):
        N = R_E / np.sqrt(1 - e2 * np.sin(lat)**2)
        alt = p / np.cos(lat) - N
        lat = np.arctan2(z, p * (1 - e2 * N / (N + alt)))
    
    N = R_E / np.sqrt(1 - e2 * np.sin(lat)**2)
    alt = p / np.cos(lat) - N
    lon = np.arctan2(y, x)
    
    return {
        "lat_deg": float(np.degrees(lat)),
        "lon_deg": float(np.degrees(lon)),
        "alt_km": float(alt)
    }


def subsatellite_point(r_eci):
    """
    Returns the ground track point (sub-satellite point) on Earth's surface.
    """
    geo = eci_to_geodetic(r_eci)
    return {
        "latitude": geo["lat_deg"],
        "longitude": geo["lon_deg"],
        "altitude": geo["alt_km"]
    }


def terminator_line(timestamp):
    """
    Generates points along the terminator line (day/night boundary).
    
    Args:
        timestamp: ISO timestamp string
    
    Returns:
        List of [lat, lon] points tracing the terminator
    """
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except:
        dt = datetime.now()
    
    # Simplified terminator: perpendicular to sun direction
    # Sun's declination depends on day of year
    doy = dt.timetuple().tm_yday
    declination = 23.44 * np.sin(np.radians((doy - 81) * 360 / 365.25))
    
    points = []
    for lon in np.linspace(-180, 180, 72):
        # Terminator roughly at lat = -declination
        lat = -declination + 10 * np.sin(np.radians(lon / 5))
        points.append([lat, lon])
    
    return points


def predict_ground_track(r, v, duration_seconds=5400, steps=90):
    """
    Predicts satellite ground track for the next duration_seconds.
    
    Args:
        r: Current position [km]
        v: Current velocity [km/s]
        duration_seconds: Prediction duration (default 90 minutes)
        steps: Number of prediction points
    
    Returns:
        List of ground track points: [{lat, lon, alt, time_offset_sec}, ...]
    """
    from physics_engine import rk4_step
    
    track = []
    r_curr = np.array(r)
    v_curr = np.array(v)
    dt = duration_seconds / steps
    
    for i in range(steps):
        geo = subsatellite_point(r_curr)
        track.append({
            "latitude": geo["latitude"],
            "longitude": geo["longitude"],
            "altitude": geo["altitude"],
            "time_offset_seconds": i * dt
        })
        
        r_curr, v_curr = rk4_step(r_curr, v_curr, dt)
    
    return track


def historical_ground_track(satellite_data, history_points=90):
    """
    Reconstructs historical ground track from satellite data.
    For now returns current position repeated (would use database in production).
    """
    geo = subsatellite_point(satellite_data["pos"])
    track = []
    
    # In real system: retrieve from time-series database
    # For now: single point
    for i in range(history_points):
        track.append({
            "latitude": geo["latitude"],
            "longitude": geo["longitude"],
            "altitude": geo["altitude"],
            "time_offset_seconds": -(history_points - i) * 60  # Negative = past
        })
    
    return track
