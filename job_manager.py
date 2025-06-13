import threading
import uuid
from typing import Dict

from job import Job

class JobManager:
    """Thread-safe container for active transcription jobs."""

    def __init__(self) -> None:
        self.jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create_job(self, video_id: str) -> Job:
        job_id = str(uuid.uuid4())
        job = Job(job_id=job_id, video_id=video_id)
        with self._lock:
            self.jobs[job_id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self.jobs.get(job_id)

    def update(self, job_id: str, **fields) -> Job | None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            for key, value in fields.items():
                setattr(job, key, value)
            return job

    def increment_listeners(self, job_id: str) -> int:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return 0
            job.listeners += 1
            return job.listeners

    def remove(self, job_id: str) -> bool:
        """Delete a job from the manager."""
        with self._lock:
            return self.jobs.pop(job_id, None) is not None
