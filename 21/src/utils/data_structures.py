import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Tuple
from enum import Enum


class CameraType(Enum):
    RGB = "rgb"
    DEPTH = "depth"
    STEREO = "stereo"


@dataclass
class CameraIntrinsic:
    fx: float
    fy: float
    cx: float
    cy: float
    distortion: np.ndarray = field(default_factory=lambda: np.zeros(5))

    @property
    def matrix(self) -> np.ndarray:
        return np.array([
            [self.fx, 0, self.cx],
            [0, self.fy, self.cy],
            [0, 0, 1]
        ], dtype=np.float64)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "fx": float(self.fx),
            "fy": float(self.fy),
            "cx": float(self.cx),
            "cy": float(self.cy),
            "distortion": self.distortion.tolist()
        }


@dataclass
class CameraExtrinsic:
    rotation: np.ndarray
    translation: np.ndarray

    @property
    def matrix(self) -> np.ndarray:
        mat = np.eye(4, dtype=np.float64)
        mat[:3, :3] = self.rotation
        mat[:3, 3] = self.translation
        return mat

    @property
    def inverse(self) -> np.ndarray:
        mat = np.eye(4, dtype=np.float64)
        mat[:3, :3] = self.rotation.T
        mat[:3, 3] = -self.rotation.T @ self.translation
        return mat

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rotation": self.rotation.tolist(),
            "translation": self.translation.tolist()
        }


@dataclass
class Frame:
    camera_id: int
    timestamp: float
    image: np.ndarray
    depth: Optional[np.ndarray] = None
    mask: Optional[np.ndarray] = None
    intrinsic: Optional[CameraIntrinsic] = None
    extrinsic: Optional[CameraExtrinsic] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def shape(self) -> Tuple[int, int]:
        return self.image.shape[:2]


@dataclass
class SyncedFrames:
    frames: List[Frame]
    timestamp: float
    sequence_id: int

    def __len__(self) -> int:
        return len(self.frames)

    def __getitem__(self, idx: int) -> Frame:
        return self.frames[idx]

    def images(self) -> List[np.ndarray]:
        return [f.image for f in self.frames]

    def depths(self) -> List[Optional[np.ndarray]]:
        return [f.depth for f in self.frames]

    def masks(self) -> List[Optional[np.ndarray]]:
        return [f.mask for f in self.frames]


@dataclass
class Vertex:
    position: np.ndarray
    normal: Optional[np.ndarray] = None
    texcoord: Optional[np.ndarray] = None
    color: Optional[np.ndarray] = None


@dataclass
class Triangle:
    v0: int
    v1: int
    v2: int


@dataclass
class Mesh:
    vertices: np.ndarray
    faces: np.ndarray
    normals: Optional[np.ndarray] = None
    texcoords: Optional[np.ndarray] = None
    face_texcoords: Optional[np.ndarray] = None
    colors: Optional[np.ndarray] = None
    texture: Optional[np.ndarray] = None
    material: Optional[Dict[str, Any]] = None
    timestamp: float = 0.0

    @property
    def num_vertices(self) -> int:
        return len(self.vertices)

    @property
    def num_faces(self) -> int:
        return len(self.faces)

    def is_empty(self) -> bool:
        return self.num_vertices == 0 or self.num_faces == 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "num_vertices": self.num_vertices,
            "num_faces": self.num_faces,
            "has_normals": self.normals is not None,
            "has_texcoords": self.texcoords is not None,
            "has_texture": self.texture is not None,
            "has_colors": self.colors is not None
        }


@dataclass
class TSDFVolume:
    voxel_size: float
    volume_bounds: np.ndarray
    tsdf: Optional[np.ndarray] = None
    weights: Optional[np.ndarray] = None
    colors: Optional[np.ndarray] = None

    @property
    def dimensions(self) -> np.ndarray:
        return np.ceil((self.volume_bounds[:, 1] - self.volume_bounds[:, 0]) / self.voxel_size).astype(int)

    @property
    def center(self) -> np.ndarray:
        return (self.volume_bounds[:, 0] + self.volume_bounds[:, 1]) / 2.0

    def voxel_to_world(self, voxel_idx: np.ndarray) -> np.ndarray:
        return self.volume_bounds[:, 0] + (voxel_idx.astype(np.float64) + 0.5) * self.voxel_size

    def world_to_voxel(self, world_pos: np.ndarray) -> np.ndarray:
        return ((world_pos - self.volume_bounds[:, 0]) / self.voxel_size).astype(int)


@dataclass
class TextureMap:
    image: np.ndarray
    uv_coords: np.ndarray
    face_uv_indices: np.ndarray
    resolution: int = 2048


@dataclass
class Metrics:
    total_fps: float = 0.0
    reconstruction_fps: float = 0.0
    capture_fps: float = 0.0
    total_latency_ms: float = 0.0
    capture_latency_ms: float = 0.0
    background_latency_ms: float = 0.0
    reconstruction_latency_ms: float = 0.0
    texture_latency_ms: float = 0.0
    mesh_optimization_latency_ms: float = 0.0
    background_error_rate: float = 0.0
    num_vertices: int = 0
    num_faces: int = 0
    is_manifold: bool = False
    has_holes: bool = False
    timestamp: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_fps": self.total_fps,
            "reconstruction_fps": self.reconstruction_fps,
            "capture_fps": self.capture_fps,
            "total_latency_ms": self.total_latency_ms,
            "background_error_rate": self.background_error_rate,
            "num_vertices": self.num_vertices,
            "num_faces": self.num_faces,
            "is_manifold": self.is_manifold,
            "has_holes": self.has_holes,
            "timestamp": self.timestamp
        }
