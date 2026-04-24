from __future__ import annotations

import base64
from typing import Any

import httpx

from app.config import Settings


def auth_header(settings: Settings) -> str:
    raw = f"{settings.email}:{settings.api_token}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def client(settings: Settings) -> httpx.Client:
    return httpx.Client(
        verify=settings.http_verify_ssl,
        headers={
            "Authorization": auth_header(settings),
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        timeout=httpx.Timeout(60.0),
        limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
    )


def raise_for_status(resp: httpx.Response, context: str) -> None:
    if resp.is_success:
        return
    detail: Any
    try:
        detail = resp.json()
    except Exception:
        detail = resp.text
    raise RuntimeError(f"{context}: HTTP {resp.status_code} - {detail}")
