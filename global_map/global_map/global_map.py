import math
from pydantic import BaseModel
from typing import List, Dict

# ==========================================================
# 1. THE ECI GLOBAL MAP (Physical Constants)
# These define the 'laws' of your orbital universe.
# ==========================================================
class ECIConstants:
    MU = 398600.4418      # Earth's gravitational parameter (km^3/s^2)
    R_E = 6378.137        # Earth's equatorial radius (km)
    J2 = 1.08263e-3       # J2 perturbation constant (Earth's bulge)
    COLLISION_THRESHOLD = 0.100  # 100 meters in kilometers

# ==========================================================
# 2. THE OBJECT DATA MODEL (State Vectors)
# This is how a Digital Twin is represented in ECI.
# ==========================================================
class Vector3D(BaseModel):
    x: float
    y: float
    z: float

class SpaceObject(BaseModel):
    id: str
    type: str  # "SATELLITE" or "DEBRIS"
    r: Vector3D  # Position vector in ECI (km)
    v: Vector3D  # Velocity vector in ECI (km/s)
    fuel_kg: float = 50.0  # Default fuel for satellites

# ==========================================================
# 3. THE GLOBAL REGISTRY (Integrating the Map)
# This class merges all data into one searchable 'Map'.
# ==========================================================
class GlobalMap:
    def _init_(self):
        # The 'Live Map' - A dictionary for O(1) lookup
        self.registry: Dict[str, SpaceObject] = {}

    def update_from_telemetry(self, timestamp: str, objects_list: List[SpaceObject]):
        """Integrates incoming API data into the Global Map."""
        for obj in objects_list:
            # This 'integrates' debris and satellites into the same ECI frame
            self.registry[obj.id] = obj
        print(f"[{timestamp}] Map Updated: {len(self.registry)} objects in ECI frame.")

    def calculate_distance(self, id1: str, id2: str) -> float:
        """Calculates distance between two objects on the ECI map."""
        o1 = self.registry[id1].r
        o2 = self.registry[id2].r
        
        # Euclidean distance formula in 3D ECI space
        return math.sqrt(
            (o1.x - o2.x)**2 + 
            (o1.y - o2.y)**2 + 
            (o1.z - o2.z)**2
        )

# ==========================================================
# INITIALIZATION
# ==========================================================
# Create the single instance of your Global Map
acm_global_map = GlobalMap()

