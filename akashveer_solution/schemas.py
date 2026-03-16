from pydantic import BaseModel
from typing import List
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