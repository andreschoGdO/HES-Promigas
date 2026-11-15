"""Planos con cajetín y PDF (Paso 7).

Uso::

    python -m engine.planos generar <id>

Genera, desde proyecto.json, el cálculo eléctrico y los renders del proyecto:

- ARQ-01  Planta de cubierta con la distribución de módulos y equipos
- ARQ-02  Alzado del muro de equipos (si está definido)
- ELE-01  Diagrama unifilar
- REN-01  Renders (si existen en salidas/)

Salida: ``planos.pdf`` (todas las láminas) y un DXF por lámina. Si el proyecto tiene datos
personales en privado/datos_privados.json, los planos van a ``privado/planos/`` (fuera de git);
si no, a ``salidas/planos/``.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from engine import validar
from engine.modelo3d import geometria
from engine.planos import alzado, cajetin, planta, unifilar
from engine.planos.lamina import Lamina, a_dxf, a_pdf

PLANTILLA = validar.RAIZ / "templates" / "cajetin.json"


def _rel(ruta: Path) -> Path:
    return ruta.relative_to(validar.RAIZ) if ruta.is_relative_to(validar.RAIZ) else ruta


def datos_cajetin(proyecto, privados, lamina: Lamina, total: int, fecha: str) -> dict[str, str]:
    cliente = (privados or {}).get("cliente", {})
    ing = (privados or {}).get("ingeniero_responsable", {})
    ingeniero = ing.get("nombre", "")
    if ing.get("matricula_profesional"):
        ingeniero += f" · M.P. {ing['matricula_profesional']}"
    return {
        "PROYECTO": proyecto["nombre"],
        "UBICACIÓN": "{municipio}, {departamento}".format(**proyecto["ubicacion"]),
        "CONTIENE": lamina.titulo,
        "DISEÑÓ": "sunny-cad (borrador automático)",
        "CLIENTE": cliente.get("nombre", ""),
        "REVISÓ": "",
        "INGENIERO RESPONSABLE": ingeniero,
        "APROBÓ": "",
        "NOMBRE DEL ARCHIVO": f"{proyecto['id']}_{lamina.codigo}",
        "SOFTWARE / FECHA": f"sunny-cad · {fecha}",
        "FORMATO / ESCALA": f"{lamina.formato} · {lamina.escala}",
        "PLANO": f"{lamina.codigo} {lamina.numero}/{total}",
    }


def laminas(proyecto, biblioteca, entrada, calc, renders: list[Path]) -> list[Lamina]:
    plantilla = validar.cargar_json(PLANTILLA)
    elems = geometria.elementos(proyecto, biblioteca, entrada)
    out = []
    lam = Lamina(1, "ARQ-01", "Planta de cubierta: distribución de módulos y equipos")
    planta.dibujar(lam, cajetin.area_dibujo(lam, plantilla), proyecto, elems, biblioteca)
    out.append(lam)
    if entrada and "muro_equipos" in entrada:
        lam = Lamina(len(out) + 1, "ARQ-02", "Alzado del muro de equipos")
        alzado.dibujar(
            lam, cajetin.area_dibujo(lam, plantilla), proyecto, elems, entrada, biblioteca
        )
        out.append(lam)
    if calc:
        lam = Lamina(len(out) + 1, "ELE-01", "Diagrama unifilar", escala="SIN ESCALA")
        unifilar.dibujar(lam, cajetin.area_dibujo(lam, plantilla), proyecto, calc, biblioteca)
        out.append(lam)
    if renders:
        lam = Lamina(len(out) + 1, "REN-01", "Vistas 3D (renders de borrador)", escala="SIN ESCALA")
        x, y, w, h = cajetin.area_dibujo(lam, plantilla)
        n = len(renders)
        cols = 2 if n > 1 else 1
        filas = (n + cols - 1) // cols
        cw, ch = (w - 4 * (cols - 1)) / cols, (h - 4 * (filas - 1)) / filas
        for i, r in enumerate(renders):
            c, f = i % cols, i // cols
            # Mantener la proporción 16:10 de los renders dentro de la celda
            iw = min(cw, ch * 1.6)
            ih = iw / 1.6
            lam.imagen(
                r,
                x + c * (cw + 4) + (cw - iw) / 2,
                y + h - (f + 1) * ch - f * 4 + (ch - ih) / 2,
                iw,
                ih,
            )
        out.append(lam)
    return out


def generar(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    proyecto = validar.cargar_json(carpeta / "proyecto.json")
    errores = validar.validar_proyecto(proyecto, carpeta / "proyecto.json")
    if errores:
        print("ERROR: el proyecto no es válido:")
        for e in errores:
            print(f"  - {e}")
        return 1
    biblioteca = validar.cargar_biblioteca()
    ruta_e = carpeta / "insumos" / "electrico.json"
    entrada = validar.cargar_json(ruta_e) if ruta_e.exists() else None
    ruta_c = carpeta / "salidas" / "calculo_electrico.json"
    calc = validar.cargar_json(ruta_c) if ruta_c.exists() else None
    ruta_p = carpeta / "privado" / "datos_privados.json"
    privados = validar.cargar_json(ruta_p) if ruta_p.exists() else None
    orden = [
        "render_terraza.png",
        "render_aerea_oeste.png",
        "render_equipos.png",
        "render_aerea_sur.png",
    ]
    renders = [carpeta / "salidas" / n for n in orden if (carpeta / "salidas" / n).exists()]

    lams = laminas(proyecto, biblioteca, entrada, calc, renders)
    plantilla = validar.cargar_json(PLANTILLA)
    fecha = args.fecha or date.today().isoformat()
    for lam in lams:
        cajetin.dibujar(
            lam, plantilla, datos_cajetin(proyecto, privados, lam, len(lams), fecha), validar.RAIZ
        )

    tiene_personales = bool(
        privados and (privados.get("cliente") or privados.get("ingeniero_responsable"))
    )
    destino = carpeta / ("privado" if tiene_personales else "salidas") / "planos"
    rutas = [a_pdf(lams, destino / f"{proyecto['id']}_planos.pdf")]
    rutas += [a_dxf(lam, destino / f"{proyecto['id']}_{lam.codigo}.dxf") for lam in lams]
    for r in rutas:
        print(f"  {_rel(r)}")
    if tiene_personales:
        print("Los planos tienen datos personales: quedaron en privado/ (fuera de git).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.planos")
    sub = parser.add_subparsers(dest="orden", required=True)
    p = sub.add_parser("generar")
    p.add_argument("id")
    p.add_argument("--fecha", help="fecha del cajetín (AAAA-MM-DD); por defecto, hoy")
    p.set_defaults(funcion=generar)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
