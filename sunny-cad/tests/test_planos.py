"""Pruebas del Paso 7: láminas con cajetín, DXF y PDF."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import ezdxf
import pytest

from engine import validar
from engine.planos.__main__ import datos_cajetin, laminas
from engine.planos.__main__ import main as cli
from engine.planos.lamina import Lamina, Vista, a_dxf, a_pdf

CARPETA = validar.DIR_PROYECTOS / "riomar-terraza-barranquilla"


def test_vista_a_escala() -> None:
    # 1:100 → 1000 mm del proyecto = 10 mm de papel
    v = Vista(100, (0, 0), (50, 60))
    assert v((1000, 2000)) == (60, 80)


def test_dxf_y_pdf_de_una_lamina(tmp_path: Path) -> None:
    lam = Lamina(1, "PRU-01", "Prueba")
    lam.rect(10, 10, 100, 50, "CUBIERTA")
    lam.texto((20, 20), "Hola", 3)
    dxf = a_dxf(lam, tmp_path / "p.dxf")
    doc = ezdxf.readfile(dxf)
    assert doc.units == ezdxf.units.MM
    assert len(doc.modelspace().query("LWPOLYLINE[layer=='CUBIERTA']")) == 1
    assert doc.modelspace().query("TEXT")[0].dxf.text == "Hola"
    pdf = a_pdf([lam, lam], tmp_path / "p.pdf")
    assert pdf.read_bytes()[:4] == b"%PDF"
    assert pdf.read_bytes().count(b"/Type /Page\n") + pdf.read_bytes().count(b"/Type /Page ") >= 2


def _proyecto():
    return (
        validar.cargar_json(CARPETA / "proyecto.json"),
        validar.cargar_biblioteca(),
        validar.cargar_json(CARPETA / "insumos" / "electrico.json"),
        validar.cargar_json(CARPETA / "salidas" / "calculo_electrico.json"),
    )


def test_laminas_de_riomar() -> None:
    proyecto, bib, entrada, calc = _proyecto()
    lams = laminas(proyecto, bib, entrada, calc, [])
    assert [lam.codigo for lam in lams] == ["ARQ-01", "ARQ-02", "ELE-01"]
    assert lams[0].escala == "1:100"  # la planta de ~18 m cabe en A3 a 1:100
    assert lams[1].escala == "1:20"
    textos = " ".join(p["s"] for p in lams[2].primitivas if p["t"] == "texto")
    assert "S1.1.1" in textos and "K1" in textos and "6 AWG" in textos and "STAR" in textos
    planta = " ".join(p["s"] for p in lams[0].primitivas if p["t"] == "texto")
    assert "8.93 kWp" in planta and "15 × JAM72D40-595/MB" in planta


def test_cajetin_sin_datos_personales() -> None:
    proyecto, *_ = _proyecto()
    d = datos_cajetin(proyecto, None, Lamina(1, "ARQ-01", "Planta"), 4, "2026-11-15")
    assert d["CLIENTE"] == "" and d["INGENIERO RESPONSABLE"] == ""
    assert d["PLANO"] == "ARQ-01 1/4"
    assert d["UBICACIÓN"] == "Barranquilla, Atlántico"


def test_planos_con_datos_personales_van_a_privado(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destino = tmp_path / "riomar-terraza-barranquilla"
    shutil.copytree(
        CARPETA, destino, ignore=shutil.ignore_patterns("privado", "render_*.png", "planos")
    )
    (destino / "privado").mkdir()
    (destino / "privado" / "datos_privados.json").write_text(
        json.dumps(
            {
                "version_esquema": "1.1.0",
                "cliente": {"nombre": "Cliente de prueba"},
                "ingeniero_responsable": {
                    "nombre": "Ingeniera de prueba",
                    "matricula_profesional": "XX-000",
                },
            }
        )
    )
    monkeypatch.setattr(validar, "DIR_PROYECTOS", tmp_path)
    assert cli(["generar", "riomar-terraza-barranquilla", "--fecha", "2026-11-15"]) == 0
    assert (destino / "privado" / "planos" / "riomar-terraza-barranquilla_planos.pdf").is_file()
    assert not (destino / "salidas" / "planos").exists()
    doc = ezdxf.readfile(destino / "privado" / "planos" / "riomar-terraza-barranquilla_ARQ-01.dxf")
    textos = [t.dxf.text for t in doc.modelspace().query("TEXT")]
    assert "Cliente de prueba" in textos
    assert any("M.P. XX-000" in t for t in textos)
