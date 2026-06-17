import numpy as np
import cv2
from typing import List, Optional, Tuple, Dict
from dataclasses import dataclass

from src.utils import (
    Config,
    SyncedFrames,
    Frame,
    get_logger
)

logger = get_logger("capture")


@dataclass
class DepthConfig:
    min_disparity: int = 0
    num_disparities: int = 256
    block_size: int = 11
    pre_filter_cap: int = 63
    uniqueness_ratio: int = 10
    speckle_window_size: int = 100
    speckle_range: int = 32
    disp12_max_diff: int = 1
    use_semi_global: bool = True
    depth_map_smoothing: bool = True
    bilateral_filter_d: int = 9
    bilateral_filter_sigma: float = 75.0


class DepthEstimator:
    def __init__(self, config: Config):
        self._config = config
        self._depth_config = DepthConfig()
        self._stereo_matchers: Dict[Tuple[int, int], cv2.StereoSGBM] = {}
        self._baselines: Dict[Tuple[int, int], float] = {}
        self._init_stereo_matchers()

    def _init_stereo_matchers(self) -> None:
        cameras = self._config.get_all_cameras()
        if len(cameras) < 2:
            logger.warning("Not enough cameras for stereo depth estimation")
            return

        for i in range(len(cameras)):
            for j in range(i + 1, len(cameras)):
                cam1 = cameras[i]
                cam2 = cameras[j]

                key = (cam1["id"], cam2["id"])

                matcher = cv2.StereoSGBM_create(
                    minDisparity=self._depth_config.min_disparity,
                    numDisparities=self._depth_config.num_disparities,
                    blockSize=self._depth_config.block_size,
                    preFilterCap=self._depth_config.pre_filter_cap,
                    uniquenessRatio=self._depth_config.uniqueness_ratio,
                    speckleWindowSize=self._depth_config.speckle_window_size,
                    speckleRange=self._depth_config.speckle_range,
                    disp12MaxDiff=self._depth_config.disp12_max_diff,
                    P1=8 * 3 * self._depth_config.block_size ** 2,
                    P2=32 * 3 * self._depth_config.block_size ** 2,
                    mode=cv2.STEREO_SGBM_MODE_SGBM_3WAY
                )

                self._stereo_matchers[key] = matcher

                t1 = np.array(cam1["extrinsic"]["translation"])
                t2 = np.array(cam2["extrinsic"]["translation"])
                baseline = np.linalg.norm(t1 - t2)
                self._baselines[key] = baseline

                logger.info(f"Initialized stereo matcher for cameras {key}, baseline: {baseline:.3f}m")

    def estimate_depth(self, synced_frames: SyncedFrames) -> SyncedFrames:
        if len(synced_frames) < 2:
            return synced_frames

        frames_by_id = {f.camera_id: f for f in synced_frames.frames}
        camera_ids = sorted(frames_by_id.keys())

        if len(camera_ids) < 2:
            return synced_frames

        for i, cam_id in enumerate(camera_ids):
            frame = frames_by_id[cam_id]

            if i == 0:
                other_id = camera_ids[1]
            else:
                other_id = camera_ids[0]

            key = (min(cam_id, other_id), max(cam_id, other_id))

            if key not in self._stereo_matchers:
                continue

            matcher = self._stereo_matchers[key]

            img_left = frames_by_id[key[0]].image
            img_right = frames_by_id[key[1]].image

            img_left_gray = cv2.cvtColor(img_left, cv2.COLOR_BGR2GRAY)
            img_right_gray = cv2.cvtColor(img_right, cv2.COLOR_BGR2GRAY)

            if cam_id == key[1]:
                img_left_gray, img_right_gray = img_right_gray, img_left_gray

            disparity = matcher.compute(img_left_gray, img_right_gray).astype(np.float32) / 16.0

            depth = self._disparity_to_depth(disparity, key, frame)

            if self._depth_config.depth_map_smoothing:
                depth = self._smooth_depth_map(depth)

            frame.depth = depth

        return synced_frames

    def _disparity_to_depth(self, disparity: np.ndarray,
                            camera_pair: Tuple[int, int],
                            frame: Frame) -> np.ndarray:
        if frame.intrinsic is None:
            return np.zeros_like(disparity)

        fx = frame.intrinsic.fx
        baseline = self._baselines.get(camera_pair, 0.1)

        with np.errstate(divide='ignore', invalid='ignore'):
            depth = fx * baseline / (disparity + 1e-6)

        depth[disparity <= 0] = 0
        depth[np.isinf(depth)] = 0
        depth[np.isnan(depth)] = 0

        max_depth = 5.0
        depth[depth > max_depth] = 0

        return depth

    def _smooth_depth_map(self, depth: np.ndarray) -> np.ndarray:
        if not np.any(depth > 0):
            return depth

        mask = (depth > 0).astype(np.uint8)

        depth_uint16 = (depth * 1000).astype(np.uint16)

        depth_smoothed = cv2.bilateralFilter(
            depth_uint16,
            self._depth_config.bilateral_filter_d,
            self._depth_config.bilateral_filter_sigma,
            self._depth_config.bilateral_filter_sigma
        )

        depth_smoothed = depth_smoothed.astype(np.float32) / 1000.0
        depth_smoothed[mask == 0] = 0

        return depth_smoothed

    def estimate_from_multiview(self, synced_frames: SyncedFrames) -> SyncedFrames:
        if len(synced_frames) < 3:
            return self.estimate_depth(synced_frames)

        frames_by_id = {f.camera_id: f for f in synced_frames.frames}
        camera_ids = sorted(frames_by_id.keys())

        for cam_id in camera_ids:
            depth_maps = []

            for other_id in camera_ids:
                if other_id == cam_id:
                    continue

                key = (min(cam_id, other_id), max(cam_id, other_id))
                if key not in self._stereo_matchers:
                    continue

                matcher = self._stereo_matchers[key]
                frame = frames_by_id[cam_id]
                other_frame = frames_by_id[other_id]

                img1 = cv2.cvtColor(frame.image, cv2.COLOR_BGR2GRAY)
                img2 = cv2.cvtColor(other_frame.image, cv2.COLOR_BGR2GRAY)

                if cam_id > other_id:
                    img1, img2 = img2, img1

                disparity = matcher.compute(img1, img2).astype(np.float32) / 16.0

                if cam_id > other_id:
                    disparity = cv2.flip(disparity, 1)

                depth = self._disparity_to_depth(disparity, key, frame)
                depth_maps.append(depth)

            if depth_maps:
                stacked = np.stack(depth_maps, axis=0)
                merged_depth = np.median(stacked, axis=0)

                if self._depth_config.depth_map_smoothing:
                    merged_depth = self._smooth_depth_map(merged_depth)

                frames_by_id[cam_id].depth = merged_depth

        return synced_frames

    def update_config(self, config: DepthConfig) -> None:
        self._depth_config = config
        for matcher in self._stereo_matchers.values():
            matcher.setMinDisparity(config.min_disparity)
            matcher.setNumDisparities(config.num_disparities)
            matcher.setBlockSize(config.block_size)
            matcher.setPreFilterCap(config.pre_filter_cap)
            matcher.setUniquenessRatio(config.uniqueness_ratio)
            matcher.setSpeckleWindowSize(config.speckle_window_size)
            matcher.setSpeckleRange(config.speckle_range)
            matcher.setDisp12MaxDiff(config.disp12_max_diff)

    @staticmethod
    def normalize_depth_for_display(depth: np.ndarray) -> np.ndarray:
        if depth is None or not np.any(depth > 0):
            return np.zeros(depth.shape[:2] if depth is not None else (480, 640), dtype=np.uint8)

        valid_mask = depth > 0
        if not np.any(valid_mask):
            return np.zeros_like(depth, dtype=np.uint8)

        min_d = np.min(depth[valid_mask])
        max_d = np.max(depth[valid_mask])

        if max_d <= min_d:
            return np.zeros_like(depth, dtype=np.uint8)

        normalized = np.zeros_like(depth, dtype=np.uint8)
        normalized[valid_mask] = ((depth[valid_mask] - min_d) / (max_d - min_d) * 255).astype(np.uint8)

        return cv2.applyColorMap(normalized, cv2.COLORMAP_JET)
