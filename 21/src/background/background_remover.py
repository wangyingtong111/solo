import numpy as np
import cv2
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass, field
from collections import deque
import time

from src.utils import (
    Config,
    SyncedFrames,
    Frame,
    MultiTimer,
    get_logger
)

logger = get_logger("background")


@dataclass
class BackgroundModel:
    mean: np.ndarray
    variance: np.ndarray
    weight: np.ndarray
    age: np.ndarray


@dataclass
class BackgroundConfig:
    method: str = "multimodal"
    learning_rate: float = 0.005
    history_frames: int = 500
    var_threshold: float = 25.0
    detect_shadows: bool = False
    morphology_kernel_size: int = 5
    temporal_smoothing: int = 3
    min_contour_area: int = 100
    max_background_change_ratio: float = 0.05
    use_depth: bool = True
    depth_threshold: float = 0.1
    shadow_threshold: float = 0.5


class SingleCameraBackgroundRemover:
    def __init__(self, camera_id: int, config: BackgroundConfig):
        self._camera_id = camera_id
        self._config = config
        self._bg_model: Optional[BackgroundModel] = None
        self._fgbg = cv2.createBackgroundSubtractorMOG2(
            history=config.history_frames,
            varThreshold=config.var_threshold,
            detectShadows=config.detect_shadows
        )
        self._mask_history: deque = deque(maxlen=config.temporal_smoothing)
        self._initialized = False
        self._frame_count = 0
        self._stable_fg_ratio_history: deque = deque(maxlen=30)

    def initialize(self, frame: Frame) -> None:
        h, w = frame.image.shape[:2]
        self._bg_model = BackgroundModel(
            mean=np.zeros((h, w, 3), dtype=np.float32),
            variance=np.ones((h, w), dtype=np.float32) * 25.0,
            weight=np.ones((h, w), dtype=np.float32),
            age=np.zeros((h, w), dtype=np.int32)
        )
        self._bg_model.mean = frame.image.astype(np.float32)
        self._initialized = True
        logger.info(f"Camera {self._camera_id} background model initialized")

    def process(self, frame: Frame) -> Frame:
        if not self._initialized:
            self.initialize(frame)
            return frame

        self._frame_count += 1

        image = frame.image
        depth = frame.depth

        fg_mask = self._fgbg.apply(image, learningRate=self._config.learning_rate)

        color_mask = self._color_based_segmentation(image)

        combined_mask = cv2.bitwise_or(fg_mask, color_mask)

        if depth is not None and self._config.use_depth:
            depth_mask = self._depth_based_segmentation(depth)
            combined_mask = cv2.bitwise_and(combined_mask, depth_mask)

        refined_mask = self._refine_mask(combined_mask)

        refined_mask = self._temporal_smoothing(refined_mask)

        error_check = self._check_background_stability(refined_mask)
        if not error_check:
            refined_mask = self._correct_mask(refined_mask, color_mask)

        frame.mask = refined_mask

        self._update_background_model(image, refined_mask)

        return frame

    def _color_based_segmentation(self, image: np.ndarray) -> np.ndarray:
        if self._bg_model is None:
            return np.zeros(image.shape[:2], dtype=np.uint8)

        diff = np.abs(image.astype(np.float32) - self._bg_model.mean)
        diff = np.mean(diff, axis=2)

        std = np.sqrt(self._bg_model.variance)
        threshold = 2.5 * std + 10.0

        mask = (diff > threshold).astype(np.uint8) * 255

        return mask

    def _depth_based_segmentation(self, depth: np.ndarray) -> np.ndarray:
        if depth is None or not np.any(depth > 0):
            return np.ones(depth.shape[:2] if depth is not None else (480, 640), dtype=np.uint8) * 255

        valid_depth = depth > 0
        if not np.any(valid_depth):
            return np.ones_like(depth, dtype=np.uint8) * 255

        mean_depth = np.median(depth[valid_depth])
        depth_diff = np.abs(depth - mean_depth)
        mask = (depth_diff > self._config.depth_threshold).astype(np.uint8) * 255
        mask[~valid_depth] = 0

        return mask

    def _refine_mask(self, mask: np.ndarray) -> np.ndarray:
        kernel_size = self._config.morphology_kernel_size
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))

        refined = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        refined = cv2.morphologyEx(refined, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(refined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        filtered = np.zeros_like(refined)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > self._config.min_contour_area:
                cv2.drawContours(filtered, [contour], -1, 255, -1)

        return filtered.astype(np.uint8)

    def _temporal_smoothing(self, mask: np.ndarray) -> np.ndarray:
        if len(self._mask_history) < self._config.temporal_smoothing:
            self._mask_history.append(mask.copy())
            return mask

        self._mask_history.append(mask.copy())

        stacked = np.stack(self._mask_history, axis=0).astype(np.float32) / 255.0
        smoothed = (np.mean(stacked, axis=0) > 0.5).astype(np.uint8) * 255

        return smoothed

    def _check_background_stability(self, mask: np.ndarray) -> bool:
        fg_ratio = np.sum(mask > 0) / (mask.shape[0] * mask.shape[1])
        self._stable_fg_ratio_history.append(fg_ratio)

        if len(self._stable_fg_ratio_history) < 10:
            return True

        avg_fg_ratio = np.mean(self._stable_fg_ratio_history)

        if fg_ratio > self._config.max_background_change_ratio and fg_ratio > 2 * avg_fg_ratio:
            logger.warning(f"Camera {self._camera_id}: Sudden background change detected ({fg_ratio:.3%})")
            return False

        return True

    def _correct_mask(self, mask: np.ndarray, color_mask: np.ndarray) -> np.ndarray:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        eroded_color = cv2.erode(color_mask, kernel, iterations=2)

        corrected = cv2.bitwise_and(mask, eroded_color)

        return corrected

    def _update_background_model(self, image: np.ndarray, mask: np.ndarray) -> None:
        if self._bg_model is None:
            return

        bg_mask = (mask == 0).astype(np.float32)
        lr = self._config.learning_rate

        fg_mask = 1.0 - bg_mask

        self._bg_model.mean = (1.0 - lr * bg_mask) * self._bg_model.mean + lr * bg_mask * image.astype(np.float32)

        diff = np.abs(image.astype(np.float32) - self._bg_model.mean)
        self._bg_model.variance = (1.0 - lr * bg_mask) * self._bg_model.variance + lr * bg_mask * (diff ** 2).mean(axis=2)

        self._bg_model.age[bg_mask > 0] += 1

    def get_background_image(self) -> Optional[np.ndarray]:
        if self._bg_model is None:
            return None
        return self._bg_model.mean.astype(np.uint8)

    def reset(self) -> None:
        self._bg_model = None
        self._fgbg = cv2.createBackgroundSubtractorMOG2(
            history=self._config.history_frames,
            varThreshold=self._config.var_threshold,
            detectShadows=self._config.detect_shadows
        )
        self._mask_history.clear()
        self._initialized = False
        self._frame_count = 0
        self._stable_fg_ratio_history.clear()


class BackgroundRemover:
    def __init__(self, config: Config):
        self._config = config
        self._bg_config = BackgroundConfig(
            method=config.get("background.method", "multimodal"),
            learning_rate=config.get("background.learning_rate", 0.005),
            history_frames=config.get("background.history_frames", 500),
            var_threshold=config.get("background.var_threshold", 25.0),
            detect_shadows=config.get("background.detect_shadows", False),
            morphology_kernel_size=config.get("background.morphology_kernel_size", 5),
            temporal_smoothing=config.get("background.temporal_smoothing", 3),
            min_contour_area=config.get("background.min_contour_area", 100),
            max_background_change_ratio=config.get("background.max_background_change_ratio", 0.05)
        )
        self._removers: Dict[int, SingleCameraBackgroundRemover] = {}
        self._timer = MultiTimer()
        self._error_rates: deque = deque(maxlen=100)
        self._initialized = False

    def process(self, synced_frames: SyncedFrames) -> SyncedFrames:
        self._timer.start("background_total")

        for frame in synced_frames.frames:
            if frame.camera_id not in self._removers:
                self._removers[frame.camera_id] = SingleCameraBackgroundRemover(
                    frame.camera_id,
                    self._bg_config
                )

            self._timer.start(f"bg_cam_{frame.camera_id}")
            self._removers[frame.camera_id].process(frame)
            self._timer.stop(f"bg_cam_{frame.camera_id}")

        self._estimate_error_rate(synced_frames)

        self._timer.stop("background_total")

        return synced_frames

    def _estimate_error_rate(self, synced_frames) -> None:
        if len(synced_frames) < 2:
            return

        masks = [f.mask for f in synced_frames.frames if f.mask is not None]
        if len(masks) < 2:
            return

        error_rate = 0.0
        count = 0

        for i in range(len(masks)):
            for j in range(i + 1, len(masks)):
                mask1 = cv2.resize(masks[i], (320, 180))
                mask2 = cv2.resize(masks[j], (320, 180))

                if mask1.shape != mask2.shape:
                    continue

                diff = np.abs(mask1.astype(np.int32) - mask2.astype(np.int32))
                disagreement = np.sum(diff > 0) / (mask1.shape[0] * mask1.shape[1])
                error_rate += disagreement
                count += 1

        if count > 0:
            error_rate /= count
            self._error_rates.append(error_rate)

    def get_error_rate(self) -> float:
        if not self._error_rates:
            return 0.0
        return float(np.mean(self._error_rates))

    def get_background_images(self) -> Dict[int, np.ndarray]:
        bg_images = {}
        for cam_id, remover in self._removers.items():
            bg_img = remover.get_background_image()
            if bg_img is not None:
                bg_images[cam_id] = bg_img
        return bg_images

    def reset(self, camera_id: Optional[int] = None) -> None:
        if camera_id is not None:
            if camera_id in self._removers:
                self._removers[camera_id].reset()
        else:
            for remover in self._removers.values():
                remover.reset()

    def update_learning_rate(self, learning_rate: float) -> None:
        self._bg_config.learning_rate = learning_rate
        for remover in self._removers.values():
            remover._config.learning_rate = learning_rate

    def get_statistics(self) -> Dict:
        stats = {
            "avg_processing_time_ms": self._timer.average("background_total") * 1000,
            "processing_fps": self._timer.fps("background_total"),
            "estimated_error_rate": self.get_error_rate(),
            "num_cameras": len(self._removers)
        }

        for cam_id in self._removers:
            stats[f"cam_{cam_id}_time_ms"] = self._timer.average(f"bg_cam_{cam_id}") * 1000

        return stats
