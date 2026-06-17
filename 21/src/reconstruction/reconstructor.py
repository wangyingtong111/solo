import time
import numpy as np
from typing import Optional, Dict, Tuple

from src.utils import (
    Config,
    SyncedFrames,
    Mesh,
    TSDFVolume,
    MultiTimer,
    WorkerThread,
    ThreadSafeQueue,
    get_logger
)
from src.reconstruction import (
    TSDFVolumeCPU,
    TSDFVolumeGPU,
    marching_cubes,
    marching_cubes_fast,
    compute_normals
)

logger = get_logger("reconstruction")


class RealTimeReconstructor:
    def __init__(self, config: Config):
        self._config = config
        self._tsdf_volume: Optional[TSDFVolume] = None
        self._integration_queue: Optional[ThreadSafeQueue] = None
        self._output_queue: Optional[ThreadSafeQueue] = None
        self._integration_worker: Optional[WorkerThread] = None
        self._extraction_worker: Optional[WorkerThread] = None
        self._timer = MultiTimer()

        self._voxel_size = config.get("reconstruction.tsdf_voxel_size", 0.002)
        self._truncation_distance = config.get("reconstruction.tsdf_truncation_distance", 0.01)
        self._integration_weight = config.get("reconstruction.tsdf_integration_weight", 1.0)
        self._volume_bounds = np.array(config.get("reconstruction.volume_bounds",
                                                  [[-0.3, 0.3], [-0.3, 0.3], [-0.3, 0.3]]))
        self._max_vertices = config.get("reconstruction.max_vertices", 50000)
        self._max_triangles = config.get("reconstruction.max_triangles", 100000)
        self._integration_rate = config.get("reconstruction.integration_rate", 15)
        self._surface_extraction_rate = config.get("reconstruction.surface_extraction_rate", 15)

        self._running = False
        self._current_mesh: Optional[Mesh] = None
        self._last_integration_time = 0.0
        self._last_extraction_time = 0.0
        self._frame_count = 0

        self._use_gpu = config.get("system.gpu_enabled", True)
        self._init_tsdf_volume()

    def _init_tsdf_volume(self) -> None:
        if self._use_gpu:
            self._tsdf_volume = TSDFVolumeGPU(
                voxel_size=self._voxel_size,
                volume_bounds=self._volume_bounds,
                truncation_distance=self._truncation_distance,
                integration_weight=self._integration_weight
            )
            logger.info("Using GPU-accelerated TSDF volume")
        else:
            self._tsdf_volume = TSDFVolumeCPU(
                voxel_size=self._voxel_size,
                volume_bounds=self._volume_bounds,
                truncation_distance=self._truncation_distance,
                integration_weight=self._integration_weight
            )
            logger.info("Using CPU-based TSDF volume")

    def start(self, input_queue: ThreadSafeQueue, output_queue: ThreadSafeQueue) -> None:
        self._integration_queue = input_queue
        self._output_queue = output_queue
        self._running = True

        self._integration_worker = WorkerThread(
            name="TSDFIntegration",
            task_fn=self._integration_loop,
            daemon=True
        )
        self._integration_worker.start()

        self._extraction_worker = WorkerThread(
            name="SurfaceExtraction",
            task_fn=self._extraction_loop,
            daemon=True
        )
        self._extraction_worker.start()

        logger.info("Real-time reconstructor started")

    def stop(self) -> None:
        self._running = False
        if self._integration_worker is not None:
            self._integration_worker.stop(wait=True, timeout=2.0)
            self._integration_worker = None

        if self._extraction_worker is not None:
            self._extraction_worker.stop(wait=True, timeout=2.0)
            self._extraction_worker = None

        logger.info("Real-time reconstructor stopped")

    def _integration_loop(self) -> None:
        if not self._running:
            time.sleep(0.001)
            return

        if self._integration_queue is None:
            return

        synced_frames = self._integration_queue.get(timeout=0.1)
        if synced_frames is None:
            return

        self._timer.start("integration_total")
        self._integrate_frames(synced_frames)
        self._timer.stop("integration_total")

        self._frame_count += 1

    def _integrate_frames(self, synced_frames: SyncedFrames) -> None:
        if self._tsdf_volume is None:
            return

        for frame in synced_frames.frames:
            if frame.depth is None or frame.intrinsic is None or frame.extrinsic is None:
                continue

            self._timer.start(f"integrate_cam_{frame.camera_id}")

            depth_map = frame.depth.astype(np.float32)
            color_image = frame.image

            mask = frame.mask > 0 if frame.mask is not None else None

            intrinsic = frame.intrinsic.matrix
            extrinsic = frame.extrinsic.matrix

            self._tsdf_volume.integrate_fast(
                depth_map=depth_map,
                color_image=color_image,
                intrinsic=intrinsic,
                extrinsic=extrinsic,
                mask=mask
            )

            self._timer.stop(f"integrate_cam_{frame.camera_id}")

    def _extraction_loop(self) -> Optional[Mesh]:
        if not self._running:
            time.sleep(0.001)
            return None

        current_time = time.time()
        extraction_interval = 1.0 / self._surface_extraction_rate

        if current_time - self._last_extraction_time < extraction_interval:
            time.sleep(0.001)
            return None

        self._last_extraction_time = current_time

        self._timer.start("extraction_total")
        mesh = self._extract_surface()
        self._timer.stop("extraction_total")

        if mesh is not None and not mesh.is_empty():
            self._current_mesh = mesh
            mesh.timestamp = current_time

            if self._output_queue is not None:
                self._output_queue.put_nowait(mesh)

            return mesh

        return None

    def _extract_surface(self) -> Optional[Mesh]:
        if self._tsdf_volume is None or not self._tsdf_volume.is_initialized:
            return None

        tsdf = self._tsdf_volume.get_tsdf()
        weights = self._tsdf_volume.get_weights()
        colors = self._tsdf_volume.get_colors()

        if tsdf is None:
            return None

        valid_mask = weights > 0
        if not np.any(valid_mask):
            return None

        self._timer.start("marching_cubes")
        try:
            vertices, faces = marching_cubes_fast(
                volume=tsdf,
                level=0.0,
                voxel_size=self._voxel_size,
                origin=self._volume_bounds[:, 0]
            )
        except Exception as e:
            logger.error(f"Marching cubes failed: {e}")
            return None
        self._timer.stop("marching_cubes")

        if len(vertices) == 0 or len(faces) == 0:
            return None

        if len(vertices) > self._max_vertices:
            logger.debug(f"Mesh too large ({len(vertices)} vertices), skipping for now")
            return None

        self._timer.start("compute_normals")
        normals = compute_normals(vertices, faces)
        self._timer.stop("compute_normals")

        vertex_colors = None
        if colors is not None and np.any(weights > 0):
            self._timer.start("sample_colors")
            vertex_colors = self._sample_vertex_colors(vertices, colors, weights)
            self._timer.stop("sample_colors")

        return Mesh(
            vertices=vertices.astype(np.float32),
            faces=faces.astype(np.int32),
            normals=normals.astype(np.float32),
            colors=vertex_colors.astype(np.float32) if vertex_colors is not None else None
        )

    def _sample_vertex_colors(self, vertices: np.ndarray, colors_volume: np.ndarray,
                              weights: np.ndarray) -> np.ndarray:
        voxel_indices = np.floor((vertices - self._volume_bounds[:, 0]) / self._voxel_size).astype(int)

        voxel_indices = np.clip(voxel_indices, 0, np.array(colors_volume.shape[:3]) - 1)

        vx, vy, vz = voxel_indices[:, 0], voxel_indices[:, 1], voxel_indices[:, 2]

        vertex_colors = colors_volume[vx, vy, vz]
        valid_weights = weights[vx, vy, vz]
        valid_mask = valid_weights > 0

        default_color = np.array([0.8, 0.8, 0.8], dtype=np.float32)
        vertex_colors[~valid_mask] = default_color

        return vertex_colors

    def reset(self) -> None:
        if self._tsdf_volume is not None:
            self._tsdf_volume.reset()
        self._current_mesh = None
        self._frame_count = 0
        self._last_integration_time = 0.0
        self._last_extraction_time = 0.0
        logger.info("TSDF volume reset")

    def get_current_mesh(self) -> Optional[Mesh]:
        return self._current_mesh

    def get_statistics(self) -> Dict:
        stats = {
            "frame_count": self._frame_count,
            "integration_fps": self._timer.fps("integration_total"),
            "extraction_fps": self._timer.fps("extraction_total"),
            "avg_integration_time_ms": self._timer.average("integration_total") * 1000,
            "avg_extraction_time_ms": self._timer.average("extraction_total") * 1000,
            "marching_cubes_time_ms": self._timer.average("marching_cubes") * 1000,
            "normals_time_ms": self._timer.average("compute_normals") * 1000,
            "voxel_dimensions": self._tsdf_volume.dimensions.tolist() if self._tsdf_volume else [],
            "voxel_count": np.prod(self._tsdf_volume.dimensions) if self._tsdf_volume else 0,
            "current_vertices": self._current_mesh.num_vertices if self._current_mesh else 0,
            "current_faces": self._current_mesh.num_faces if self._current_mesh else 0
        }

        for cam_id in range(3):
            key = f"integrate_cam_{cam_id}"
            if self._timer.average(key) > 0:
                stats[f"cam_{cam_id}_integration_ms"] = self._timer.average(key) * 1000

        return stats

    @property
    def tsdf_volume(self) -> Optional[TSDFVolume]:
        return self._tsdf_volume

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def frame_count(self) -> int:
        return self._frame_count
