import numpy as np

class StateStore:
    def __init__(self, grid_size=10.0): # 10km grid cells
        self.objects = {}
        self.grid_size = grid_size
        self.grid = {} # Maps (gx, gy, gz) -> list of object IDs

    def _get_grid_key(self, pos):
        """Converts a 3D position into a grid cell coordinate."""
        return tuple((pos // self.grid_size).astype(int))

    def update_object(self, obj_id, pos, vel, timestamp, obj_type="DEBRIS", metadata=None):
        pos_np = np.array(pos)
        
        # Remove from old grid cell if it exists
        if obj_id in self.objects:
            old_key = self._get_grid_key(self.objects[obj_id]["pos"])
            if old_key in self.grid:
                self.grid[old_key].remove(obj_id)

        # Update data
        if obj_id not in self.objects:
            fuel = 50.0 if obj_type == "SATELLITE" else 0.0
            self.objects[obj_id] = {
                "id": obj_id,
                "type": obj_type,
                "fuel_kg": fuel,
                "mass_kg": 550.0 if obj_type == "SATELLITE" else 0.0,
                "metadata": metadata or {}
            }
        
        self.objects[obj_id].update({
            "pos": pos_np,
            "vel": np.array(vel),
            "timestamp": timestamp
        })

        # Add to new grid cell
        new_key = self._get_grid_key(pos_np)
        if new_key not in self.grid:
            self.grid[new_key] = []
        self.grid[new_key].append(obj_id)

store = StateStore()
def get_all_states(self):
        """Returns all objects currently in the store."""
        return self.objects