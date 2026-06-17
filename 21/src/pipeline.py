import time
import threading
from typing import Optional, Dict, Any
from dataclasses import dataclass

from src.utils import (
    Config,
    ThreadSafeQueue,
    WorkerThread,
    SyncBarrier,
    Timer,
    MultiTimer,
    Metrics,
    get_logger,
    SyncedFrames,
    Mesh
)
from src.capture import Camera, SyncCaptureManager, DepthEstimator
from src.background import BackgroundRemover
from src.reconstruction import (
    RealTimeReconstructor,
    TSDFVolumeCPU,
    TSDFVolumeGPU,
    marching_cubes
)
from src.texture import TextureMapper
from src.mesh import MeshOptimizer
from src.export import GLBExporter

logger = get_logger("pipeline")


@dataclass
class PipelineConfig:
    target_fps: int = 15
    max_latency_ms: int = 1000
    enable_visualization: bool = True
    enable_mesh_optimization: bool = True
    enable_texture: bool = True
    enable_export: bool = True
    gpu_acceleration: bool = True


class ReconstructionPipeline:
    def __init__(self, config: Config):
        self._config = config
        self._pipe_config = PipelineConfig(
            target_fps=config.get("pipeline.target_fps", 15),
            max_latency_ms=config.get("pipeline.max_latency_ms", 1000),
            enable_visualization=config.get("visualization.enabled", True),
            enable_mesh_optimization=config.get("mesh_optimization.enabled", True),
            enable_texture=config.get("texture.enabled", True),
            enable_export=config.get("export.enabled", True),
            gpu_acceleration=config.get("reconstruction.gpu_acceleration", True)
        )

        self._capture_queue: Optional[ThreadSafeQueue] = None
        self._depth_queue: Optional[ThreadSafeQueue] = None
        self._bg_queue: Optional[ThreadSafeQueue] = None
        self._mesh_queue: Optional[ThreadSafeQueue] = None
        self._output_queue: Optional[ThreadSafeQueue] = None

        self._sync_manager: Optional[SyncCaptureManager] = None
        self._depth_estimator: Optional[DepthEstimator] = None
        self._bg_remover: Optional[BackgroundRemover] = None
        self._reconstructor: Optional[RealTimeReconstructor] = None
        self._texture_mapper: Optional[TextureMapper] = None
        self._mesh_optimizer: Optional[MeshOptimizer] = None
        self._glb_exporter: Optional[GLBExporter] = None

        self._depth_thread: Optional[WorkerThread] = None
        self._bg_thread: Optional[WorkerThread] = None
        self._texture_thread: Optional[WorkerThread] = None
        self._optimization_thread: Optional[WorkerThread] = None

        self._running = False
        self._timer = MultiTimer()
        self._metrics = Metrics()
        self._metrics_lock = threading.Lock()

        self._last_mesh: Optional[Mesh] = None
        self._last_synced_frames: Optional[SyncedFrames] = None
        self._mesh_lock = threading.Lock()

        self._export_requested = threading.Event()
        self._export_path: Optional[str] = None

        self._total_start_time = 0.0
        self._frame_count = 0

        self._initialize_modules()

    def _initialize_modules(self) -> None:
        queue_size = self._config.get("pipeline.queue_size", 5)

        self._capture_queue = ThreadSafeQueue(maxsize=queue_size)
        self._depth_queue = ThreadSafeQueue(maxsize=queue_size)
        self._bg_queue = ThreadSafeQueue(maxsize=queue_size)
        self._mesh_queue = ThreadSafeQueue(maxsize=queue_size)
        self._output_queue = ThreadSafeQueue(maxsize=queue_size)

        self._sync_manager = SyncCaptureManager(self._config)
        self._depth_estimator = DepthEstimator(self._config)
        self._bg_remover = BackgroundRemover(self._config)

        if self._pipe_config.gpu_acceleration:
            try:
                import cupy
                tsdf_class = TSDFVolumeGPU
                logger.info("GPU acceleration enabled for TSDF volume")
            except ImportError:
                tsdf_class = TSDFVolumeCPU
                logger.info("CuPy not available, falling back to CPU TSDF")
        else:
            tsdf_class = TSDFVolumeCPU

        self._reconstructor = RealTimeReconstructor(self._config, tsdf_class)

        if self._pipe_config.enable_texture:
            self._texture_mapper = TextureMapper(self._config)

        if self._pipe_config.enable_mesh_optimization:
            self._mesh_optimizer = MeshOptimizer(self._config)

        if self._pipe_config.enable_export:
            self._glb_exporter = GLBExporter(self._config)

    def start(self) -> bool:
        if self._running:
            logger.warning("Pipeline already running")
            return True

        self._running = True
        self._total_start_time = time.perf_counter()

        try:
            if not self._sync_manager.start(self._capture_queue):
                logger.error("Failed to start capture manager")
                self._running = False
                return False

            self._depth_thread = WorkerThread(
                name="DepthEstimationThread",
                task_fn=self._depth_task,
                daemon=True
            )
            self._depth_thread.start()

            self._bg_thread = WorkerThread(
                name="BackgroundRemovalThread",
                task_fn=self._bg_task,
                daemon=True
            )
            self._bg_thread.start()

            self._reconstructor.start(self._bg_queue, self._mesh_queue)

            if self._pipe_config.enable_mesh_optimization:
                self._optimization_thread = WorkerThread(
                    name="MeshOptimizationThread",
                    task_fn=self._optimization_task,
                    daemon=True
                )
                self._optimization_thread.start()

            if self._pipe_config.enable_texture:
                self._texture_thread = WorkerThread(
                    name="TextureMappingThread",
                    task_fn=self._texture_task,
                    daemon=True
                )
                self._texture_thread.start()

            if self._pipe_config.enable_export:
                self._glb_exporter.start()

            logger.info("Reconstruction pipeline started successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to start pipeline: {e}", exc_info=True)
            self.stop()
            return False

    def stop(self) -> None:
        if not self._running:
            return

        self._running = False
        logger.info("Stopping reconstruction pipeline...")

        if self._sync_manager is not None:
            self._sync_manager.stop()

        if self._depth_thread is not None:
            self._depth_thread.stop(wait=True, timeout=2.0)

        if self._bg_thread is not None:
            self._bg_thread.stop(wait=True, timeout=2.0)

        if self._reconstructor is not None:
            self._reconstructor.stop()

        if self._texture_thread is not None:
            self._texture_thread.stop(wait=True, timeout=2.0)

        if self._optimization_thread is not None:
            self._optimization_thread.stop(wait=True, timeout=2.0)

        if self._glb_exporter is not None:
            self._glb_exporter.stop()

        for queue in [self._capture_queue, self._depth_queue, self._bg_queue,
                      self._mesh_queue, self._output_queue]:
            if queue is not None:
                queue.clear()

        logger.info("Reconstruction pipeline stopped")

    def _depth_task(self) -> None:
        if not self._running or self._capture_queue is None:
            time.sleep(0.005)
            return

        synced_frames = self._capture_queue.get(timeout=0.01)
        if synced_frames is None:
            return

        self._timer.start("depth_estimation")
        frames_with_depth = self._depth_estimator.estimate_from_multiview(synced_frames)
        self._timer.stop("depth_estimation")

        if frames_with_depth is not None and self._depth_queue is not None:
            self._depth_queue.put(frames_with_depth)

    def _bg_task(self) -> None:
        if not self._running or self._depth_queue is None:
            time.sleep(0.005)
            return

        synced_frames = self._depth_queue.get(timeout=0.01)
        if synced_frames is None:
            return

        self._timer.start("background_removal")
        frames_processed = self._bg_remover.process_synced_frames(synced_frames)
        self._timer.stop("background_removal")

        if frames_processed is not None:
            with self._mesh_lock:
                self._last_synced_frames = frames_processed

            if self._bg_queue is not None:
                self._bg_queue.put(frames_processed)

    def _optimization_task(self) -> None:
        if not self._running or self._mesh_queue is None:
            time.sleep(0.005)
            return

        mesh = self._mesh_queue.get(timeout=0.01)
        if mesh is None:
            return

        self._timer.start("mesh_optimization")
        optimized_mesh = self._mesh_optimizer.optimize(mesh)
        self._timer.stop("mesh_optimization")

        if optimized_mesh is not None and self._output_queue is not None:
            self._output_queue.put(optimized_mesh)

        with self._mesh_lock:
            self._last_mesh = optimized_mesh

        self._frame_count += 1
        self._update_metrics()

    def _texture_task(self) -> None:
        if not self._running or self._output_queue is None:
            time.sleep(0.005)
            return

        mesh = self._output_queue.get(timeout=0.01)
        if mesh is None:
            return

        with self._mesh_lock:
            synced_frames = self._last_synced_frames

        if synced_frames is not None and self._texture_mapper is not None:
            self._timer.start("texture_mapping")
            textured_mesh = self._texture_mapper.generate_texture(mesh, synced_frames)
            self._timer.stop("texture_mapping")

            with self._mesh_lock:
                self._last_mesh = textured_mesh

            if self._output_queue is not None:
                while True:
                    try:
                        self._output_queue.get_nowait()
                    except:
                        break
                self._output_queue.put(textured_mesh)

    def _update_metrics(self) -> None:
        elapsed = time.perf_counter() - self._total_start_time
        avg_fps = self._frame_count / elapsed if elapsed > 0 else 0.0

        capture_stats = self._sync_manager.get_statistics() if self._sync_manager else {}
        reconstructor_stats = self._reconstructor.get_statistics() if self._reconstructor else {}
        optimizer_stats = self._mesh_optimizer.get_statistics() if self._mesh_optimizer else {}
        texture_stats = self._texture_mapper.get_statistics() if self._texture_mapper else {}
        export_stats = self._glb_exporter.get_statistics() if self._glb_exporter else {}

        total_latency = (
            self._timer.average("depth_estimation") +
            self._timer.average("background_removal") +
            reconstructor_stats.get("avg_total_time_ms", 0) / 1000.0 +
            self._timer.average("mesh_optimization") +
            self._timer.average("texture_mapping")
        ) * 1000.0

        mesh_vertices = 0
        mesh_faces = 0
        with self._mesh_lock:
            if self._last_mesh is not None:
                mesh_vertices = self._last_mesh.num_vertices
                mesh_faces = self._last_mesh.num_faces

        bg_stats = self._bg_remover.get_statistics() if self._bg_remover else {}

        metrics = Metrics(
            fps=avg_fps,
            total_latency_ms=total_latency,
            capture_fps=capture_stats.get("capture_fps", 0),
            reconstruction_fps=reconstructor_stats.get("reconstruction_fps", 0),
            mesh_vertices=mesh_vertices,
            mesh_faces=mesh_faces,
            bg_misclassification_rate=bg_stats.get("estimated_misclassification_rate", 0),
            depth_estimation_ms=self._timer.average("depth_estimation") * 1000,
            bg_removal_ms=self._timer.average("background_removal") * 1000,
            reconstruction_ms=reconstructor_stats.get("avg_total_time_ms", 0),
            mesh_optimization_ms=self._timer.average("mesh_optimization") * 1000,
            texture_mapping_ms=self._timer.average("texture_mapping") * 1000
        )

        with self._metrics_lock:
            self._metrics = metrics

    def request_export(self, output_path: str) -> bool:
        if self._glb_exporter is None:
            logger.warning("GLB exporter not enabled")
            return False

        with self._mesh_lock:
            if self._last_mesh is None:
                logger.warning("No mesh available for export")
                return False
            mesh = self._last_mesh.copy()

        def export_callback(result):
            logger.info(f"Export {'completed' if result.success else 'failed'}: {result.output_path}")
            if not result.success:
                logger.error(f"Export error: {result.error_message}")

        return self._glb_exporter.export(
            mesh=mesh,
            output_path=output_path,
            include_texture=True,
            callback=export_callback
        )

    def get_latest_mesh(self) -> Optional[Mesh]:
        with self._mesh_lock:
            return self._last_mesh.copy() if self._last_mesh is not None else None

    def get_latest_frames(self) -> Optional[SyncedFrames]:
        with self._mesh_lock:
            return self._last_synced_frames

    def get_metrics(self) -> Metrics:
        with self._metrics_lock:
            return self._metrics

    def wait_for_export(self, timeout: float = 10.0) -> bool:
        if self._glb_exporter is None:
            return True
        return self._glb_exporter.wait_for_completion(timeout=timeout)

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_export_busy(self) -> bool:
        return self._glb_exporter.is_busy if self._glb_exporter else False

    @property
    def config(self) -> PipelineConfig:
        return self._pipe_config
