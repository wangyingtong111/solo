import time
from typing import Dict, Optional


class Timer:
    def __init__(self, name: str = ""):
        self.name = name
        self._start_time: Optional[float] = None
        self._elapsed: float = 0.0
        self._running: bool = False
        self._count: int = 0

    def start(self) -> None:
        self._start_time = time.perf_counter()
        self._running = True

    def stop(self) -> float:
        if self._running and self._start_time is not None:
            elapsed = time.perf_counter() - self._start_time
            self._elapsed += elapsed
            self._running = False
            self._count += 1
            return elapsed
        return 0.0

    def reset(self) -> None:
        self._elapsed = 0.0
        self._count = 0
        self._running = False
        self._start_time = None

    def elapsed(self) -> float:
        if self._running and self._start_time is not None:
            return self._elapsed + (time.perf_counter() - self._start_time)
        return self._elapsed

    def average(self) -> float:
        if self._count == 0:
            return 0.0
        return self._elapsed / self._count

    def fps(self) -> float:
        avg = self.average()
        return 1.0 / avg if avg > 0 else 0.0

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()

    def __str__(self) -> str:
        return f"Timer({self.name}): elapsed={self.elapsed():.4f}s, avg={self.average():.4f}s, fps={self.fps():.2f}"


class MultiTimer:
    def __init__(self):
        self._timers: Dict[str, Timer] = {}

    def get(self, name: str) -> Timer:
        if name not in self._timers:
            self._timers[name] = Timer(name)
        return self._timers[name]

    def start(self, name: str) -> None:
        self.get(name).start()

    def stop(self, name: str) -> float:
        return self.get(name).stop()

    def elapsed(self, name: str) -> float:
        return self.get(name).elapsed()

    def average(self, name: str) -> float:
        return self.get(name).average()

    def fps(self, name: str) -> float:
        return self.get(name).fps()

    def reset(self, name: Optional[str] = None) -> None:
        if name:
            self.get(name).reset()
        else:
            for timer in self._timers.values():
                timer.reset()

    def get_all_stats(self) -> Dict[str, Dict]:
        stats = {}
        for name, timer in self._timers.items():
            stats[name] = {
                "elapsed": timer.elapsed(),
                "average": timer.average(),
                "fps": timer.fps(),
                "count": timer._count
            }
        return stats

    def print_stats(self) -> None:
        for name, timer in self._timers.items():
            print(str(timer))
