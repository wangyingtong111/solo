import os
import struct
import json
import zlib
import numpy as np
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum
from io import BytesIO

from src.utils import (
    Config,
    Mesh,
    ThreadSafeQueue,
    WorkerThread,
    MultiTimer,
    get_logger
)

logger = get_logger("export")


class ChunkType(Enum):
    JSON = 0x4E4F534A
    BIN = 0x004E4942


@dataclass
class ExportRequest:
    mesh: Mesh
    output_path: str
    include_texture: bool = True
    include_normals: bool = True
    compress: bool = True
    callback: Optional[callable] = None


@dataclass
class ExportResult:
    success: bool
    output_path: str
    error_message: Optional[str] = None
    export_time_ms: float = 0.0
    file_size_bytes: int = 0


class GLBExporter:
    def __init__(self, config: Config):
        self._config = config
        self._export_queue: Optional[ThreadSafeQueue] = None
        self._worker: Optional[WorkerThread] = None
        self._timer = MultiTimer()
        self._running = False
        self._include_normals = config.get("export.include_normals", True)
        self._include_texcoords = config.get("export.include_texcoords", True)
        self._compress_textures = config.get("export.compress_textures", True)
        self._texture_format = config.get("export.texture_format", "jpeg")
        self._texture_quality = config.get("export.texture_quality", 95)
        self._async_export = config.get("export.async_export", True)
        self._queue_size = config.get("export.export_queue_size", 3)
        self._last_export_result: Optional[ExportResult] = None

    def start(self) -> None:
        if self._async_export:
            self._export_queue = ThreadSafeQueue(maxsize=self._queue_size)
            self._worker = WorkerThread(
                name="GLBExportWorker",
                task_fn=self._export_loop,
                daemon=True
            )
            self._worker.start()
            self._running = True
            logger.info("GLB asynchronous exporter started")

    def stop(self) -> None:
        self._running = False
        if self._worker is not None:
            self._worker.stop(wait=True, timeout=5.0)
            self._worker = None
        if self._export_queue is not None:
            self._export_queue.clear()
        logger.info("GLB exporter stopped")

    def export(self, mesh: Mesh, output_path: str,
               include_texture: bool = True,
               callback: Optional[callable] = None) -> bool:
        request = ExportRequest(
            mesh=mesh,
            output_path=output_path,
            include_texture=include_texture,
            callback=callback
        )

        if self._async_export and self._export_queue is not None:
            if not self._export_queue.put_nowait(request):
                logger.warning("Export queue full, dropping export request")
                return False
            return True
        else:
            result = self._export_glb(request)
            self._last_export_result = result
            if callback:
                callback(result)
            return result.success

    def _export_loop(self) -> None:
        if not self._running or self._export_queue is None:
            time.sleep(0.01)
            return

        request = self._export_queue.get(timeout=0.1)
        if request is None:
            return

        result = self._export_glb(request)
        self._last_export_result = result

        if request.callback:
            try:
                request.callback(result)
            except Exception as e:
                logger.error(f"Export callback error: {e}")

        self._export_queue.task_done()

    def _export_glb(self, request: ExportRequest) -> ExportResult:
        self._timer.start("export_total")
        start_time = time.perf_counter()

        try:
            os.makedirs(os.path.dirname(request.output_path), exist_ok=True)

            gltf_data, bin_data = self._build_gltf(request)

            glb_data = self._build_glb(gltf_data, bin_data)

            with open(request.output_path, "wb") as f:
                f.write(glb_data)

            file_size = os.path.getsize(request.output_path)
            export_time = (time.perf_counter() - start_time) * 1000

            self._timer.stop("export_total")

            logger.info(f"GLB exported successfully: {request.output_path}, "
                       f"{file_size} bytes, {export_time:.1f}ms")

            return ExportResult(
                success=True,
                output_path=request.output_path,
                export_time_ms=export_time,
                file_size_bytes=file_size
            )

        except Exception as e:
            self._timer.stop("export_total")
            logger.error(f"GLB export failed: {e}", exc_info=True)
            return ExportResult(
                success=False,
                output_path=request.output_path,
                error_message=str(e),
                export_time_ms=(time.perf_counter() - start_time) * 1000
            )

    def _build_gltf(self, request: ExportRequest) -> Tuple[Dict[str, Any], bytes]:
        mesh = request.mesh

        accessors = []
        buffer_views = []
        buffers = []
        bin_buffer = BytesIO()
        byte_offset = 0

        vertices = mesh.vertices.astype(np.float32)
        vertices_min = vertices.min(axis=0).tolist()
        vertices_max = vertices.max(axis=0).tolist()
        vertices_data = vertices.tobytes()
        buffer_views.append({
            "buffer": 0,
            "byteOffset": byte_offset,
            "byteLength": len(vertices_data),
            "target": 34962
        })
        accessors.append({
            "bufferView": len(buffer_views) - 1,
            "componentType": 5126,
            "count": len(vertices),
            "type": "VEC3",
            "min": vertices_min,
            "max": vertices_max
        })
        bin_buffer.write(vertices_data)
        byte_offset += len(vertices_data)

        if self._include_normals and mesh.normals is not None:
            normals = mesh.normals.astype(np.float32)
            normals_data = normals.tobytes()
            buffer_views.append({
                "buffer": 0,
                "byteOffset": byte_offset,
                "byteLength": len(normals_data),
                "target": 34962
            })
            accessors.append({
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": len(normals),
                "type": "VEC3",
                "min": normals.min(axis=0).tolist(),
                "max": normals.max(axis=0).tolist()
            })
            bin_buffer.write(normals_data)
            byte_offset += len(normals_data)

        if self._include_texcoords and mesh.texcoords is not None:
            texcoords = mesh.texcoords.astype(np.float32)
            texcoords[:, 1] = 1.0 - texcoords[:, 1]
            texcoords_data = texcoords.tobytes()
            buffer_views.append({
                "buffer": 0,
                "byteOffset": byte_offset,
                "byteLength": len(texcoords_data),
                "target": 34962
            })
            accessors.append({
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": len(texcoords),
                "type": "VEC2",
                "min": texcoords.min(axis=0).tolist(),
                "max": texcoords.max(axis=0).tolist()
            })
            bin_buffer.write(texcoords_data)
            byte_offset += len(texcoords_data)

        faces = mesh.faces.astype(np.uint32)
        faces_data = faces.tobytes()
        buffer_views.append({
            "buffer": 0,
            "byteOffset": byte_offset,
            "byteLength": len(faces_data),
            "target": 34963
        })
        accessors.append({
            "bufferView": len(buffer_views) - 1,
            "componentType": 5125,
            "count": faces.size,
            "type": "SCALAR",
            "min": [int(faces.min())],
            "max": [int(faces.max())]
        })
        bin_buffer.write(faces_data)
        byte_offset += len(faces_data)

        image_data = None
        if request.include_texture and mesh.texture is not None:
            import cv2
            texture = mesh.texture
            if self._texture_format == "jpeg":
                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), self._texture_quality]
                success, encoded = cv2.imencode(".jpg", cv2.cvtColor(texture, cv2.COLOR_RGB2BGR), encode_param)
                if success:
                    image_data = encoded.tobytes()
            else:
                encode_param = [int(cv2.IMWRITE_PNG_COMPRESSION), 9]
                success, encoded = cv2.imencode(".png", cv2.cvtColor(texture, cv2.COLOR_RGB2BGR), encode_param)
                if success:
                    image_data = encoded.tobytes()

            if image_data is not None:
                buffer_views.append({
                    "buffer": 0,
                    "byteOffset": byte_offset,
                    "byteLength": len(image_data)
                })
                bin_buffer.write(image_data)
                byte_offset += len(image_data)

        bin_bytes = bin_buffer.getvalue()

        if self._compress_textures and image_data is not None:
            pass

        buffers.append({
            "byteLength": len(bin_bytes)
        })

        materials = []
        textures = []
        images = []
        samplers = []
        material_index = 0

        if image_data is not None:
            samplers.append({
                "magFilter": 9729,
                "minFilter": 9987,
                "wrapS": 10497,
                "wrapT": 10497
            })

            images.append({
                "bufferView": len(buffer_views) - 1,
                "mimeType": "image/jpeg" if self._texture_format == "jpeg" else "image/png"
            })

            textures.append({
                "sampler": 0,
                "source": 0
            })

            material = {
                "name": "TextureMaterial",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {
                        "index": 0,
                        "texCoord": 0
                    },
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0
                }
            }
            if mesh.colors is not None:
                avg_color = mesh.colors.mean(axis=0).tolist()
                material["pbrMetallicRoughness"]["baseColorFactor"] = avg_color + [1.0]
            materials.append(material)
        else:
            material = {
                "name": "DefaultMaterial",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.8, 0.8, 0.8, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0
                }
            }
            materials.append(material)

        primitives = [
            {
                "attributes": {
                    "POSITION": 0
                },
                "indices": len(accessors) - 1,
                "material": material_index
            }
        ]

        attr_index = 1
        if self._include_normals and mesh.normals is not None:
            primitives[0]["attributes"]["NORMAL"] = attr_index
            attr_index += 1

        if self._include_texcoords and mesh.texcoords is not None:
            primitives[0]["attributes"]["TEXCOORD_0"] = attr_index
            attr_index += 1

        gltf = {
            "asset": {
                "version": "2.0",
                "generator": "RealTime3DReconstruction v1.0"
            },
            "scene": 0,
            "scenes": [
                {
                    "nodes": [0]
                }
            ],
            "nodes": [
                {
                    "mesh": 0
                }
            ],
            "meshes": [
                {
                    "primitives": primitives
                }
            ],
            "materials": materials,
            "accessors": accessors,
            "bufferViews": buffer_views,
            "buffers": buffers
        }

        if textures:
            gltf["textures"] = textures
            gltf["images"] = images
            gltf["samplers"] = samplers

        return gltf, bin_bytes

    def _build_glb(self, gltf_data: Dict[str, Any], bin_data: bytes) -> bytes:
        gltf_json = json.dumps(gltf_data, separators=(',', ':'))
        gltf_bytes = gltf_json.encode('utf-8')

        json_padding = (4 - (len(gltf_bytes) % 4)) % 4
        gltf_bytes += b' ' * json_padding

        bin_padding = (4 - (len(bin_data) % 4)) % 4
        bin_data_padded = bin_data + b'\x00' * bin_padding

        version = 2
        length = 12 + 8 + len(gltf_bytes) + 8 + len(bin_data_padded)

        header = struct.pack('<III', 0x46546C67, version, length)

        json_chunk_header = struct.pack('<II', len(gltf_bytes), ChunkType.JSON.value)
        bin_chunk_header = struct.pack('<II', len(bin_data_padded), ChunkType.BIN.value)

        return header + json_chunk_header + gltf_bytes + bin_chunk_header + bin_data_padded

    def get_last_result(self) -> Optional[ExportResult]:
        return self._last_export_result

    def get_statistics(self) -> Dict:
        stats = {
            "avg_export_time_ms": self._timer.average("export_total") * 1000,
            "export_fps": self._timer.fps("export_total"),
            "queue_size": self._export_queue.qsize() if self._export_queue else 0,
            "is_running": self._running
        }
        if self._last_export_result:
            stats["last_export_success"] = self._last_export_result.success
            stats["last_export_size_mb"] = self._last_export_result.file_size_bytes / (1024 * 1024)
            stats["last_export_path"] = self._last_export_result.output_path
        return stats

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_busy(self) -> bool:
        if self._export_queue is None:
            return False
        return not self._export_queue.empty()

    def wait_for_completion(self, timeout: Optional[float] = None) -> bool:
        if self._export_queue is None:
            return True
        return self._export_queue.join(timeout=timeout)
