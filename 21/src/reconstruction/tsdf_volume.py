import numpy as np
from typing import Optional, Tuple, List
import logging

logger = logging.getLogger("reconstruction")


class TSDFVolumeCPU:
    def __init__(self,
                 voxel_size: float,
                 volume_bounds: np.ndarray,
                 truncation_distance: float,
                 integration_weight: float = 1.0,
                 use_gpu: bool = False):
        self._voxel_size = voxel_size
        self._volume_bounds = np.array(volume_bounds, dtype=np.float64)
        self._truncation_distance = truncation_distance
        self._integration_weight = integration_weight

        self._dimensions = np.ceil(
            (self._volume_bounds[:, 1] - self._volume_bounds[:, 0]) / self._voxel_size
        ).astype(int)

        self._tsdf = None
        self._weights = None
        self._colors = None
        self._initialized = False

    def initialize(self) -> None:
        dx, dy, dz = self._dimensions
        self._tsdf = np.ones((dx, dy, dz), dtype=np.float32)
        self._weights = np.zeros((dx, dy, dz), dtype=np.float32)
        self._colors = np.zeros((dx, dy, dz, 3), dtype=np.float32)
        self._initialized = True
        logger.info(f"TSDF Volume initialized: {dx}x{dy}x{dz}, voxel_size={self._voxel_size}m")

    def reset(self) -> None:
        if self._initialized:
            self._tsdf[:] = 1.0
            self._weights[:] = 0.0
            self._colors[:] = 0.0

    def integrate(self,
                  depth_map: np.ndarray,
                  color_image: Optional[np.ndarray],
                  intrinsic: np.ndarray,
                  extrinsic: np.ndarray,
                  mask: Optional[np.ndarray] = None,
                  weight: Optional[float] = None) -> None:
        if not self._initialized:
            self.initialize()

        if weight is None:
            weight = self._integration_weight

        if mask is not None:
            depth_map = depth_map * (mask > 0)

        fx, fy = intrinsic[0, 0], intrinsic[1, 1]
        cx, cy = intrinsic[0, 2], intrinsic[1, 2]

        h, w = depth_map.shape

        voxel_grid = np.indices(self._dimensions).reshape(3, -1).T
        world_points = self._volume_bounds[:, 0] + (voxel_grid + 0.5) * self._voxel_size

        cam_points = (extrinsic[:3, :3] @ world_points.T + extrinsic[:3, 3:4]).T

        z = cam_points[:, 2]
        valid = z > 0
        cam_points = cam_points[valid]
        voxel_grid_valid = voxel_grid[valid]
        world_points_valid = world_points[valid]

        if len(cam_points) == 0:
            return

        u = (cam_points[:, 0] * fx / cam_points[:, 2] + cx).astype(int)
        v = (cam_points[:, 1] * fy / cam_points[:, 2] + cy).astype(int)

        valid_pixels = (u >= 0) & (u < w) & (v >= 0) & (v < h)
        u = u[valid_pixels]
        v = v[valid_pixels]
        cam_points = cam_points[valid_pixels]
        voxel_grid_valid = voxel_grid_valid[valid_pixels]
        world_points_valid = world_points_valid[valid_pixels]

        if len(u) == 0:
            return

        depth_sampled = depth_map[v, u]
        valid_depth = depth_sampled > 0
        if not np.any(valid_depth):
            return

        u = u[valid_depth]
        v = v[valid_depth]
        cam_points = cam_points[valid_depth]
        voxel_grid_valid = voxel_grid_valid[valid_depth]
        world_points_valid = world_points_valid[valid_depth]
        depth_sampled = depth_sampled[valid_depth]

        sdf = depth_sampled - cam_points[:, 2]

        tsdf = np.clip(sdf / self._truncation_distance, -1.0, 1.0)

        vx, vy, vz = voxel_grid_valid[:, 0], voxel_grid_valid[:, 1], voxel_grid_valid[:, 2]

        old_tsdf = self._tsdf[vx, vy, vz]
        old_weights = self._weights[vx, vy, vz]

        new_weights = old_weights + weight
        self._tsdf[vx, vy, vz] = (old_weights * old_tsdf + weight * tsdf) / new_weights
        self._weights[vx, vy, vz] = new_weights

        if color_image is not None and self._colors is not None:
            color_sampled = color_image[v, u].astype(np.float32) / 255.0
            old_colors = self._colors[vx, vy, vz]
            self._colors[vx, vy, vz] = (old_weights[:, None] * old_colors + weight * color_sampled) / new_weights[:, None]

    def integrate_fast(self,
                       depth_map: np.ndarray,
                       color_image: Optional[np.ndarray],
                       intrinsic: np.ndarray,
                       extrinsic: np.ndarray,
                       mask: Optional[np.ndarray] = None) -> None:
        if not self._initialized:
            self.initialize()

        if mask is not None:
            depth_map = depth_map * (mask > 0)

        h, w = depth_map.shape

        y, x = np.meshgrid(np.arange(h), np.arange(w), indexing='ij')
        valid = depth_map.flatten() > 0
        if not np.any(valid):
            return

        x_flat = x.flatten()[valid]
        y_flat = y.flatten()[valid]
        depth_flat = depth_map.flatten()[valid]

        fx, fy = intrinsic[0, 0], intrinsic[1, 1]
        cx, cy = intrinsic[0, 2], intrinsic[1, 2]

        cam_x = (x_flat - cx) * depth_flat / fx
        cam_y = (y_flat - cy) * depth_flat / fy
        cam_z = depth_flat

        cam_points = np.vstack([cam_x, cam_y, cam_z, np.ones_like(cam_x)])
        world_points = (np.linalg.inv(extrinsic) @ cam_points).T[:, :3]

        voxel_indices = np.floor((world_points - self._volume_bounds[:, 0]) / self._voxel_size).astype(int)

        in_bounds = np.all((voxel_indices >= 0) & (voxel_indices < self._dimensions), axis=1)
        if not np.any(in_bounds):
            return

        voxel_indices = voxel_indices[in_bounds]
        world_points = world_points[in_bounds]
        depth_flat = depth_flat[in_bounds]

        for i in range(-1, 2):
            for j in range(-1, 2):
                for k in range(-1, 2):
                    vi = voxel_indices + np.array([i, j, k])
                    in_bounds = np.all((vi >= 0) & (vi < self._dimensions), axis=1)
                    if not np.any(in_bounds):
                        continue

                    vi_valid = vi[in_bounds]
                    wp_valid = world_points[in_bounds]
                    d_valid = depth_flat[in_bounds]

                    voxel_center = self._volume_bounds[:, 0] + (vi_valid + 0.5) * self._voxel_size
                    sdf = d_valid - np.linalg.norm(wp_valid - voxel_center, axis=1)

                    tsdf = np.clip(sdf / self._truncation_distance, -1.0, 1.0)

                    vx, vy, vz = vi_valid[:, 0], vi_valid[:, 1], vi_valid[:, 2]

                    old_tsdf = self._tsdf[vx, vy, vz]
                    old_weights = self._weights[vx, vy, vz]
                    new_weights = old_weights + self._integration_weight

                    self._tsdf[vx, vy, vz] = (old_weights * old_tsdf + self._integration_weight * tsdf) / new_weights
                    self._weights[vx, vy, vz] = new_weights

                    if color_image is not None and self._colors is not None and i == 0 and j == 0 and k == 0:
                        colors = color_image[y_flat[valid][in_bounds], x_flat[valid][in_bounds]].astype(np.float32) / 255.0
                        old_colors = self._colors[vx, vy, vz]
                        self._colors[vx, vy, vz] = (old_weights[:, None] * old_colors + self._integration_weight * colors) / new_weights[:, None]

    def get_tsdf(self) -> np.ndarray:
        return self._tsdf if self._initialized else None

    def get_weights(self) -> np.ndarray:
        return self._weights if self._initialized else None

    def get_colors(self) -> np.ndarray:
        return self._colors if self._initialized else None

    @property
    def voxel_size(self) -> float:
        return self._voxel_size

    @property
    def volume_bounds(self) -> np.ndarray:
        return self._volume_bounds

    @property
    def dimensions(self) -> np.ndarray:
        return self._dimensions

    @property
    def truncation_distance(self) -> float:
        return self._truncation_distance

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    def __del__(self):
        del self._tsdf, self._weights, self._colors


class TSDFVolumeGPU(TSDFVolumeCPU):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, use_gpu=True, **kwargs)
        self._cuda_available = False
        self._try_init_cuda()

    def _try_init_cuda(self) -> None:
        try:
            import cupy as cp
            self._cp = cp
            self._cuda_available = True
            logger.info("CUDA acceleration enabled for TSDF volume")
        except ImportError:
            logger.warning("CUDA not available, falling back to CPU")
            self._cuda_available = False

    def initialize(self) -> None:
        super().initialize()
        if self._cuda_available:
            self._tsdf = self._cp.asarray(self._tsdf)
            self._weights = self._cp.asarray(self._weights)
            if self._colors is not None:
                self._colors = self._cp.asarray(self._colors)

    def get_tsdf(self) -> np.ndarray:
        if self._cuda_available and self._tsdf is not None:
            return self._cp.asnumpy(self._tsdf)
        return self._tsdf

    def get_weights(self) -> np.ndarray:
        if self._cuda_available and self._weights is not None:
            return self._cp.asnumpy(self._weights)
        return self._weights

    def get_colors(self) -> np.ndarray:
        if self._cuda_available and self._colors is not None:
            return self._cp.asnumpy(self._colors)
        return self._colors
