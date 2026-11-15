"""Datos pendientes de un proyecto: campos en null que deben pedirse al usuario.

Regla 1 de CLAUDE.md: antes de diseñar se lista la información faltante. Un campo en null
es un dato que todavía no se conoce; nunca se reemplaza por un valor supuesto.
"""

from __future__ import annotations

from typing import Any

ETIQUETAS = {
    "tipologia": "tipología del sistema (T1 bifásica o T2 trifásica)",
    "fases_red": "fases de la red (monofásica, bifásica o trifásica)",
    "arquitectura": "arquitectura del inversor (serie o paralelo)",
    "respaldo": "alcance del respaldo (cargas críticas o respaldo total)",
    "conmutacion": "equipo de conmutación (bypass, ATS o SmartGuard)",
    "tipo": "tipo de cubierta (plana o inclinada)",
    "material": "material de la cubierta",
    "cota_base_mm": "altura del borde más bajo de la cubierta sobre el piso (mm)",
    "inclinacion_deg": "inclinación de la cubierta (grados)",
    "azimut_deg": "hacia dónde cae el agua (azimut en grados, 180 = sur)",
    "altura_mm": "altura del obstáculo sobre la cubierta (mm)",
    "altura_estructura_mm": "altura del borde bajo de los módulos sobre la cubierta (mm)",
    "temperatura_min_c": "temperatura mínima de diseño del sitio (°C)",
    "temperatura_max_ambiente_c": "temperatura ambiente máxima de diseño del sitio (°C)",
    "cubiertas": "trazado de las cubiertas (enviar vista de Maps con escala y fotos)",
}


def rutas_pendientes(proyecto: dict[str, Any]) -> list[str]:
    """Rutas legibles de los campos en null, por ejemplo 'cubierta-01/inclinacion_deg'."""
    rutas: list[str] = []
    for campo, valor in proyecto.get("sistema", {}).items():
        if valor is None:
            rutas.append(f"sistema/{campo}")
    cubiertas = proyecto.get("vivienda", {}).get("cubiertas", [])
    if not cubiertas:
        rutas.append("vivienda/cubiertas")
    for cubierta in cubiertas:
        for campo, valor in cubierta.items():
            if campo == "azimut_deg" and cubierta.get("inclinacion_deg") == 0:
                continue  # en una cubierta horizontal el azimut no aplica
            if valor is None:
                rutas.append(f"{cubierta['id']}/{campo}")
        for obstaculo in cubierta.get("obstaculos", []):
            for campo, valor in obstaculo.items():
                if valor is None:
                    rutas.append(f"{cubierta['id']}/{obstaculo['id']}/{campo}")
    for campo, valor in proyecto.get("condiciones_diseno", {}).items():
        if valor is None:
            rutas.append(f"condiciones_diseno/{campo}")
    for zona in proyecto.get("vivienda", {}).get("zonas_instalacion", []):
        for campo, valor in zona.items():
            if valor is None:
                rutas.append(f"{zona['id']}/{campo}")
    return rutas


def texto_faltante(ruta: str) -> str:
    campo = ruta.rsplit("/", 1)[-1]
    return f"{ruta}: {ETIQUETAS.get(campo, campo)}"


def errores_pendientes(proyecto: dict[str, Any]) -> list[str]:
    """Cada null debe figurar en informacion_faltante; fuera de 'borrador' no se admiten nulls."""
    errores: list[str] = []
    rutas = rutas_pendientes(proyecto)
    faltantes = proyecto.get("informacion_faltante", [])
    for ruta in rutas:
        if not any(f.startswith(f"{ruta}:") for f in faltantes):
            errores.append(f"{ruta}: está en null y no figura en informacion_faltante")
    if rutas and proyecto.get("estado") != "borrador":
        errores.append(
            f"estado: '{proyecto.get('estado')}' exige que no haya datos pendientes "
            f"({len(rutas)} en null)"
        )
    return errores


def errores_privacidad(proyecto: dict[str, Any]) -> list[str]:
    """Las coordenadas del proyecto (que se sube a git) van redondeadas a 2 decimales."""
    errores: list[str] = []
    for campo in ("latitud_deg", "longitud_deg"):
        valor = proyecto.get("ubicacion", {}).get(campo)
        if valor is not None and round(valor, 2) != valor:
            errores.append(
                f"ubicacion/{campo}: {valor} tiene más de 2 decimales; la coordenada exacta va en "
                "privado/datos_privados.json"
            )
    return errores
