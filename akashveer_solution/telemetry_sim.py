"""
Akashveer Telemetry Simulator
-----------------------------
Simulates real-time satellite telemetry streams (1Hz - 5Hz).
Broadcasts position, velocity, and fuel state to the FastAPI backend.
"""

import requests
import json
import time
import math
import random
import sys

# Configuration
API_URL = "http://localhost:8000/api/telemetry/v1"
FREQ_HZ = 2.0  # Updates per second per satellite

def get_fleet_from_api():
    """Fetches list of satellite IDs from the backend."""
    try:
        # Try both /api/states and /api/objects for compatibility
        resp = requests.get("http://localhost:8000/api/states", timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            return [obj["id"] for obj in data.get("objects", []) if obj.get("type") == "SATELLITE"]
    except Exception as e:
        print(f"⚠️ Could not fetch fleet from API: {e}")
    return ["SAT-001", "SAT-002", "SAT-003"] # Fallback samples

# Orbital parameters (simulated)
ALT_KM = 500.0
EARTH_R = 6378.137
G = 3.986004418e5  # km^3/s^2

class SatSim:
    def __init__(self, sat_id):
        self.id = sat_id
        # Random initial phase
        self.phase = random.uniform(0, 2*math.pi)
        self.alt = ALT_KM + random.uniform(-10, 10)
        self.inc = random.uniform(0, 98) * math.pi / 180
        self.fuel = 50.0 # kg
        
        # Calculate circular velocity
        self.r_mag = self.alt + EARTH_R
        self.v_mag = math.sqrt(G / self.r_mag)
        
        # Orbital period
        self.period = 2 * math.pi * math.sqrt(self.r_mag**3 / G)
        self.omega = 2 * math.pi / self.period

    def step(self, dt):
        self.phase += self.omega * dt
        # Simple circular orbit projection
        x = self.r_mag * math.cos(self.phase)
        y = self.r_mag * math.sin(self.phase) * math.cos(self.inc)
        z = self.r_mag * math.sin(self.phase) * math.sin(self.inc)
        
        # Velocity vector (perpendicular to position)
        vx = -self.v_mag * math.sin(self.phase)
        vy =  self.v_mag * math.cos(self.phase) * math.cos(self.inc)
        vz =  self.v_mag * math.cos(self.phase) * math.sin(self.inc)
        
        # Jitter for realism
        x += random.uniform(-0.05, 0.05)
        y += random.uniform(-0.05, 0.05)
        z += random.uniform(-0.05, 0.05)
        
        # Slow fuel consumption
        self.fuel -= 0.0001 * dt
        
        return {
            "satellite_id": self.id,
            "timestamp": time.time(),
            "position": [x, y, z],
            "velocity": [vx, vy, vz],
            "fuel": max(0.0, self.fuel)
        }

def run_simulation():
    fleet = get_fleet_from_api()
    print(f"🚀 Initializing telemetry stream for {len(fleet)} satellites...")
    print(f"📡 Target: {API_URL} @ {FREQ_HZ}Hz")
    
    sims = [SatSim(sid) for sid in fleet]
    last_time = time.time()
    
    try:
        while True:
            now = time.time()
            dt = now - last_time
            last_time = now
            
            for sim in sims:
                payload = sim.step(dt)
                try:
                    response = requests.post(API_URL, json=payload, timeout=0.1)
                    if response.status_code != 200:
                        print(f"[{sim.id}] Error {response.status_code}: {response.text}")
                except Exception as e:
                    pass # Silently ignore occasional connection errors
            
            # Throttle
            sleep_time = max(0, (1.0 / FREQ_HZ) - (time.time() - now))
            time.sleep(sleep_time)
            
            # Print status every 5 seconds
            if int(now) % 5 == 0 and int(now) != int(now - dt):
                print(f"🛰️ Streaming... T={now:.0f} | Count={len(sims)} | Rate={FREQ_HZ}Hz")
                
    except KeyboardInterrupt:
        print("\n🛑 Telemetry simulation stopped.")

if __name__ == "__main__":
    run_simulation()
