#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Real-Time 3D Reconstruction System
Main entry point with visualization interface
"""

import os
import sys
import time
import argparse
import numpy as np
from datetime import datetime

from src.utils import (
    Config,
    get_logger,
    Metrics
)
from src.pipeline import ReconstructionPipeline

logger = get_logger("main")


class ReconstructionApp:
    def __init__(self, config_path: str, headless: bool = False):
        self._config = Config(config_path)
        self._pipeline = ReconstructionPipeline(self._config)
        self._headless = headless
        self._running = False
        self._export_dir = self._config.get("export.export_dir", "exports")
        os.makedirs(self._export_dir, exist_ok=True)

        if not headless:
            try:
                import cv2
                self._cv2 = cv2
                self._window_name = "3D Reconstruction System"
                self._control_window = "Controls"
            except ImportError:
                logger.warning("OpenCV not available for visualization, falling back to headless mode")
                self._headless = True
                self._cv2 = None
        else:
            self._cv2 = None

    def start(self) -> bool:
        logger.info("Starting 3D Reconstruction System...")
        if not self._pipeline.start():
            logger.error("Failed to start reconstruction pipeline")
            return False

        self._running = True

        if not self._headless and self._cv2 is not None:
            self._setup_windows()

        logger.info("System started. Press 'ESC' to quit, 's' to save mesh, 'r' to reset.")
        return True

    def _setup_windows(self) -> None:
        self._cv2.namedWindow(self._window_name, self._cv2.WINDOW_NORMAL)
        self._cv2.resizeWindow(self._window_name, 1280, 720)

        control_img = np.zeros((400, 300, 3), dtype=np.uint8)
        self._cv2.namedWindow(self._control_window, self._cv2.WINDOW_NORMAL)
        self._cv2.imshow(self._control_window, control_img)

    def run(self) -> None:
        if not self._running:
            if not self.start():
                return

        try:
            while self._running:
                if self._headless:
                    self._run_headless()
                else:
                    self._run_with_visualization()

        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received")
        finally:
            self.stop()

    def _run_headless(self) -> None:
        metrics = self._pipeline.get_metrics()
        self._print_metrics(metrics)
        time.sleep(1.0)

    def _run_with_visualization(self) -> None:
        display_img = self._create_display()
        self._cv2.imshow(self._window_name, display_img)

        control_img = self._create_controls()
        self._cv2.imshow(self._control_window, control_img)

        key = self._cv2.waitKey(1) & 0xFF
        if key == 27:
            logger.info("ESC pressed, quitting...")
            self._running = False
        elif key == ord('s'):
            self._export_current_mesh()
        elif key == ord('r'):
            logger.info("Reset requested (not implemented in this version)")

    def _create_display(self) -> np.ndarray:
        display = np.zeros((720, 1280, 3), dtype=np.uint8)

        frames = self._pipeline.get_latest_frames()
        if frames is not None and len(frames.frames) > 0:
            for i, frame in enumerate(frames.frames[:3]):
                if frame.image is not None:
                    img = frame.image.copy()
                    if len(img.shape) == 2:
                        img = self._cv2.cvtColor(img, self._cv2.COLOR_GRAY2BGR)

                    h, w = img.shape[:2]
                    target_h = 240
                    target_w = int(w * target_h / h)
                    img = self._cv2.resize(img, (target_w, target_h))

                    if frame.mask is not None:
                        mask_vis = self._cv2.applyColorMap(
                            (frame.mask * 255).astype(np.uint8),
                            self._cv2.COLORMAP_JET
                        )
                        mask_vis = self._cv2.resize(mask_vis, (target_w, target_h))
                        img = self._cv2.addWeighted(img, 0.7, mask_vis, 0.3, 0)

                    y_offset = i * target_h
                    x_offset = 0
                    display[y_offset:y_offset+target_h, x_offset:x_offset+target_w] = img

                    if frame.depth is not None:
                        depth_vis = self._normalize_depth(frame.depth)
                        depth_vis = self._cv2.resize(depth_vis, (target_w, target_h))
                        x_offset = target_w
                        display[y_offset:y_offset+target_h, x_offset:x_offset+target_w] = depth_vis

        mesh = self._pipeline.get_latest_mesh()
        if mesh is not None and mesh.texture is not None:
            tex = mesh.texture.copy()
            h, w = tex.shape[:2]
            target_h = 240
            target_w = int(w * target_h / h)
            tex = self._cv2.resize(tex, (target_w, target_h))
            if len(tex.shape) == 2:
                tex = self._cv2.cvtColor(tex, self._cv2.COLOR_GRAY2BGR)
            display[0:target_h, 1280-target_w:1280] = tex

        self._draw_metrics_overlay(display)

        return display

    def _normalize_depth(self, depth: np.ndarray) -> np.ndarray:
        valid = depth > 0
        if not np.any(valid):
            return np.zeros_like(depth, dtype=np.uint8)

        d_min = depth[valid].min()
        d_max = depth[valid].max()

        if d_max == d_min:
            return np.zeros_like(depth, dtype=np.uint8)

        normalized = np.zeros_like(depth, dtype=np.float32)
        normalized[valid] = (depth[valid] - d_min) / (d_max - d_min)
        normalized = (normalized * 255).astype(np.uint8)
        return self._cv2.applyColorMap(normalized, self._cv2.COLORMAP_VIRIDIS)

    def _draw_metrics_overlay(self, img: np.ndarray) -> None:
        metrics = self._pipeline.get_metrics()

        y = 30
        x = 650
        font = self._cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.5
        thickness = 1

        info_texts = [
            f"FPS: {metrics.fps:.1f} (target: 15)",
            f"Latency: {metrics.total_latency_ms:.1f}ms (max: 1000)",
            f"Vertices: {metrics.mesh_vertices} (max: 50000)",
            f"Faces: {metrics.mesh_faces}",
            f"BG Error: {metrics.bg_misclassification_rate*100:.1f}% (max: 5%)",
        ]

        self._cv2.rectangle(img, (x-10, y-25), (x+400, y+len(info_texts)*25), (0, 0, 0), -1)

        for i, text in enumerate(info_texts):
            color = (0, 255, 0)
            if "Latency" in text and metrics.total_latency_ms > 1000:
                color = (0, 0, 255)
            elif "BG Error" in text and metrics.bg_misclassification_rate > 0.05:
                color = (0, 0, 255)
            elif "Vertices" in text and metrics.mesh_vertices > 50000:
                color = (0, 0, 255)

            self._cv2.putText(img, text, (x, y + i*25), font, scale, color, thickness)

        timing_texts = [
            f"Depth: {metrics.depth_estimation_ms:.1f}ms",
            f"BG Remove: {metrics.bg_removal_ms:.1f}ms",
            f"Recon: {metrics.reconstruction_ms:.1f}ms",
            f"Optimize: {metrics.mesh_optimization_ms:.1f}ms",
            f"Texture: {metrics.texture_mapping_ms:.1f}ms",
        ]

        y2 = 30
        for i, text in enumerate(timing_texts):
            self._cv2.putText(img, text, (x, 200 + y2 + i*25), font, scale, (255, 255, 255), thickness)

        help_texts = [
            "Controls:",
            "  ESC - Quit",
            "  S - Export GLB",
            "  R - Reset",
        ]

        for i, text in enumerate(help_texts):
            self._cv2.putText(img, text, (x, 400 + y2 + i*25), font, scale, (200, 200, 200), thickness)

    def _create_controls(self) -> np.ndarray:
        control = np.ones((400, 300, 3), dtype=np.uint8) * 30

        metrics = self._pipeline.get_metrics()

        def draw_bar(y, value, max_val, label, color):
            bar_width = 240
            bar_height = 20
            x = 30

            ratio = min(value / max_val, 1.0)
            fill_width = int(bar_width * ratio)

            self._cv2.rectangle(control, (x, y), (x + bar_width, y + bar_height), (80, 80, 80), -1)
            self._cv2.rectangle(control, (x, y), (x + fill_width, y + bar_height), color, -1)
            self._cv2.rectangle(control, (x, y), (x + bar_width, y + bar_height), (255, 255, 255), 1)

            text = f"{label}: {value:.1f}/{max_val}"
            self._cv2.putText(control, text, (x, y - 5),
                             self._cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

        draw_bar(50, metrics.fps, 15, "FPS", (0, 255, 0))
        draw_bar(100, metrics.total_latency_ms, 1000, "Latency(ms)",
                 (0, 255, 0) if metrics.total_latency_ms < 1000 else (0, 0, 255))
        draw_bar(150, metrics.mesh_vertices, 50000, "Vertices",
                 (0, 255, 0) if metrics.mesh_vertices < 50000 else (0, 0, 255))
        draw_bar(200, metrics.bg_misclassification_rate * 100, 5, "BG Error(%)",
                 (0, 255, 0) if metrics.bg_misclassification_rate < 0.05 else (0, 0, 255))

        status = "RUNNING" if self._pipeline.is_running else "STOPPED"
        status_color = (0, 255, 0) if self._pipeline.is_running else (0, 0, 255)
        self._cv2.putText(control, f"Status: {status}", (30, 280),
                         self._cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)

        export_status = "BUSY" if self._pipeline.is_export_busy else "READY"
        export_color = (0, 255, 255) if self._pipeline.is_export_busy else (255, 255, 0)
        self._cv2.putText(control, f"Export: {export_status}", (30, 310),
                         self._cv2.FONT_HERSHEY_SIMPLEX, 0.5, export_color, 1)

        return control

    def _print_metrics(self, metrics: Metrics) -> None:
        print("\n" + "="*60)
        print(f"Real-Time 3D Reconstruction System - {datetime.now().strftime('%H:%M:%S')}")
        print("="*60)
        print(f"  FPS:              {metrics.fps:6.1f} / 15 target")
        print(f"  Latency:          {metrics.total_latency_ms:6.1f}ms / 1000ms max")
        print(f"  Vertices:         {metrics.mesh_vertices:6d} / 50000 max")
        print(f"  Faces:            {metrics.mesh_faces:6d}")
        print(f"  BG Error Rate:    {metrics.bg_misclassification_rate*100:6.2f}% / 5% max")
        print("-"*60)
        print(f"  Depth Estimation: {metrics.depth_estimation_ms:6.1f}ms")
        print(f"  BG Removal:       {metrics.bg_removal_ms:6.1f}ms")
        print(f"  Reconstruction:   {metrics.reconstruction_ms:6.1f}ms")
        print(f"  Mesh Optimization:{metrics.mesh_optimization_ms:6.1f}ms")
        print(f"  Texture Mapping:  {metrics.texture_mapping_ms:6.1f}ms")
        print("="*60)

    def _export_current_mesh(self) -> None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"reconstruction_{timestamp}.glb"
        output_path = os.path.join(self._export_dir, filename)

        logger.info(f"Exporting mesh to: {output_path}")
        success = self._pipeline.request_export(output_path)

        if success:
            logger.info("Export request submitted successfully")
        else:
            logger.error("Failed to submit export request")

    def stop(self) -> None:
        logger.info("Stopping application...")
        self._running = False

        if self._pipeline is not None:
            self._pipeline.stop()

        if not self._headless and self._cv2 is not None:
            self._cv2.destroyAllWindows()

        logger.info("Application stopped")


def main():
    parser = argparse.ArgumentParser(
        description="Real-Time 3D Reconstruction System with Multi-View Cameras"
    )
    parser.add_argument(
        "--config",
        type=str,
        default="config/config.yaml",
        help="Path to configuration file"
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run without graphical interface"
    )
    parser.add_argument(
        "--export-only",
        type=str,
        default=None,
        help="Export path for single export mode (requires pre-recorded data)"
    )
    parser.add_argument(
        "--calibrate",
        action="store_true",
        help="Run camera calibration tool"
    )

    args = parser.parse_args()

    if not os.path.exists(args.config):
        logger.error(f"Configuration file not found: {args.config}")
        return 1

    if args.calibrate:
        print("Camera calibration tool - Please use the separate calibration script")
        print("See docs/calibration.md for instructions")
        return 0

    app = ReconstructionApp(args.config, headless=args.headless)

    try:
        app.run()
    except Exception as e:
        logger.error(f"Application error: {e}", exc_info=True)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
