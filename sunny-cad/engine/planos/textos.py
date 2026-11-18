"""Textos cortos para cuadros y rótulos de los planos."""

from __future__ import annotations

from typing import Any


def fabricante_corto(componente: dict[str, Any]) -> str:
    nombre = componente["fabricante"].split(" (")[0]
    return componente["marca"].upper() if len(nombre) > 14 else nombre


def nombre_equipo(componente: dict[str, Any]) -> str:
    return f"{fabricante_corto(componente)} {componente['modelo']}"
