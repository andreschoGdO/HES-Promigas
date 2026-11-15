"""Formato JSON legible: indentado, con los puntos [x, y] en una sola línea."""

from __future__ import annotations

import json
import re
from typing import Any

_PUNTO = re.compile(r"\[\s+(-?[\d.eE+-]+),\s+(-?[\d.eE+-]+)\s+\]")


def dumps(datos: Any) -> str:
    return _PUNTO.sub(r"[\1, \2]", json.dumps(datos, ensure_ascii=False, indent=2)) + "\n"
