"""Pruebas del Paso 6: modelo 3D, IFC, glTF y renders."""

from __future__ import annotations

import math
import shutil
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element
import ifcopenshell.util.unit
import pytest
import trimesh

from engine import validar
from engine.modelo3d import geometria, ifc

CARPETA = validar.DIR_PROYECTOS / "riomar-terraza-barranquilla"
BIB = validar.cargar_biblioteca()


@pytest.fixture(scope="module")
def elems() -> list[geometria.Elemento]:
    return geometria.elementos(
        validar.cargar_json(CARPETA / "proyecto.json"),
        BIB,
        validar.cargar_json(CARPETA / "insumos" / "electrico.json"),
    )


def test_plano_inclinado_a_mano() -> None:
    # Zona de 10 m en la dirección del azimut (180 = sur), 5°: el borde sur queda a z_base y el
    # norte sube 10 000 × tan 5° = 874,9 mm.
    zona = {
        "contorno_mm": [[0, 0], [4000, 0], [4000, 10000], [0, 10000]],
        "azimut_deg": 180,
        "inclinacion_deg": 5,
    }
    z = geometria.plano_zona(zona, 2000)
    assert z(2000, 0) == pytest.approx(2000)
    assert z(2000, 10000) == pytest.approx(2000 + 10000 * math.tan(math.radians(5)))


def test_conteo_de_elementos(elems) -> None:
    tipos = [e.tipo for e in elems]
    assert tipos.count("modulo") == 15
    assert tipos.count("bateria") == tipos.count("inversor") == tipos.count("tablero") == 1
    assert all(e.malla.is_watertight for e in elems)


def test_pergola_a_la_altura_de_la_terraza_alta(elems) -> None:
    # Borde bajo de los módulos de la pérgola a +2000 mm; el alto sube 6840 × tan 5° ≈ 598 mm.
    pergola = [e for e in elems if e.tipo == "modulo" and e.propiedades["zona"] == "zona-01"]
    z_min = min(e.malla.bounds[0][2] for e in pergola)
    z_max = max(e.malla.bounds[1][2] for e in pergola)
    assert z_min == pytest.approx(2000, abs=2)
    assert z_max == pytest.approx(2000 + 6840 * math.tan(math.radians(5)) + 30, abs=3)


def test_modulo_conserva_sus_medidas(elems) -> None:
    # El volumen de la caja no cambia al girarla: 1134 × 2278 × 30 mm.
    m = next(e for e in elems if e.id == "modulo-001")
    assert m.malla.volume == pytest.approx(1134 * 2278 * 30, rel=1e-6)


def test_equipos_no_atraviesan_la_terraza_alta(elems) -> None:
    from shapely.geometry import MultiPoint, Polygon

    proyecto = validar.cargar_json(CARPETA / "proyecto.json")
    alta = Polygon(proyecto["vivienda"]["cubiertas"][1]["contorno_mm"])
    for e in elems:
        if e.tipo in ("inversor", "bateria", "tablero"):
            huella = MultiPoint(e.malla.vertices[:, :2].tolist()).convex_hull
            assert huella.intersection(alta).area < 1, e.id  # < 1 mm²


def test_bateria_en_el_piso(elems) -> None:
    bat = next(e for e in elems if e.tipo == "bateria")
    assert bat.malla.bounds[0][2] == pytest.approx(0)
    assert bat.malla.bounds[1][2] == pytest.approx(1167)  # alto de la BHF-S15


def test_ifc(elems, tmp_path: Path) -> None:
    proyecto = validar.cargar_json(CARPETA / "proyecto.json")
    f = ifcopenshell.open(str(ifc.exportar(proyecto, elems, tmp_path / "m.ifc")))
    assert f.schema == "IFC4"
    assert len(f.by_type("IfcSolarDevice")) == 15
    assert len(f.by_type("IfcElectricFlowStorageDevice")) == 1
    assert ifcopenshell.util.unit.calculate_unit_scale(f) == pytest.approx(0.001)  # mm
    m = next(x for x in f.by_type("IfcSolarDevice") if x.Name == "modulo-001")
    pset = ifcopenshell.util.element.get_psets(m)["Pset_SunnyCad"]
    assert (pset["modelo"], pset["potencia_w"], pset["string"]) == (
        "JAM72D40-595/MB",
        595,
        "S1.1.1",
    )


def test_gltf_en_metros_y_y_arriba(elems, tmp_path: Path) -> None:
    ruta = tmp_path / "m.glb"
    geometria.escena(elems).export(ruta)
    sc = trimesh.load(ruta)
    assert "modulo-015" in sc.geometry
    # Y es la altura en glTF: el borde alto del módulo 001 de la pérgola ≈ 2,63 m.
    assert sc.geometry["modulo-001"].bounds[1][1] == pytest.approx(2.628, abs=0.01)


@pytest.mark.skipif(shutil.which("blender") is None, reason="Blender no está instalado")
def test_render_rapido(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from engine.modelo3d.__main__ import main as cli

    destino = tmp_path / "riomar-terraza-barranquilla"
    shutil.copytree(CARPETA, destino, ignore=shutil.ignore_patterns("privado", "salidas"))
    monkeypatch.setattr(validar, "DIR_PROYECTOS", tmp_path)
    assert (
        cli(
            [
                "generar",
                "riomar-terraza-barranquilla",
                "--render",
                "--resolucion",
                "64",
                "40",
                "--muestras",
                "1",
            ]
        )
        == 0
    )
    assert len(list((destino / "salidas").glob("render_*.png"))) == 4
    assert "__GLB_BASE64__" not in (destino / "salidas" / "visor_3d.html").read_text()


def test_pergola_de_madera_adosada(elems) -> None:
    # Lado contra la terraza alta: durmiente sin columnas; columnas solo en el lado libre:
    # 2 esquinas libres + 1 a mitad del lado libre de 6,84 m (> 5 m).
    madera = [e for e in elems if e.tipo == "madera"]
    assert len([e for e in madera if "columna" in e.id]) == 3
    assert len([e for e in madera if "durmiente" in e.id]) == 1
    assert all(e.propiedades["material"] == "madera" for e in madera)


def test_muro_y_buitron_en_el_modelo(elems) -> None:
    tipos = {e.tipo for e in elems}
    assert {"muro", "buitron"} <= tipos
    muro = next(e for e in elems if e.tipo == "muro")
    assert muro.malla.bounds[1][2] == pytest.approx(3000)


def test_sin_choques_3d_entre_equipos(elems) -> None:
    """Dos elementos chocan si sus huellas en planta se cruzan y sus alturas se solapan."""
    from shapely.geometry import MultiPoint

    tipos = ("inversor", "bateria", "tablero", "buitron", "madera")
    sel = [e for e in elems if e.tipo in tipos]
    for i, a in enumerate(sel):
        ha = MultiPoint(a.malla.vertices[:, :2].tolist()).convex_hull
        for b in sel[i + 1 :]:
            if a.tipo == b.tipo == "madera":
                continue  # las piezas de la pérgola se unen entre sí
            hb = MultiPoint(b.malla.vertices[:, :2].tolist()).convex_hull
            z_solapa = min(a.malla.bounds[1][2], b.malla.bounds[1][2]) > max(
                a.malla.bounds[0][2], b.malla.bounds[0][2]
            )
            assert not (ha.intersection(hb).area > 1 and z_solapa), (a.id, b.id)
