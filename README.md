# Akashveer Telemetry Dashboard & Physics Engine 🚀

Welcome to the **Akashveer Telemetry & Space Situational Awareness (SSA)** solution. This project is a complete simulation and dashboard environment built to track satellites, monitor space debris, manage telemetry streams, calculate orbital mechanics, and display everything beautifully using a WebGL-powered 3D globe.

---

## 📸 Overview

The **Akashveer** system is divided into two major layers:
1. **Python / FastAPI Backend (`akashveer_solution/`)**: 
   - A highly-accurate simulation engine running numerical propagators (RK4).
   - Collision analysis, autonomous orbital maneuvers (Hoohman Transfers), telemetry ingesting via WebSockets, and ground track simulation.
2. **React / Three.js Frontend (`telemetry_dashboard/` & `akashveer_solution/frontend/`)**: 
   - Uses `Three.js` for 3D orbital visualization around the Earth and `Pixi.js` for highly efficient 2D HUD components.
   - Provides a detailed interface for monitoring Satellite Fleet performance, Energy metrics, and Ground Stations.

---

## 🛠 Features

- **High-Accuracy Orbit Propagation**: Uses custom physics engines with J2 perturbations.
- **Autonomous Collision Avoidance (COLA)**: Evaluates threats dynamically and conducts burns if safety thresholds drop.
- **WebSocket Telemetry Piping**: Real-time simulation ticks pushed out to the 3D map at high frequency.
- **Maneuver Engine**: Re-calculate and propagate RTN (Radial, Transverse, Normal) transform matrices for Delta-V burns.
- **Ground Track Map**: Live Subsatellite point projection over a 2D map with terminator line simulation.
- **Premium Aesthetics**: Dark mode, neo-cyberpunk, glassmorphism design.

---

## ⚙️ Project Structure

- **`akashveer_solution/`** (Backend Physics & API Engine)
    - `main.py`: The entry point for the FastAPI server, WebSocket hubs, and route definitions.
    - `physics_engine.py`: Core numerical integration, RK4 step execution, and energy/momentum checks.
    - `orbital_mechanics.py`: Conversions between state vectors (ECI -> Keplerian elements) and Hoohman burns.
    - `conjunction_analysis.py`: Proximity checks across spatial grids to identify satellite/debris threats.
    - `telemetry_manager.py`: Ensures validity and persistence of telemetry payloads pinging from the fleet.
    - `ground_station_engine.py`: Line-of-sight checks and simulated RF uplink logic to terrestrial nodes.

- **`telemetry_dashboard/`** (React Web App)
    - `src/components/OrbitView.jsx`: High-performance canvas map and camera logic.
    - `src/components/TelemetryPanel.jsx`: Live data feeds mapped from WebSocket.
    - `src/components/StabilityPanel.jsx`: Visual charts on orbital stability, energy errors, etc.

---

## 🚀 Getting Started

### 1. Start the Backend Simulation Server
```bash
cd akashveer_solution
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Start the Mission Control Frontend
*(If running the advanced React Interface)*
```bash
cd telemetry_dashboard
npm install
npm run dev
```
*(If running the built-in Three.js Demo Dashboard)*
- The FastAPI backend serves the `frontend/` directory statically at `http://localhost:8000`

---

## 🧩 Architectural Highlights

### SpaceObject State Array (Example)
Objects within the backend store are managed as N-Dimensional vectors representing their ECI framework position and velocity vectors:
```json
{
  "SAT_1": {
    "type": "SATELLITE",
    "pos": [1400.1, 4000.4, 6300.2],
    "vel": [1.5, -4.2, 3.8],
    "fuel_kg": 49.5,
    "mass_kg": 500.0,
    "timestamp": "2026-03-27T10:00:00Z"
  }
}
```

### Autonomous Avoidance Flow (Code Snippet)
```python
# from main.py -> autonomous_cola()
dist = np.linalg.norm(current_pos - store.objects[other_id]["pos"])
if dist < 0.1:  # 100 meter threshold
    # Plan a 5 m/s Transverse burn (Efficient avoidance)
    dv_rtn = np.array([0, 0.005, 0])  # 5 m/s = 0.005 km/s
    rot_matrix = get_eci_to_rtn_matrix(current_pos, current_vel)
    dv_eci = rot_matrix @ dv_rtn
    sat["vel"] = current_vel + dv_eci
```

---

*This repository contains the complete mission solution code developed for the National Space Competition.*
