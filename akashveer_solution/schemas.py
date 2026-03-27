from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class Vector3(BaseModel):
    x: float
    y: float
    z: float

class TelemetryObject(BaseModel):
    id: str
    type: str
    r: Vector3
    v: Vector3

class TelemetryPayload(BaseModel):
    timestamp: datetime
    objects: List[TelemetryObject]

class KeplerianElements(BaseModel):
    a: float
    e: float
    i: float
    raan: float
    arg_perigee: float
    true_anomaly: float

class KeplerianInitRequest(BaseModel):
    id: str
    keplerian: KeplerianElements
    fuel: float = 100.0   # kg
    mass: float = 400.0   # kg (dry)
    thrust_kn: float = 0.5
    isp: float = 300.0

class HohmannRequest(BaseModel):
    satellite_id: str
    target_altitude_km: float

class PlaneChangeRequest(BaseModel):
    satellite_id: str
    delta_inclination_deg: float

class PhasingRequest(BaseModel):
    satellite_id: str
    delta_altitude_km: float

class DecisionRequest(BaseModel):
    satellite_id: str
    auto_mode: bool

class ExecuteDecisionRequest(BaseModel):
    satellite_id: str
    maneuver_type: str
    dv_rtn: List[float]

# ── New v3 Models ──────────────────────────────────────────────────────────
class ClockControlRequest(BaseModel):
    speed: Optional[float] = None
    paused: Optional[bool] = None

class CommandValidateRequest(BaseModel):
    satellite_id: str
    dv_rtn: List[float]

class RTNTransformRequest(BaseModel):
    satellite_id: str
    dv_rtn: List[float]