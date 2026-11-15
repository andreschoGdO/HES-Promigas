"""Registro de fotos de la vivienda como insumos.

Las fotos se guardan en ``projects/<vivienda>/privado/fotos/`` (fuera de git). Al proyecto solo
pasa la ruta y una descripción; nunca las coordenadas GPS que traen muchas fotos.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import ExifTags, Image

EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def leer_metadatos(ruta: Path) -> dict[str, Any]:
    with Image.open(ruta) as im:
        ancho, alto = im.size
        exif = im.getexif()
        detalle = exif.get_ifd(ExifTags.IFD.Exif)
        fecha = detalle.get(ExifTags.Base.DateTimeOriginal) or exif.get(ExifTags.Base.DateTime)
        return {
            "ancho_px": ancho,
            "alto_px": alto,
            "fecha": fecha.replace(":", "-", 2)[:16] if fecha else None,
            "camara": " ".join(
                str(v).strip()
                for v in (exif.get(ExifTags.Base.Make), exif.get(ExifTags.Base.Model))
                if v
            )
            or None,
            "tiene_gps": bool(exif.get_ifd(ExifTags.IFD.GPSInfo)),
        }


def insumos_de_fotos(dir_proyecto: Path) -> list[dict[str, str]]:
    """Entradas de 'insumos' para cada foto de privado/fotos/, ordenadas por nombre."""
    carpeta = dir_proyecto / "privado" / "fotos"
    if not carpeta.is_dir():
        return []
    insumos = []
    for ruta in sorted(p for p in carpeta.rglob("*") if p.suffix.lower() in EXTENSIONES):
        try:
            m = leer_metadatos(ruta)
        except OSError:
            descripcion = "Foto (no se pudieron leer los metadatos)"
        else:
            partes = ["Foto"]
            if m["fecha"]:
                partes.append(m["fecha"])
            if m["camara"]:
                partes.append(m["camara"])
            partes.append(f"{m['ancho_px']}×{m['alto_px']} px")
            if m["tiene_gps"]:
                partes.append("trae GPS (no se copia al proyecto)")
            descripcion = " · ".join(partes)
        insumos.append(
            {"archivo": ruta.relative_to(dir_proyecto).as_posix(), "descripcion": descripcion}
        )
    return insumos
