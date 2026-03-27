import time
from datetime import datetime, timedelta, timezone

class SimulationClock:
    def __init__(self, start_time=None, speed=1.0):
        self.start_time = start_time or datetime.now(timezone.utc)
        self.sim_time = self.start_time
        self.speed = speed
        self.is_paused = False
        self.elapsed_sim_seconds = 0.0
        self.last_real_time = time.time()

    def tick(self, dt_real=1.0):
        """Advances simulation time based on real time and speed factor."""
        if self.is_paused:
            self.last_real_time = time.time()
            return self.sim_time

        dt_sim = dt_real * self.speed
        self.elapsed_sim_seconds += dt_sim
        self.sim_time = self.start_time + timedelta(seconds=self.elapsed_sim_seconds)
        self.last_real_time = time.time()
        return self.sim_time

    def set_speed(self, speed):
        self.speed = max(0.0, speed)

    def pause(self):
        self.is_paused = True

    def resume(self):
        self.is_paused = False
        self.last_real_time = time.time()

    def get_state(self):
        return {
            "utc": self.sim_time.isoformat(),
            "elapsed_s": self.elapsed_sim_seconds,
            "speed": self.speed,
            "is_paused": self.is_paused
        }

# Global singleton
sim_clock = SimulationClock()
