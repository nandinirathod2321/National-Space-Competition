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
    Generates polygon points for the night side shadow overlay (Terminator Line).
    """
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except:
        dt = datetime.utcnow()
    
    # Calculate Sun position based on UTC day/time
    doy = dt.timetuple().tm_yday
    
    # 1. Sun's Declination (lat)
    fractional_year = (2 * math.pi / 365.24) * (doy - 1 + (dt.hour - 12) / 24.0)
    declination_rad = 0.006918 - \
                      0.399912 * math.cos(fractional_year) + 0.070257 * math.sin(fractional_year) - \
                      0.006758 * math.cos(2 * fractional_year) + 0.000907 * math.sin(2 * fractional_year) - \
                      0.002697 * math.cos(3 * fractional_year) + 0.00148 * math.sin(3 * fractional_year)
    declination = math.degrees(declination_rad)
    
    # 2. Sun's Longitude (lon)
    # 12:00 UTC means Sun is right over 0 longitude (approx). 1 hr = 15 deg.
    sun_lon = -15.0 * (dt.hour + dt.minute / 60.0 + dt.second / 3600.0 - 12.0)
    
    # Normalize to -180 .. 180
    sun_lon = (sun_lon + 180) % 360 - 180
    
    points = []
    
    # Prevent divide by zero error
    if abs(declination) < 0.1:
        declination = 0.1 if declination >= 0 else -0.1
        
    for lon in np.linspace(-180, 180, 180):
        # terminator equation: tan(lat) = -cot(dec) * cos(lon - sun_lon)
        # Using radians for math functions
        tan_lat = -(1.0 / math.tan(math.radians(declination))) * math.cos(math.radians(lon - sun_lon))
        lat = math.degrees(math.atan(tan_lat))
        points.append([lat, lon])
        
    # Close the polygon over the night side
    # If declination > 0, the N pole is lit, so the night shadow must cover the S pole
    if declination > 0:
        points.append([-90, 180])
        points.append([-90, -180])
    else:
        # S pole is lit, so the night shadow covers the N pole
        points.append([90, 180])
        points.append([90, -180])
    
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


def historical_ground_track(satellite_data, history_points=90, duration_seconds=5400):
    """
    Reconstructs historical ground track using backward RK4 propagation.
    
    Args:
        satellite_data: Dictionary with 'pos' and 'vel' (current state).
        history_points: Number of points to trace back.
        duration_seconds: How far back to trace (default 90 mins).
        
    Returns:
        List of ground track points ordered from oldest to newest.
    """
    from physics_engine import rk4_step
    
    track = []
    
    # Start tracing back from the current state
    r_curr = np.array(satellite_data["pos"])
    v_curr = np.array(satellite_data["vel"])
    dt = duration_seconds / history_points
    
    # We trace backward, so we integrate with -dt
    for i in range(history_points):
        # Propagate back by dt
        r_curr, v_curr = rk4_step(r_curr, v_curr, -dt)
        geo = subsatellite_point(r_curr)
        # Store in list: time goes more negative
        track.append({
            "latitude": geo["latitude"],
            "longitude": geo["longitude"],
            "altitude": geo["altitude"],
            "time_offset_seconds": -(i + 1) * dt
        })
    
    # Reverse so the list goes chronological: oldest -> newest
    track.reverse()
    
    # Add the current true point at time_offset_seconds = 0
    current_geo = subsatellite_point(satellite_data["pos"])
    track.append({
        "latitude": current_geo["latitude"],
        "longitude": current_geo["longitude"],
        "altitude": current_geo["altitude"],
        "time_offset_seconds": 0.0
    })
    
    return track
