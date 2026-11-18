"""Planos con cajetín Promigas y PDF (Paso 7).

Uso::

    python -m engine.planos generar <id> [--fecha AAAA-MM-DD]

Genera, desde proyecto.json, el cálculo eléctrico y los renders del proyecto:

- PRO-ARQ-<P>-DIS-001  Planta de cubierta: distribución de módulos, equipos y rutas de cableado
- PRO-ARQ-<P>-ALZ-002  Alzado del muro de equipos con rutas de cableado (si está definido)
- PRO-ELE-<P>-UNI-003  Diagrama unifilar
- PRO-ARQ-<P>-REN-004/005/006  Renders (vistas generales; planta superior, cableado y equipos;
  bajante hasta el punto de conexión si se modelan los pisos inferiores)

Salida: un PDF con todas las láminas y un DXF por lámina. Si el proyecto tiene datos personales
en privado/datos_privados.json, los planos van a ``privado/planos/`` (fuera de git).
"""

from __future__ import annotations

import argparse
import math
import sys
from datetime import date
from pathlib import Path
from typing import Any

from shapely.geometry import Polygon

from engine import validar
from engine.modelo3d import geometria
from engine.planos import alzado, cajetin, planta, unifilar
from engine.planos.lamina import Lamina, a_dxf, a_pdf

PLANTILLA = validar.RAIZ / "templates" / "cajetin.json"
TITULOS_RENDER = {
    "terraza": "Terraza bajo la pérgola",
    "isometrica": "Isométrica",
    "aerea_oeste": "Aérea desde el oeste",
    "aerea_sur": "Aérea desde el sur",
    "superior": "Vista superior (norte arriba)",
    "cableado": "Rutas de cableado",
    "equipos": "Muro de equipos",
    "bajante": "Corte: bajante de la AC por la claraboya hasta el tablero existente",
}


def _rel(ruta: Path) -> Path:
    return ruta.relative_to(validar.RAIZ) if ruta.is_relative_to(validar.RAIZ) else ruta


def codigo_proyecto(proyecto: dict[str, Any]) -> str:
    return proyecto.get("codigo_corto") or proyecto["id"].split("-")[0].upper()


def potencia_kwp(proyecto, biblioteca) -> float:
    return (
        sum(
            biblioteca[e["componente_ref"]]["electrico"]["potencia_stc_w"]
            for e in proyecto["equipos"]
            if e["tipo"] == "modulo"
        )
        / 1000
    )


def materiales(proyecto, biblioteca, calc) -> list[dict[str, Any]]:
    """Lista de materiales desde el proyecto y el cálculo eléctrico (longitudes estimadas)."""
    filas = []
    mods = [e for e in proyecto["equipos"] if e["tipo"] == "modulo"]
    if mods:
        m = biblioteca[mods[0]["componente_ref"]]
        filas.append((f"Módulo FV {m['fabricante']} {m['modelo']}", len(mods), "und", "—"))
    nombres = {
        "inversor": "Inversor híbrido",
        "bateria": "Batería",
        "medidor": "Medidor bidireccional",
    }
    for e in proyecto["equipos"]:
        if e["tipo"] == "modulo":
            continue
        c = biblioteca[e["componente_ref"]]
        modelo = c["modelo"]
        if e["tipo"] == "bateria":
            conf = next(
                x for x in c["electrico"]["configuraciones"] if x["id"] == e["configuracion"]
            )
            modelo = f"{conf.get('modelo_comercial', conf['id'])} ({conf['modulos_bateria']} mód.)"
        fabricante = c["fabricante"].split(" (")[0]
        if len(fabricante) > 14:
            fabricante = c["marca"].upper()
        filas.append(
            (
                f"{nombres.get(e['tipo'], e['tipo'])} {fabricante} {modelo}",
                e.get("sistemas_en_paralelo", 1),
                "und",
                "—",
            )
        )
    for z in proyecto["vivienda"].get("zonas_instalacion", []):
        if z["estructura"] == "pergola":
            area = Polygon(z["contorno_mm"]).area / 1e6
            filas.append((f"Pérgola carport ({area:.0f} m²) para módulos", 1, "gl", "Madera"))
    if calc:
        circ = calc["circuitos"]
        dc = [c for c in circ if c["id"].startswith("DC-S") and c["longitud_estimada_m"]]
        if dc:
            filas.append(
                (
                    f"Cable FV {dc[0]['calibre_awg']} AWG (strings)",
                    math.ceil(sum(2 * c["longitud_estimada_m"] for c in dc)),
                    "m",
                    "Cobre",
                )
            )
        bat = next((c for c in circ if c["id"] == "DC-BAT" and c["longitud_estimada_m"]), None)
        if bat:
            filas.append(
                (
                    f"Cable DC batería {bat['calibre_awg']} AWG",
                    math.ceil(2 * bat["longitud_estimada_m"]),
                    "m",
                    "Cobre",
                )
            )
        ac = [c for c in circ if c["id"].startswith("AC-") and c["longitud_estimada_m"]]
        if ac:
            filas.append(
                (
                    f"Cable THHN {ac[0]['calibre_awg']} AWG (3F+N+T)",
                    math.ceil(5 * sum(c["longitud_estimada_m"] for c in ac)),
                    "m",
                    "Cobre",
                )
            )
    return [
        {"item": str(i), "descripcion": d, "cantidad": c, "unidad": u, "material": mat}
        for i, (d, c, u, mat) in enumerate(filas, 1)
    ]


