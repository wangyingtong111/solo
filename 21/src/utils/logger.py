import os
import logging
from logging.handlers import RotatingFileHandler
from typing import Dict, Any


class Logger:
    _instances: Dict[str, 'Logger'] = {}

    def __init__(self, name: str = "reconstruction", log_file: str = "logs/reconstruction.log",
                 level: str = "INFO"):
        self.name = name
        self.log_file = log_file
        self.level = getattr(logging, level.upper(), logging.INFO)
        self._logger: logging.Logger = None
        self._setup_logger()

    def _setup_logger(self) -> None:
        os.makedirs(os.path.dirname(self.log_file), exist_ok=True)

        self._logger = logging.getLogger(self.name)
        self._logger.setLevel(self.level)
        self._logger.propagate = False

        if self._logger.handlers:
            return

        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

        file_handler = RotatingFileHandler(
            self.log_file,
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding='utf-8'
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(self.level)

        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(self.level)

        self._logger.addHandler(file_handler)
        self._logger.addHandler(console_handler)

    def debug(self, message: str, **kwargs: Any) -> None:
        if self._logger:
            self._logger.debug(self._format_message(message, **kwargs))

    def info(self, message: str, **kwargs: Any) -> None:
        if self._logger:
            self._logger.info(self._format_message(message, **kwargs))

    def warning(self, message: str, **kwargs: Any) -> None:
        if self._logger:
            self._logger.warning(self._format_message(message, **kwargs))

    def error(self, message: str, exc_info: bool = False, **kwargs: Any) -> None:
        if self._logger:
            self._logger.error(self._format_message(message, **kwargs), exc_info=exc_info)

    def critical(self, message: str, exc_info: bool = False, **kwargs: Any) -> None:
        if self._logger:
            self._logger.critical(self._format_message(message, **kwargs), exc_info=exc_info)

    @staticmethod
    def _format_message(message: str, **kwargs: Any) -> str:
        if kwargs:
            extra = " | ".join(f"{k}={v}" for k, v in kwargs.items())
            return f"{message} | {extra}"
        return message

    @classmethod
    def get(cls, name: str = "reconstruction", **kwargs: Any) -> 'Logger':
        if name not in cls._instances:
            cls._instances[name] = cls(name, **kwargs)
        return cls._instances[name]

    @property
    def logger(self) -> logging.Logger:
        return self._logger


def get_logger(name: str = "reconstruction", **kwargs: Any) -> Logger:
    return Logger.get(name, **kwargs)
