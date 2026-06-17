import time
import numpy as np
import cv2
from typing import Optional, Tuple, Dict, Any
from dataclasses import dataclass

from src.utils import (
    Config,
    CameraIntrinsic,
    CameraExtrinsic,
    Frame,
    get_logger
)

logger = get_logger("capture")


@dataclass
class CameraConfig:
    device_id: int
    resolution: Tuple[int, int] = (1920, 1080)
    fps: int = 30
    exposure: int = -4
    gain: float = 1.0
    white_balance: int = 4000
    use_gpu: bool = True


class Camera:
    def __init__(self, config: Config, camera_id: int, camera_config: Optional[CameraConfig]):
        self._config = config
        self._camera_id = camera_id
        self._camera_config = camera_config
        self._capture: Optional[cv2.VideoCapture] = None
        self._intrinsic: Optional[CameraIntrinsic] = None
        self._extrinsic: Optional[CameraExtrinsic] = None
        self._running = False
        self._frame_count = 0
        self._last_timestamp = 0.0
        self._load_calibration()

    def _load_calibration(self) -> None:
        cam_data = self._config.get_camera(self._camera_id)
        if cam_data:
            intrinsic_data = cam_data["intrinsic"]
            self._intrinsic = CameraIntrinsic(
                fx=intrinsic_data["fx"],
                fy=intrinsic_data["fy"],
                cx=intrinsic_data["cx"],
                cy=intrinsic_data["cy"],
                distortion=np.array(intrinsic_data.get("distortion", [0, 0, 0, 0, 0])
            )

            extrinsic_data = cam_data["extrinsic"]
            self._extrinsic = CameraExtrinsic(
                rotation=np.array(extrinsic_data["rotation"]),
                translation=np.array(extrinsic_data["translation"])
            )

    def open(self) -> bool:
        try:
            backend = cv2.CAP_DSHOW if self._camera_config.use_gpu else cv2.CAP_ANY
            self._capture = cv2.VideoCapture(self._camera_config.device_id, backend)

            if not self._capture.isOpened():
                logger.error(f"Failed to open camera {self._camera_id}")
                return False

            self._configure_camera()

            logger.info(f"Camera {self._camera_id} opened successfully")
            self._running = True
            return True

        except Exception as e:
            logger.error(f"Error opening camera {self._camera_id}: {e}")
            return False

    def _configure_camera(self) -> None:
        if self._capture is None:
            return

        width, height = self._camera_config.resolution
        self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self._capture.set(cv2.CAP_PROP_FPS, self._camera_config.fps)

        self._capture.set(cv2.CAP_PROP_EXPOSURE, self._camera_config.exposure)
        self._capture.set(cv2.CAP_PROP_GAIN, self._camera_config.gain)
        self._capture.set(cv2.CAP_PROP_WB_TEMPERATURE, self._camera_config.white_balance)

        self._capture.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0)
        self._capture.set(cv2.CAP_PROP_AUTO_WB, 0)
        self._capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))

        actual_width = int(self._capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(self._capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = int(self._capture.get(cv2.CAP_PROP_FPS))

        logger.info(f"Camera {self._camera_id} configured: {actual_width}x{actual_height} @ {actual_fps}fps")

    def read(self, timeout_ms: int = 100) -> Optional[Frame]:
        if self._capture is None or not self._running:
            return None

        start_time = time.perf_counter()
        while time.perf_counter() - start_time < timeout_ms / 1000.0:
            ret, frame = self._capture.read()
            if ret:
                timestamp = time.perf_counter()

                if self._intrinsic is not None and self._intrinsic.distortion.any():
                    frame = cv2.undistort(
                        frame,
                        self._intrinsic.matrix,
                        self._intrinsic.distortion
                    )

                self._frame_count += 1
                self._last_timestamp = timestamp

                return Frame(
                    camera_id=self._camera_id,
                    timestamp=timestamp,
                    image=frame,
                    intrinsic=self._intrinsic,
                    extrinsic=self._extrinsic
                )

        logger.warning(f"Camera {self._camera_id} read timeout")
        return None

    def grab(self) -> bool:
        if self._capture is None or not self._running:
            return False
        return self._capture.grab()

    def retrieve(self) -> Optional[Frame]:
        if self._capture is None or not self._running:
            return None

        ret, frame = self._capture.retrieve()
        if not ret:
            return None

        timestamp = time.perf_counter()

        if self._intrinsic is not None and self._intrinsic.distortion.any():
            frame = cv2.undistort(
                frame,
                self._intrinsic.matrix,
                self._intrinsic.distortion
            )

        self._frame_count += 1
        self._last_timestamp = timestamp

        return Frame(
            camera_id=self._camera_id,
            timestamp=timestamp,
            image=frame,
            intrinsic=self._intrinsic,
            extrinsic=self._extrinsic
        )

    def close(self) -> None:
        self._running = False
        if self._capture is not None:
            self._capture.release()
            self._capture = None
        logger.info(f"Camera {self._camera_id} closed")

    def set_exposure(self, exposure: int) -> None:
        if self._capture is not None:
            self._capture.set(cv2.CAP_PROP_EXPOSURE, exposure)
            self._camera_config.exposure = exposure

    def set_gain(self, gain: float) -> None:
        if self._capture is not None:
            self._capture.set(cv2.CAP_PROP_GAIN, gain)
            self._camera_config.gain = gain

    def set_white_balance(self, temperature: int) -> None:
        if self._capture is not None:
            self._capture.set(cv2.CAP_PROP_WB_TEMPERATURE, temperature)
            self._camera_config.white_balance = temperature

    def get_properties(self) -> Dict[str, Any]:
        if self._capture is None:
            return {}

        return {
            "width": int(self._capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(self._capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": int(self._capture.get(cv2.CAP_PROP_FPS)),
            "exposure": self._capture.get(cv2.CAP_PROP_EXPOSURE),
            "gain": self._capture.get(cv2.CAP_PROP_GAIN),
            "white_balance": self._capture.get(cv2.CAP_PROP_WB_TEMPERATURE),
            "frame_count": self._frame_count,
            "is_running": self._running
        }

    @property
    def intrinsic(self) -> Optional[CameraIntrinsic]:
        return self._intrinsic

    @property
    def extrinsic(self) -> Optional[CameraExtrinsic]:
        return self._extrinsic

    @property
    def camera_id(self) -> int:
        return self._camera_id

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def frame_count(self) -> int:
        return self._frame_count

    @property
    def last_timestamp(self) -> float:
        return self._last_timestamp

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
