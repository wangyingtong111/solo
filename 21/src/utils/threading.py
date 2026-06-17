import queue
import threading
import time
from typing import Any, Optional, Callable, List
from collections import deque


class ThreadSafeQueue:
    def __init__(self, maxsize: int = 10):
        self._queue: queue.Queue = queue.Queue(maxsize=maxsize)
        self._lock = threading.Lock()
        self._maxsize = maxsize

    def put(self, item: Any, timeout: Optional[float] = None) -> bool:
        try:
            self._queue.put(item, timeout=timeout)
            return True
        except queue.Full:
            return False

    def get(self, timeout: Optional[float] = None) -> Optional[Any]:
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def get_nowait(self) -> Optional[Any]:
        try:
            return self._queue.get_nowait()
        except queue.Empty:
            return None

    def put_nowait(self, item: Any) -> bool:
        try:
            self._queue.put_nowait(item)
            return True
        except queue.Full:
            return False

    def qsize(self) -> int:
        return self._queue.qsize()

    def empty(self) -> bool:
        return self._queue.empty()

    def full(self) -> bool:
        return self._queue.full()

    def clear(self) -> None:
        with self._lock:
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except queue.Empty:
                    break

    def join(self) -> None:
        self._queue.join()

    def task_done(self) -> None:
        self._queue.task_done()


class WorkerThread(threading.Thread):
    def __init__(self, name: str, task_fn: Callable,
                 input_queue: Optional[ThreadSafeQueue] = None,
                 output_queue: Optional[ThreadSafeQueue] = None,
                 callback: Optional[Callable] = None,
                 daemon: bool = True):
        super().__init__(name=name, daemon=daemon)
        self._task_fn = task_fn
        self._input_queue = input_queue
        self._output_queue = output_queue
        self._callback = callback
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._pause_event.set()
        self._running = False

    def run(self) -> None:
        self._running = True
        while not self._stop_event.is_set():
            self._pause_event.wait()

            if self._input_queue is None:
                try:
                    result = self._task_fn()
                    if result is not None and self._output_queue is not None:
                        self._output_queue.put(result)
                    if self._callback:
                        self._callback(result)
                except Exception as e:
                    print(f"Worker {self.name} error: {e}")
                continue

            input_data = self._input_queue.get(timeout=0.1)
            if input_data is None:
                continue

            try:
                result = self._task_fn(input_data)
                if result is not None and self._output_queue is not None:
                    self._output_queue.put(result)
                if self._callback:
                    self._callback(result)
            except Exception as e:
                print(f"Worker {self.name} error processing input: {e}")
            finally:
                self._input_queue.task_done()

        self._running = False

    def stop(self, wait: bool = True, timeout: Optional[float] = None) -> None:
        self._stop_event.set()
        self._pause_event.set()
        if wait and self.is_alive():
            self.join(timeout=timeout)

    def pause(self) -> None:
        self._pause_event.clear()

    def resume(self) -> None:
        self._pause_event.set()

    @property
    def is_running(self) -> bool:
        return self._running and not self._stop_event.is_set()

    @property
    def is_paused(self) -> bool:
        return not self._pause_event.is_set()


class ThreadPool:
    def __init__(self, num_workers: int, task_fn: Callable,
                 name_prefix: str = "Worker",
                 input_queue: Optional[ThreadSafeQueue] = None,
                 output_queue: Optional[ThreadSafeQueue] = None):
        self._num_workers = num_workers
        self._workers: List[WorkerThread] = []
        self._input_queue = input_queue or ThreadSafeQueue()
        self._output_queue = output_queue or ThreadSafeQueue()

        for i in range(num_workers):
            worker = WorkerThread(
                name=f"{name_prefix}-{i}",
                task_fn=task_fn,
                input_queue=self._input_queue,
                output_queue=self._output_queue
            )
            self._workers.append(worker)

    def start(self) -> None:
        for worker in self._workers:
            worker.start()

    def stop(self, wait: bool = True, timeout: Optional[float] = None) -> None:
        for worker in self._workers:
            worker.stop(wait=False)
        if wait:
            for worker in self._workers:
                worker.join(timeout=timeout)

    def submit(self, item: Any) -> bool:
        return self._input_queue.put(item)

    def get_result(self, timeout: Optional[float] = None) -> Optional[Any]:
        return self._output_queue.get(timeout=timeout)

    @property
    def input_queue(self) -> ThreadSafeQueue:
        return self._input_queue

    @property
    def output_queue(self) -> ThreadSafeQueue:
        return self._output_queue

    @property
    def workers(self) -> List[WorkerThread]:
        return self._workers


class SyncBarrier:
    def __init__(self, num_threads: int, timeout: Optional[float] = None):
        self._num_threads = num_threads
        self._timeout = timeout
        self._count = 0
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)

    def wait(self) -> bool:
        with self._condition:
            self._count += 1
            if self._count >= self._num_threads:
                self._count = 0
                self._condition.notify_all()
                return True
            return self._condition.wait(timeout=self._timeout)

    def reset(self) -> None:
        with self._condition:
            self._count = 0
            self._condition.notify_all()
