import numpy as np
from typing import Optional, Dict, Tuple, List
from dataclasses import dataclass
from collections import defaultdict

from src.utils import (
    Config,
    Mesh,
    MultiTimer,
    get_logger
)

logger = get_logger("mesh")


@dataclass
class MeshOptConfig:
    enable_manifold: bool = True
    remesh_target_edge_length: float = 0.003
    smooth_iterations: int = 2
    hole_filling_max_iterations: int = 100
    decimation_ratio: float = 0.8
    target_vertices: int = 45000
    max_vertices: int = 50000
    min_vertices: int = 1000


class MeshOptimizer:
    def __init__(self, config: Config):
        self._config = config
        self._opt_config = MeshOptConfig(
            enable_manifold=config.get("mesh_optimization.enable_manifold", True),
            remesh_target_edge_length=config.get("mesh_optimization.remesh_target_edge_length", 0.003),
            smooth_iterations=config.get("mesh_optimization.smooth_iterations", 2),
            hole_filling_max_iterations=config.get("mesh_optimization.hole_filling_max_iterations", 100),
            decimation_ratio=config.get("mesh_optimization.decimation_ratio", 0.8),
            target_vertices=config.get("mesh_optimization.target_vertices", 45000),
            max_vertices=config.get("reconstruction.max_vertices", 50000)
        )
        self._timer = MultiTimer()

    def optimize(self, mesh: Mesh) -> Mesh:
        if mesh.is_empty():
            return mesh

        self._timer.start("optimization_total")

        self._timer.start("check_manifold")
        is_manifold, has_holes = self._check_manifold_and_holes(mesh)
        self._timer.stop("check_manifold")

        if self._opt_config.enable_manifold and has_holes:
            self._timer.start("hole_filling")
            mesh = self._fill_holes(mesh)
            self._timer.stop("hole_filling")

        if self._opt_config.smooth_iterations > 0:
            self._timer.start("smoothing")
            mesh = self._laplacian_smoothing(mesh, self._opt_config.smooth_iterations)
            self._timer.stop("smoothing")

        if mesh.num_vertices > self._opt_config.max_vertices:
            self._timer.start("decimation")
            mesh = self._decimate_mesh(mesh, self._opt_config.target_vertices)
            self._timer.stop("decimation")

        if self._opt_config.enable_manifold:
            self._timer.start("make_manifold")
            mesh = self._ensure_manifold(mesh)
            self._timer.stop("make_manifold")

        mesh = self._recompute_normals(mesh)

        is_manifold, has_holes = self._check_manifold_and_holes(mesh)

        self._timer.stop("optimization_total")

        logger.info(f"Mesh optimized: {mesh.num_vertices} vertices, {mesh.num_faces} faces, "
                   f"manifold={is_manifold}, has_holes={has_holes}")

        return mesh

    def _check_manifold_and_holes(self, mesh: Mesh) -> Tuple[bool, bool]:
        vertices = mesh.vertices
        faces = mesh.faces

        if len(vertices) == 0 or len(faces) == 0:
            return False, True

        edge_face_count = defaultdict(int)

        for face in faces:
            v0, v1, v2 = sorted(face)
            edge_face_count[(v0, v1)] += 1
            edge_face_count[(v1, v2)] += 1
            edge_face_count[(v0, v2)] += 1

        boundary_edges = 0
        is_manifold = True

        for edge, count in edge_face_count.items():
            if count == 1:
                boundary_edges += 1
            elif count > 2:
                is_manifold = False

        has_holes = boundary_edges > 0

        return is_manifold, has_holes

    def _fill_holes(self, mesh: Mesh, max_iterations: int = 100) -> Mesh:
        vertices = mesh.vertices
        faces = mesh.faces.tolist()

        for _ in range(max_iterations):
            edge_face_map = defaultdict(list)

            for face_idx, face in enumerate(faces):
                v0, v1, v2 = face
                edges = [(v0, v1), (v1, v2), (v2, v0)]
                for edge in edges:
                    sorted_edge = tuple(sorted(edge))
                    edge_face_map[sorted_edge].append(face_idx)

            boundary_edges = []
            for edge, face_indices in edge_face_map.items():
                if len(face_indices) == 1:
                    boundary_edges.append(edge)

            if not boundary_edges:
                break

            edge_connections = defaultdict(list)
            for v0, v1 in boundary_edges:
                edge_connections[v0].append(v1)
                edge_connections[v1].append(v0)

            loops = []
            visited_edges = set()

            for start_edge in boundary_edges:
                if tuple(sorted(start_edge)) in visited_edges:
                    continue

                loop = []
                current_v = start_edge[0]
                next_v = start_edge[1]
                loop.append(current_v)

                while next_v != start_edge[0] and len(loop) < 1000:
                    loop.append(next_v)
                    visited_edges.add(tuple(sorted((current_v, next_v))))

                    neighbors = edge_connections[next_v]
                    if len(neighbors) < 2:
                        break

                    if neighbors[0] == current_v:
                        current_v, next_v = next_v, neighbors[1]
                    else:
                        current_v, next_v = next_v, neighbors[0]

                if len(loop) >= 3:
                    loops.append(loop)

            if not loops:
                break

            for loop in loops:
                if len(loop) == 3:
                    faces.append([loop[0], loop[1], loop[2]])
                elif len(loop) == 4:
                    faces.append([loop[0], loop[1], loop[2]])
                    faces.append([loop[0], loop[2], loop[3]])
                else:
                    center = np.mean(vertices[loop], axis=0)
                    center_idx = len(vertices)
                    vertices = np.vstack([vertices, center])

                    for i in range(len(loop)):
                        v0 = loop[i]
                        v1 = loop[(i + 1) % len(loop)]
                        faces.append([v0, v1, center_idx])

        mesh.vertices = vertices
        mesh.faces = np.array(faces, dtype=np.int32)

        return mesh

    def _laplacian_smoothing(self, mesh: Mesh, iterations: int = 2) -> Mesh:
        vertices = mesh.vertices
        faces = mesh.faces

        if len(vertices) < 3 or len(faces) == 0:
            return mesh

        adjacency = defaultdict(set)
        for face in faces:
            v0, v1, v2 = face
            adjacency[v0].add(v1)
            adjacency[v0].add(v2)
            adjacency[v1].add(v0)
            adjacency[v1].add(v2)
            adjacency[v2].add(v0)
            adjacency[v2].add(v1)

        smoothed = vertices.copy()

        for _ in range(iterations):
            for v_idx in range(len(vertices)):
                neighbors = adjacency.get(v_idx, set())
                if not neighbors:
                    continue

                neighbor_vertices = vertices[list(neighbors)]
                if len(neighbor_vertices) > 0:
                    center = np.mean(neighbor_vertices, axis=0)
                    smoothed[v_idx] = 0.8 * smoothed[v_idx] + 0.2 * center

            vertices = smoothed.copy()

        mesh.vertices = smoothed
        return mesh

    def _decimate_mesh(self, mesh: Mesh, target_vertices: int) -> Mesh:
        vertices = mesh.vertices
        faces = mesh.faces

        if len(vertices) <= target_vertices:
            return mesh

        target_vertices = max(target_vertices, self._opt_config.min_vertices)

        edge_costs = {}
        edge_vertices = {}

        adjacency = defaultdict(set)
        for face in faces:
            v0, v1, v2 = face
            adjacency[v0].add(v1)
            adjacency[v0].add(v2)
            adjacency[v1].add(v0)
            adjacency[v1].add(v2)
            adjacency[v2].add(v0)
            adjacency[v2].add(v1)

        for v_idx in range(len(vertices)):
            for neighbor in adjacency[v_idx]:
                if v_idx < neighbor:
                    edge = (v_idx, neighbor)
                    v0_pos = vertices[v_idx]
                    v1_pos = vertices[neighbor]
                    edge_length = np.linalg.norm(v0_pos - v1_pos)

                    curvature = self._estimate_curvature(vertices, faces, v_idx)
                    cost = edge_length * (1.0 + curvature * 10.0)

                    edge_costs[edge] = cost
                    edge_vertices[edge] = (v0_pos + v1_pos) / 2.0

        vertex_map = {i: i for i in range(len(vertices))}
        removed = set()
        target_remove = len(vertices) - target_vertices
        removed_count = 0

        sorted_edges = sorted(edge_costs.keys(), key=lambda e: edge_costs[e])

        for edge in sorted_edges:
            if removed_count >= target_remove:
                break

            v0, v1 = edge
            if v0 in removed or v1 in removed:
                continue

            new_pos = edge_vertices[edge]

            v0_original = vertex_map.get(v0, v0)
            v1_original = vertex_map.get(v1, v1)
            if v0_original == v1_original:
                continue

            new_idx = len(vertices)
            vertices = np.vstack([vertices, new_pos])

            for i in range(len(vertices)):
                if vertex_map.get(i, i) == v0_original or vertex_map.get(i, i) == v1_original:
                    vertex_map[i] = new_idx

            removed.add(v0)
            removed.add(v1)
            removed_count += 1

        new_faces = []
        for face in faces:
            mapped_face = [vertex_map.get(v, v) for v in face]
            mapped_face = [v if v < len(vertices) else v for v in mapped_face]

            if len(set(mapped_face)) == 3:
                new_faces.append(mapped_face)

        if not new_faces:
            return mesh

        new_faces = np.array(new_faces, dtype=np.int32)
        used_vertices = np.unique(new_faces)

        vertex_renumber = {old: new for new, old in enumerate(used_vertices)}
        new_vertices = vertices[used_vertices]

        renumbered_faces = np.vectorize(vertex_renumber.get)(new_faces).astype(np.int32)

        mesh.vertices = new_vertices
        mesh.faces = renumbered_faces

        if mesh.texcoords is not None and len(mesh.texcoords) == len(vertex_map):
            new_texcoords = mesh.texcoords[used_vertices]
            mesh.texcoords = new_texcoords

        if mesh.colors is not None and len(mesh.colors) == len(vertex_map):
            new_colors = mesh.colors[used_vertices]
            mesh.colors = new_colors

        if mesh.normals is not None and len(mesh.normals) == len(vertex_map):
            new_normals = mesh.normals[used_vertices]
            mesh.normals = new_normals

        return mesh

    def _estimate_curvature(self, vertices: np.ndarray, faces: np.ndarray, v_idx: int) -> float:
        adjacency = defaultdict(set)
        for face in faces:
            f0, f1, f2 = face
            if f0 == v_idx or f1 == v_idx or f2 == v_idx:
                adjacency[f0].add(f1)
                adjacency[f0].add(f2)
                adjacency[f1].add(f0)
                adjacency[f1].add(f2)
                adjacency[f2].add(f0)
                adjacency[f2].add(f1)

        neighbors = adjacency.get(v_idx, set())
        if len(neighbors) < 3:
            return 0.0

        v_pos = vertices[v_idx]
        n_pos = vertices[list(neighbors)]
        center = np.mean(n_pos, axis=0)

        curvature = np.abs(np.linalg.norm(v_pos - center))
        return curvature

    def _ensure_manifold(self, mesh: Mesh) -> Mesh:
        vertices = mesh.vertices
        faces = mesh.faces

        if len(vertices) == 0 or len(faces) == 0:
            return mesh

        edge_map = defaultdict(list)

        for face_idx, face in enumerate(faces):
            v0, v1, v2 = face
            edges = [(v0, v1), (v1, v2), (v2, v0)]
            for edge in edges:
                sorted_edge = tuple(sorted(edge))
                edge_map[sorted_edge].append(face_idx)

        valid_faces = []
        for face_idx, face in enumerate(faces):
            v0, v1, v2 = face
            edges = [(v0, v1), (v1, v2), (v2, v0)]
            is_valid = True

            for edge in edges:
                sorted_edge = tuple(sorted(edge))
                if len(edge_map[sorted_edge]) > 2:
                    is_valid = False
                    break

            if is_valid and len(set(face)) == 3:
                valid_faces.append(face)

        if not valid_faces:
            return mesh

        mesh.faces = np.array(valid_faces, dtype=np.int32)

        used_vertices = np.unique(mesh.faces)
        if len(used_vertices) < len(vertices):
            vertex_renumber = {old: new for new, old in enumerate(used_vertices)}
            mesh.vertices = vertices[used_vertices]
            mesh.faces = np.vectorize(vertex_renumber.get)(mesh.faces).astype(np.int32)

            if mesh.texcoords is not None and len(mesh.texcoords) == len(vertices):
                mesh.texcoords = mesh.texcoords[used_vertices]

            if mesh.colors is not None and len(mesh.colors) == len(vertices):
                mesh.colors = mesh.colors[used_vertices]

            if mesh.normals is not None and len(mesh.normals) == len(vertices):
                mesh.normals = mesh.normals[used_vertices]

        return mesh

    def _recompute_normals(self, mesh: Mesh) -> Mesh:
        if mesh.is_empty():
            return mesh

        vertices = mesh.vertices
        faces = mesh.faces

        normals = np.zeros_like(vertices, dtype=np.float32)

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

        mesh.normals = normals.astype(np.float32)
        return mesh

    def get_statistics(self) -> Dict:
        stats = {
            "avg_total_time_ms": self._timer.average("optimization_total") * 1000,
            "avg_manifold_check_ms": self._timer.average("check_manifold") * 1000,
            "avg_hole_filling_ms": self._timer.average("hole_filling") * 1000,
            "avg_smoothing_ms": self._timer.average("smoothing") * 1000,
            "avg_decimation_ms": self._timer.average("decimation") * 1000,
            "avg_make_manifold_ms": self._timer.average("make_manifold") * 1000,
            "optimization_fps": self._timer.fps("optimization_total")
        }
        return stats

    @property
    def config(self) -> MeshOptConfig:
        return self._opt_config