def datos_cajetin(
    proyecto,
    privados,
    lam: Lamina,
    total: int,
    fecha: str,
    plantilla,
    mats,
    kwp: float | None = None,
) -> dict[str, Any]:
    ing = (privados or {}).get("ingeniero_responsable", {})
    disenador = ing.get("nombre", "")
    if ing.get("matricula_profesional"):
        disenador += f" · M.P. {ing['matricula_profesional']}"
    revisiones = proyecto.get("revisiones") or [
        {"revision": "A", "fecha": fecha, "descripcion": "EMISIÓN PARA REVISIÓN"}
    ]
    sufijo = f" – {kwp:.2f} kWp" if kwp else ""
    return {
        "revisiones": [{"zona": "", "revisado": "", "aprobado": "", **r} for r in revisiones],
        "materiales": mats,
        "notas": lam.notas,
        "dibujado_por": plantilla["dibujado_por"],
        "disenado_por": disenador,
        "localizacion": "{municipio}, {departamento}".format(**proyecto["ubicacion"]),
        "archivo": f"{lam.codigo}.dxf",
        "tolerancia": "Cotas en m · trazado Maps ±0,10 m",
        "proyecto": f"Solar FV + BESS {proyecto['nombre']}{sufijo}",
        "contenido": lam.titulo,
        "tamano": lam.formato,
        "codigo": lam.codigo,
        "rev": revisiones[-1]["revision"],
        "escala": lam.escala,
        "unidad": lam.unidad,
        "hoja": f"{lam.numero}/{total}",
    }


def laminas(proyecto, biblioteca, entrada, calc, renders: dict[str, Path]) -> list[Lamina]:
    plantilla = validar.cargar_json(PLANTILLA)
    elems = geometria.elementos(proyecto, biblioteca, entrada)
    out: list[Lamina] = []

    def nueva(disciplina, tipo, titulo, **kw) -> Lamina:
        n = len(out) + 1
        codigo = plantilla["codificacion"].format(
            disciplina=disciplina, proyecto=codigo_proyecto(proyecto), tipo=tipo, numero=n
        )
        lam = Lamina(n, codigo, titulo, disciplina=disciplina, tipo=tipo, **kw)
        out.append(lam)
        return lam

    lam = nueva("ARQ", "DIS", "Distribución de módulos, equipos y rutas de cableado")
    lam.notas = [
        "Cotas en metros; geometría desde Google Maps: verificar en obra.",
        "Rutas de cableado esquemáticas (DC naranja, AC azul).",
        "Elementos marcados como supuesto: confirmar.",
    ]
    planta.dibujar(lam, cajetin.area_dibujo(lam, plantilla), proyecto, elems, biblioteca)
    if entrada and "muro_equipos" in entrada:
        lam = nueva("ARQ", "ALZ", "Alzado del muro de equipos y rutas de cableado")
        lam.notas = [
            "Alturas desde el nivel de piso terminado de la terraza.",
            "Medidas de equipos según ficha técnica.",
        ]
        alzado.dibujar(
            lam, cajetin.area_dibujo(lam, plantilla), proyecto, elems, entrada, biblioteca
        )
    if calc:
        lam = nueva("ELE", "UNI", "Diagrama unifilar", escala="N/A", unidad="N/A")
        lam.notas = [
            "Criterios de cálculo por confirmar contra NTC 2050 y RETIE.",
            "Arquitectura en serie; contactor de transferencia (ATS) en el tablero FV.",
        ]
        unifilar.dibujar(lam, cajetin.area_dibujo(lam, plantilla), proyecto, calc, biblioteca)
    grupos = [
        ("Vistas 3D generales (renders)", ["terraza", "isometrica", "aerea_oeste", "aerea_sur"]),
        (
            "Vista superior, rutas de cableado y equipos (renders)",
            ["superior", "cableado", "equipos"],
        ),
        ("Ruta de cableado hasta el punto de conexión (render)", ["bajante"]),
    ]
    for titulo, nombres in grupos:
        imgs = [(n, renders[n]) for n in nombres if n in renders]
        if imgs:
            lam = nueva("ARQ", "REN", titulo, escala="N/A", unidad="N/A")
            lam.notas = ["Renders ilustrativos; la ambientación de la terraza es decorativa."]
            if nombres == ["bajante"]:
                lam.notas = [
                    "Corte esquemático: pisos inferiores, vacío y tablero existente SUPUESTOS.",
                    "La AC baja por el vacío de la claraboya, corre por el techo del piso −2 "
                    "y baja al tablero existente (punto de conexión).",
                ]
            _lamina_render(lam, cajetin.area_dibujo(lam, plantilla), imgs)
    return out


