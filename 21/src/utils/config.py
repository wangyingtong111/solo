import os
import yaml
import json
from typing import Dict, Any, Optional


class Config:
    def __init__(self, config_path: str = "config/config.yaml"):
        self.config_path = config_path
        self._config: Dict[str, Any] = {}
        self._camera_calib: Dict[str, Any] = {}
        self.load()

    def load(self) -> None:
        if not os.path.exists(self.config_path):
            raise FileNotFoundError(f"Config file not found: {self.config_path}")

        with open(self.config_path, "r", encoding="utf-8") as f:
            self._config = yaml.safe_load(f)

        calib_path = self.get("cameras.calibration_file")
        if calib_path and os.path.exists(calib_path):
            with open(calib_path, "r", encoding="utf-8") as f:
                self._camera_calib = json.load(f)

    def get(self, key: str, default: Any = None) -> Any:
        keys = key.split(".")
        value = self._config
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        return value

    def get_camera(self, camera_id: int) -> Optional[Dict[str, Any]]:
        if "cameras" not in self._camera_calib:
            return None
        for cam in self._camera_calib["cameras"]:
            if cam["id"] == camera_id:
                return cam
        return None

    def get_all_cameras(self) -> list:
        return self._camera_calib.get("cameras", [])

    def save_calibration(self, filepath: str) -> None:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self._camera_calib, f, indent=2)

    def update_calibration(self, camera_id: int, intrinsic: Dict, extrinsic: Dict) -> None:
        if "cameras" not in self._camera_calib:
            self._camera_calib["cameras"] = []

        for cam in self._camera_calib["cameras"]:
            if cam["id"] == camera_id:
                cam["intrinsic"] = intrinsic
                cam["extrinsic"] = extrinsic
                return

        self._camera_calib["cameras"].append({
            "id": camera_id,
            "name": f"camera_{camera_id}",
            "intrinsic": intrinsic,
            "extrinsic": extrinsic,
            "resolution": self.get("cameras.resolution", [1920, 1080])
        })

    @property
    def config(self) -> Dict[str, Any]:
        return self._config

    @property
    def camera_calib(self) -> Dict[str, Any]:
        return self._camera_calib
