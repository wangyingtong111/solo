import time
import numpy as np
from typing import List, Optional, Dict, Tuple
from collections import deque

from src.utils import (
    Config,
    SyncedFrames,
    Frame,
    SyncBarrier,
    WorkerThread,
    ThreadSafeQueue,
    MultiTimer,
    get_logger
)
from src.capture import Camera, CameraConfig

logger = get_logger("capture")


class SyncCaptureManager:
    def __init__(self, config: Config):
        self._config = config
        self._cameras: Dict[int, Camera] = {}
        self._output_queue: Optional[ThreadSafeQueue] = None
        self._worker: Optional[WorkerThread] = None
        self._barrier: Optional[SyncBarrier] = None
        self._timer = MultiTimer()
        self._sequence_id = 0
        self._running = False
        self._target_fps = config.get("cameras.fps", 30)
        self._frame_intervals: Dict[int, deque] = {}
        self._sync_timeout_ms = config.get("cameras.sync_timeout_ms", 10)
        self._init_cameras()

    def _init_cameras(self) -> None:
        device_ids = self._config.get("cameras.device_ids", [0, 1, 2])
        resolution = tuple(self._config.get("cameras.resolution", [1920, 1080]))
        fps = self._config.get("cameras.fps", 30)
        exposure = self._config.get("cameras.exposure", -4)
        gain = self._config.get("cameras.gain", 1.0)
        white_balance = self._config.get("cameras.white_balance", 4000)
        use_gpu = self._config.get("system.gpu_enabled", True)

        for device_id in device_ids:
            cam_config = CameraConfig(
                device_id=device_id,
                resolution=resolution,
                fps=fps,
                exposure=exposure,
                gain=gain,
                white_balance=white_balance,
                use_gpu=use_gpu
            )
            self._cameras[device_id] = Camera(self._config, device_id, cam_config)
            self._frame_intervals[device_id] = deque(maxlen=30)

        self._barrier = SyncBarrier(len(self._cameras), timeout=self._sync_timeout_ms / 1000.0)

    def start(self, output_queue: ThreadSafeQueue) -> bool:
        self._output_queue = output_queue
        self._running = False

        for camera_id, camera in self._cameras.items():
            if not camera.open():
                logger.error(f"Failed to open camera {camera_id}")
                self.stop()
                return False
            time.sleep(0.1)

        self._running = True
        self._worker = WorkerThread(
            name="SyncCapture",
            task_fn=self._capture_loop,
            daemon=True
        )
        self._worker.start()

        logger.info("Sync capture manager started")
        return True

    def stop(self) -> None:
        self._running = False
        if self._worker is not None:
            self._worker.stop(wait=True, timeout=2.0)
            self._worker = None

        for camera in self._cameras.values():
            camera.close()

        logger.info("Sync capture manager stopped")

    def _capture_loop(self) -> Optional[SyncedFrames]:
        if not self._running:
            time.sleep(0.01)
            return None

        self._timer.start("capture_total")

        frames = self._capture_synced_frames()

        if len(frames) == len(self._cameras):
            avg_timestamp = sum(f.timestamp for f in frames) / len(frames)

            synced_frames = SyncedFrames(
                frames=frames,
                timestamp=avg_timestamp,
                sequence_id=self._sequence_id
            )

            self._sequence_id += 1

            if self._output_queue is not None:
                if not self._output_queue.put_nowait(synced_frames):
                    logger.debug("Capture output queue full, dropping frame")

            self._timer.stop("capture_total")

            return synced_frames

        self._timer.stop("capture_total")
        return None

    def _capture_synced_frames(self) -> List[Frame]:
        frames: Dict[int, Frame] = {}
        max_time_diff = self._sync_timeout_ms / 1000.0

        for camera_id, camera in self._cameras.items():
            if not camera.is_running:
                continue

            frame = camera.read(timeout_ms=50)
            if frame is not None:
                frames[camera_id] = frame

        if len(frames) < len(self._cameras):
            return list(frames.values())

        timestamps = [f.timestamp for f in frames.values()]
        time_range = max(timestamps) - min(timestamps)

        if time_range > max_time_diff:
            logger.debug(f"Frame sync time difference too large: {time_range*1000:.1f}ms")

        return list(frames.values())

    def _capture_with_barrier(self) -> List[Frame]:
        frames: List[Frame] = []
        grab_success = True

        for camera in self._cameras.values():
            if not camera.grab():
                grab_success = False
                logger.warning(f"Camera {camera.camera_id} grab failed")
                break

        if not grab_success:
            return frames

        for camera in self._cameras.values():
            frame = camera.retrieve()
            if frame is not None:
                frames.append(frame)

        return frames

    def set_exposure(self, exposure: int, camera_id: Optional[int] = None) -> None:
        if camera_id is not None:
            if camera_id in self._cameras:
                self._cameras[camera_id].set_exposure(exposure)
        else:
            for camera in self._cameras.values():
                camera.set_exposure(exposure)

    def set_gain(self, gain: float, camera_id: Optional[int] = None) -> None:
        if camera_id is not None:
            if camera_id in self._cameras:
                self._cameras[camera_id].set_gain(gain)
        else:
            for camera in self._cameras.values():
                camera.set_gain(gain)

    def set_white_balance(self, temperature: int, camera_id: Optional[int] = None) -> None:
        if camera_id is not None:
            if camera_id in self._cameras:
                self._cameras[camera_id].set_white_balance(temperature)
        else:
            for camera in self._cameras.values():
                camera.set_white_balance(temperature)

    def get_statistics(self) -> Dict:
        stats = {
            "sequence_id": self._sequence_id,
            "is_running": self._running,
            "num_cameras": len(self._cameras),
            "capture_fps": self._timer.fps("capture_total"),
            "avg_capture_time_ms": self._timer.average("capture_total") * 1000
        }

        camera_stats = {}
        for cam_id, camera in self._cameras.items():
            camera_stats[cam_id] = {
                "frame_count": camera.frame_count,
                "last_timestamp": camera.last_timestamp,
                **camera.get_properties()
            }
        stats["cameras"] = camera_stats

        return stats

    @property
    def cameras(self) -> Dict[int, Camera]:
        return self._cameras

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def sequence_id(self) -> int:
        return self._sequence_id

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()