def _lamina_render(lam: Lamina, area, imgs: list[tuple[str, Path]]) -> None:
    x, y, w, h = area
    sep, rot = 4, 6  # separación entre imágenes y alto del rótulo
    if imgs[0][0] == "superior" and len(imgs) > 1:
        # Vista superior grande a la izquierda; las demás apiladas a la derecha
        izq_w = min((h - rot) * 1.6, w * 0.6)
        resto = len(imgs) - 1
        ch = (h - sep * (resto - 1)) / resto
        celdas = [(x, y, izq_w, h)] + [
            (x + izq_w + sep, y + h - (i + 1) * ch - i * sep, w - izq_w - sep, ch)
            for i in range(resto)
        ]
    else:
        cols = 2 if len(imgs) > 1 else 1
        filas = (len(imgs) + cols - 1) // cols
        cw, ch = (w - sep * (cols - 1)) / cols, (h - sep * (filas - 1)) / filas
        celdas = [
            (x + (i % cols) * (cw + sep), y + h - (i // cols + 1) * ch - (i // cols) * sep, cw, ch)
            for i in range(len(imgs))
        ]
    for (nombre, ruta), (cx, cy, cw, ch) in zip(imgs, celdas, strict=True):
        iw = min(cw, (ch - rot) * 1.6)
        ih = iw / 1.6
        ix, iy = cx + (cw - iw) / 2, cy + rot + (ch - rot - ih) / 2
        lam.imagen(ruta, ix, iy, iw, ih)
        lam.rect(ix, iy, iw, ih, "CAJETIN")
        lam.texto(
            (ix + iw / 2, iy - 3.5),
            TITULOS_RENDER.get(nombre, nombre).upper(),
            2.3,
            "TEXTO",
            "centro",
            negrita=True,
        )


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
    renders = {
        p.stem.removeprefix("render_"): p
        for p in sorted((carpeta / "salidas").glob("render_*.png"))
    }

    plantilla = validar.cargar_json(PLANTILLA)
    lams = laminas(proyecto, biblioteca, entrada, calc, renders)
    mats = materiales(proyecto, biblioteca, calc)
    kwp = potencia_kwp(proyecto, biblioteca)
    fecha = args.fecha or date.today().isoformat()
    for lam in lams:
        datos = datos_cajetin(proyecto, privados, lam, len(lams), fecha, plantilla, mats, kwp)
        cajetin.dibujar(lam, plantilla, datos, validar.RAIZ)

    tiene_personales = bool(
        privados and (privados.get("cliente") or privados.get("ingeniero_responsable"))
    )
    destino = carpeta / ("privado" if tiene_personales else "salidas") / "planos"
    if destino.exists():
        for viejo in destino.glob("*"):
            viejo.unlink()  # se regeneran completos: no dejar láminas de una versión anterior
    rutas = [a_pdf(lams, destino / f"{proyecto['id']}_planos.pdf")]
    rutas += [a_dxf(lam, destino / f"{lam.codigo}.dxf") for lam in lams]
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
    p.add_argument("--fecha", help="fecha de la revisión (AAAA-MM-DD); por defecto, hoy")
    p.set_defaults(funcion=generar)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
