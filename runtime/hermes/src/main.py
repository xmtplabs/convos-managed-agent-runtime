"""Entrypoint — starts the Hermes runtime HTTP server."""

from __future__ import annotations

import logging
import os
import sys

import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def main() -> None:
    port = int(os.environ.get("PORT") or "8080")
    host = os.environ.get("HOST", "0.0.0.0")

    logger.info(f"Starting Hermes runtime on {host}:{port}")

    uvicorn.run(
        "src.server:app",
        host=host,
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
