import numpy as np
import cv2
from typing import Optional, Dict, Tuple, List
from dataclasses import dataclass

from src.utils import (
    Config,
    Mesh,
    TextureMap,
    SyncedFrames,
    Frame,
    MultiTimer,
    get_logger
)

logger = get_logger("texture")


@dataclass
class TextureConfig:
    resolution: int = 2048
    filtering: str = "bilinear"
    mipmap: bool = True
    blend_mode: str = "average"
    view_angle_threshold: float = 60.0
    max_texture_size: int = 2048
    min_texture_size: int = 256
    padding: int = 2


class TextureMapper:
    def __init__(self, config: Config):
        self._config = config
        self._tex_config = TextureConfig(
            resolution=config.get("texture.resolution", 2048),
            filtering=config.get("texture.filtering", "bilinear"),
            mipmap=config.get("texture.mipmap", True),
            blend_mode=config.get("texture.blend_mode", "average"),
            view_angle_threshold=config.get("texture.view_angle_threshold", 60),
            max_texture_size=config.get("texture.max_texture_size", 2048),
            min_texture_size=config.get("texture.min_texture_size", 256)
        )
        self._timer = MultiTimer()
        self._uv_cache: Optional[np.ndarray] = None
        self._face_uv_indices_cache: Optional[np.ndarray] = None
        self._last_mesh_hash: Optional[int] = None

    def generate_texture(self, mesh: Mesh, synced_frames: SyncedFrames) -> Mesh:
        if mesh.is_empty():
            return mesh

        self._timer.start("texture_total")

        self._timer.start("uv_unwrap")
        uvs, face_uv_indices = self._compute_uv_coordinates(mesh)
        self._timer.stop("uv_unwrap")

        self._timer.start("texture_atlas")
        texture_image = self._bake_texture(mesh, uvs, face_uv_indices, synced_frames)
        self._timer.stop("texture_atlas")

        mesh.texcoords = uvs.astype(np.float32)
        mesh.face_texcoords = face_uv_indices.astype(np.int32)
        mesh.texture = texture_image

        mesh.material = {
            "baseColorTexture": "texture",
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0,
            "doubleSided": True
        }

        self._timer.stop("texture_total")

        logger.info(f"Texture generated: {texture_image.shape}, {mesh.num_vertices} vertices, {mesh.num_faces} faces")

        return mesh

    def _compute_uv_coordinates(self, mesh: Mesh) -> Tuple[np.ndarray, np.ndarray]:
        mesh_hash = hash((mesh.vertices.tobytes(), mesh.faces.tobytes()))

        if self._last_mesh_hash == mesh_hash and self._uv_cache is not None:
            return self._uv_cache, self._face_uv_indices_cache

        vertices = mesh.vertices
        faces = mesh.faces

        min_v = np.min(vertices, axis=0)
        max_v = np.max(vertices, axis=0)
        range_v = max_v - min_v
        range_v[range_v == 0] = 1.0

        centered = (vertices - min_v) / range_v

        uvs = np.zeros((len(vertices), 2), dtype=np.float64)

        if mesh.normals is not None:
            normals = mesh.normals
            for i in range(len(vertices)):
                normal = normals[i]

                if abs(normal[2]) >= abs(normal[0]) and abs(normal[2]) >= abs(normal[1]):
                    uvs[i] = [centered[i, 0], centered[i, 1]]
                elif abs(normal[1]) >= abs(normal[0]) and abs(normal[1]) >= abs(normal[2]):
                    uvs[i] = [centered[i, 0], centered[i, 2]]
                else:
                    uvs[i] = [centered[i, 1], centered[i, 2]]
        else:
            uvs = centered[:, :2].copy()

        uvs = np.clip(uvs, 0.0, 1.0)

        face_uv_indices = faces.copy()

        uvs, unique_indices = np.unique(uvs, axis=0, return_inverse=True)
        face_uv_indices = unique_indices[face_uv_indices]

        self._uv_cache = uvs
        self._face_uv_indices_cache = face_uv_indices
        self._last_mesh_hash = mesh_hash

        return uvs, face_uv_indices

    def _bake_texture(self, mesh: Mesh, uvs: np.ndarray,
                      face_uv_indices: np.ndarray,
                      synced_frames: SyncedFrames) -> np.ndarray:
        tex_size = self._tex_config.resolution
        padding = self._tex_config.padding
        texture = np.zeros((tex_size, tex_size, 3), dtype=np.float32)
        weight_sum = np.zeros((tex_size, tex_size), dtype=np.float32)

        vertices = mesh.vertices
        faces = mesh.faces

        if mesh.normals is None:
            mesh.normals = self._compute_normals(vertices, faces)

        for frame in synced_frames.frames:
            if frame.intrinsic is None or frame.extrinsic is None:
                continue

            self._timer.start(f"bake_cam_{frame.camera_id}")

            image = frame.image.astype(np.float32) / 255.0
            h, w = image.shape[:2]

            intrinsic = frame.intrinsic.matrix
            extrinsic = frame.extrinsic.matrix
            cam_position = -extrinsic[:3, :3].T @ extrinsic[:3, 3]

            for face_idx in range(len(faces)):
                v0, v1, v2 = faces[face_idx]
                uv0_idx, uv1_idx, uv2_idx = face_uv_indices[face_idx]

                vert0, vert1, vert2 = vertices[v0], vertices[v1], vertices[v2]
                uv0, uv1, uv2 = uvs[uv0_idx], uvs[uv1_idx], uvs[uv2_idx]

                normal = mesh.normals[v0]

                view_dir = cam_position - vert0
                view_dir_norm = np.linalg.norm(view_dir)
                if view_dir_norm > 0:
                    view_dir /= view_dir_norm

                view_angle = np.degrees(np.arccos(np.clip(np.dot(normal, view_dir), -1.0, 1.0)))
                if view_angle > self._tex_config.view_angle_threshold:
                    weight = 0.0
                else:
                    weight = np.cos(np.radians(view_angle))
                    weight = max(0.0, weight)

                if weight <= 0:
                    continue

                cam_points = (extrinsic[:3, :3] @ np.array([vert0, vert1, vert2]).T + extrinsic[:3, 3:4]).T

                z_vals = cam_points[:, 2]
                if np.any(z_vals <= 0):
                    continue

                u_vals = (cam_points[:, 0] * intrinsic[0, 0] / cam_points[:, 2] + intrinsic[0, 2]).astype(int)
                v_vals = (cam_points[:, 1] * intrinsic[1, 1] / cam_points[:, 2] + intrinsic[1, 2]).astype(int)

                if not (np.all(u_vals >= 0) and np.all(u_vals < w) and
                        np.all(v_vals >= 0) and np.all(v_vals < h)):
                    continue

                color0 = image[v_vals[0], u_vals[0]]
                color1 = image[v_vals[1], u_vals[1]]
                color2 = image[v_vals[2], u_vals[2]]

                self._rasterize_triangle(
                    uv0, uv1, uv2,
                    color0, color1, color2,
                    weight,
                    texture, weight_sum,
                    tex_size, padding
                )

            self._timer.stop(f"bake_cam_{frame.camera_id}")

        valid_mask = weight_sum > 0
        texture[valid_mask] /= weight_sum[valid_mask, np.newaxis]

        default_color = np.array([0.8, 0.8, 0.8], dtype=np.float32)
        texture[~valid_mask] = default_color

        texture = (texture * 255).astype(np.uint8)

        if self._tex_config.filtering == "bilinear":
            texture = cv2.bilateralFilter(texture, 5, 50, 50)

        return texture

    def _rasterize_triangle(self, uv0: np.ndarray, uv1: np.ndarray, uv2: np.ndarray,
                            c0: np.ndarray, c1: np.ndarray, c2: np.ndarray,
                            weight: float,
                            texture: np.ndarray, weight_sum: np.ndarray,
                            tex_size: int, padding: int) -> None:
        u0, v0 = uv0 * (tex_size - 2 * padding) + padding
        u1, v1 = uv1 * (tex_size - 2 * padding) + padding
        u2, v2 = uv2 * (tex_size - 2 * padding) + padding

        min_u = int(max(0, min(u0, u1, u2)))
        max_u = int(min(tex_size - 1, max(u0, u1, u2)))
        min_v = int(max(0, min(v0, v1, v2)))
        max_v = int(min(tex_size - 1, max(v0, v1, v2)))

        if min_u >= max_u or min_v >= max_v:
            return

        area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
        if abs(area) < 1e-6:
            return

        for v in range(min_v, max_v + 1):
            for u in range(min_u, max_u + 1):
                w0 = ((u1 - u) * (v2 - v) - (u2 - u) * (v1 - v)) / area
                w1 = ((u2 - u) * (v0 - v) - (u0 - u) * (v2 - v)) / area
                w2 = 1.0 - w0 - w1

                if w0 >= 0 and w1 >= 0 and w2 >= 0:
                    color = w0 * c0 + w1 * c1 + w2 * c2
                    texture[v, u] += color * weight
                    weight_sum[v, u] += weight

    @staticmethod
    def _compute_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
        normals = np.zeros_like(vertices, dtype=np.float64)

        v0 = vertices[faces[:, 0]]
        v1 = vertices[faces[:, 1]]
        v2 = vertices[faces[:, 2]]

        face_normals = np.cross(v1 - v0, v2 - v0)
        face_norms = np.linalg.norm(face_normals, axis=1, keepdims=True)
        face_norms[face_norms == 0] = 1
        face_normals /= face_norms

        for i in range(len(faces)):
            normals[faces[i, 0]] += face_normals[i]
            normals[faces[i, 1]] += face_normals[i]
            normals[faces[i, 2]] += face_normals[i]

        vertex_norms = np.linalg.norm(normals, axis=1, keepdims=True)
        vertex_norms[vertex_norms == 0] = 1
        normals /= vertex_norms

        return normals

    def update_texture_fast(self, mesh: Mesh, frame: Frame) -> Optional[Mesh]:
        if mesh.is_empty() or mesh.texture is None:
            return mesh

        if mesh.texcoords is None or mesh.face_texcoords is None:
            return self.generate_texture(mesh, SyncedFrames(frames=[frame], timestamp=frame.timestamp, sequence_id=0))

        tex_size = self._tex_config.resolution
        texture = mesh.texture.astype(np.float32) / 255.0
        weight_sum = np.ones((tex_size, tex_size), dtype=np.float32)

        vertices = mesh.vertices
        faces = mesh.faces
        uvs = mesh.texcoords
        face_uv_indices = mesh.face_texcoords

        if frame.intrinsic is None or frame.extrinsic is None:
            return mesh

        image = frame.image.astype(np.float32) / 255.0
        h, w = image.shape[:2]

        intrinsic = frame.intrinsic.matrix
        extrinsic = frame.extrinsic.matrix

        if mesh.normals is None:
            mesh.normals = self._compute_normals(vertices, faces)

        cam_position = -extrinsic[:3, :3].T @ extrinsic[:3, 3]

        for face_idx in range(len(faces)):
            v0, v1, v2 = faces[face_idx]
            uv0_idx, uv1_idx, uv2_idx = face_uv_indices[face_idx]

            vert0, vert1, vert2 = vertices[v0], vertices[v1], vertices[v2]
            uv0, uv1, uv2 = uvs[uv0_idx], uvs[uv1_idx], uvs[uv2_idx]

            normal = mesh.normals[v0]
            view_dir = cam_position - vert0
            view_dir_norm = np.linalg.norm(view_dir)
            if view_dir_norm > 0:
                view_dir /= view_dir_norm

            view_angle = np.degrees(np.arccos(np.clip(np.dot(normal, view_dir), -1.0, 1.0)))
            if view_angle > self._tex_config.view_angle_threshold:
                continue

            weight = np.cos(np.radians(view_angle))
            if weight <= 0:
                continue

            cam_points = (extrinsic[:3, :3] @ np.array([vert0, vert1, vert2]).T + extrinsic[:3, 3:4]).T
            z_vals = cam_points[:, 2]
            if np.any(z_vals <= 0):
                continue

            u_vals = (cam_points[:, 0] * intrinsic[0, 0] / cam_points[:, 2] + intrinsic[0, 2]).astype(int)
            v_vals = (cam_points[:, 1] * intrinsic[1, 1] / cam_points[:, 2] + intrinsic[1, 2]).astype(int)

            if not (np.all(u_vals >= 0) and np.all(u_vals < w) and
                    np.all(v_vals >= 0) and np.all(v_vals < h)):
                continue

            color0 = image[v_vals[0], u_vals[0]]
            color1 = image[v_vals[1], u_vals[1]]
            color2 = image[v_vals[2], u_vals[2]]

            alpha = 0.1
            self._update_triangle_texture(
                uv0, uv1, uv2,
                color0, color1, color2,
                weight, alpha,
                texture, tex_size
            )

        mesh.texture = (np.clip(texture, 0.0, 1.0) * 255).astype(np.uint8)
        return mesh

    def _update_triangle_texture(self, uv0: np.ndarray, uv1: np.ndarray, uv2: np.ndarray,
                                  c0: np.ndarray, c1: np.ndarray, c2: np.ndarray,
                                  weight: float, alpha: float,
                                  texture: np.ndarray, tex_size: int) -> None:
        padding = self._tex_config.padding
        u0, v0 = uv0 * (tex_size - 2 * padding) + padding
        u1, v1 = uv1 * (tex_size - 2 * padding) + padding
        u2, v2 = uv2 * (tex_size - 2 * padding) + padding

        center_u = int((u0 + u1 + u2) / 3)
        center_v = int((v0 + v1 + v2) / 3)

        if 0 <= center_u < tex_size and 0 <= center_v < tex_size:
            center_color = (c0 + c1 + c2) / 3
            texture[center_v, center_u] = (1 - alpha) * texture[center_v, center_u] + alpha * center_color * weight

    def get_statistics(self) -> Dict:
        return {
            "avg_total_time_ms": self._timer.average("texture_total") * 1000,
            "avg_uv_time_ms": self._timer.average("uv_unwrap") * 1000,
            "avg_bake_time_ms": self._timer.average("texture_atlas") * 1000,
            "texture_fps": self._timer.fps("texture_total")
        }

    @property
    def texture_resolution(self) -> int:
        return self._tex_config.resolution
