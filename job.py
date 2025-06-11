from dataclasses import dataclass, asdict
from typing import Optional

@dataclass
class Job:
    """State of a transcription job."""

    job_id: str
    video_id: str
    status: str = "queued"
    transcript: Optional[str] = None
    error: Optional[str] = None
    listeners: int = 1
    killed: bool = False

    def to_dict(self):
        return asdict(self)
