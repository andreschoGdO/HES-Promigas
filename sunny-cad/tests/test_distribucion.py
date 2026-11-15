"""Pruebas del Paso 4: distribución de módulos, con casos calculados a mano."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

import pytest
from shapely.geometry import Polygon

from engine import validar
from engine.distribucion.__main__ import main as cli
from engine.distribucion.colocacion import colocar, direccion, equipos_modulos, huella_mm

# Módulo ficticio de 2000 × 1000 mm para que las cuentas sean fáciles.
MOD = {"id": "mod-prueba", "dimensiones": {"ancho_mm": 1000, "alto_mm": 2000}}


def _zona(**cambios: Any) -> dict[str, Any]:
    z = {
        "id": "zona-01",
        "cubierta_ref": "cubierta-01",
        "contorno_mm": [[0, 0], [10000, 0], [10000, 5000], [0, 5000]],
        "estructura": "coplanar",
        "inclinacion_deg": 0,
        "azimut_deg": 180,
        "orientacion_modulo": "vertical",
        "separacion_mm": 20,
        "retiro_mm": 0,
        "es_supuesto": False,
    }
    z.update(cambios)
    return z


@pytest.mark.parametrize(
    ("cambios", "esperado"),
    [
        # Filas este-oeste (azimut 180). Zona 10 × 5 m, separación 20 mm.
        # Vertical: fila 1000 → ⌊10 020 / 1020⌋ = 9; pendiente 2000 → ⌊5020 / 2020⌋ = 2
        ({}, 18),
        # Horizontal: fila 2000 → ⌊10 020 / 2020⌋ = 4; pendiente 1000 → ⌊5020 / 1020⌋ = 4
        ({"orientacion_modulo": "horizontal"}, 16),
        # 60°: la pendiente se acorta a la mitad: 1000 + 10 → ⌊5010 / 1010⌋ = 4 filas × 9
        ({"inclinacion_deg": 60}, 36),
        # Retiro 500 mm → zona útil 9 × 4 m: ⌊9020/1020⌋ = 8; ⌊4020/2020⌋ = 1
        ({"retiro_mm": 500}, 8),
        # Retiro, horizontal: ⌊9020/2020⌋ = 4; ⌊4020/1020⌋ = 3
        ({"retiro_mm": 500, "orientacion_modulo": "horizontal"}, 12),
        # Azimut 90 (mira al este): las filas van norte-sur, a lo largo del lado de 5 m.
        # Vertical: ⌊5020/1020⌋ = 4 por fila; ⌊10 020/2020⌋ = 4 filas
        ({"azimut_deg": 90}, 16),
    ],
)
def test_conteo_en_rectangulo(cambios: dict[str, Any], esperado: int) -> None:
    assert len(colocar(_zona(**cambios), MOD)) == esperado


def test_rectangulo_girado_igual_que_alineado() -> None:
    # El mismo rectángulo de 10 × 5 m girado 50,8°, con filas paralelas a su lado largo,
    # admite los mismos 18 módulos.
    giro = 50.8
    ex, ey = direccion(giro + 90)  # lado largo
    nx, ny = direccion(giro)  # lado corto
    pts = [(0, 0), (10000 * ex, 10000 * ey)]
    pts.append((pts[1][0] + 5000 * nx, pts[1][1] + 5000 * ny))
    pts.append((5000 * nx, 5000 * ny))
    z = _zona(contorno_mm=[[round(x), round(y)] for x, y in pts], azimut_deg=(giro + 180) % 360)
    assert len(colocar(z, MOD)) == 18


def test_mirar_al_sur_en_edificio_girado_pierde_modulos() -> None:
    giro = 50.8
    ex, ey = direccion(giro + 90)
    nx, ny = direccion(giro)
    pts = [(0, 0), (10000 * ex, 10000 * ey)]
    pts.append((pts[1][0] + 5000 * nx, pts[1][1] + 5000 * ny))
    pts.append((5000 * nx, 5000 * ny))
    contorno = [[round(x), round(y)] for x, y in pts]
    alineado = len(colocar(_zona(contorno_mm=contorno, azimut_deg=230.8), MOD))
    al_sur = len(colocar(_zona(contorno_mm=contorno, azimut_deg=180), MOD))
    assert al_sur < alineado


def test_huella_ja_595_inclinado_5_grados() -> None:
    ja = validar.cargar_biblioteca()["ja-solar-jam72d40-595-mb"]
    du, dv, gu, gv = huella_mm(ja, _zona(inclinacion_deg=5))
    assert du == 1134
    assert dv == pytest.approx(2278 * math.cos(math.radians(5)))  # 2269,3 mm
    assert (gu, round(gv, 1)) == (20, 19.9)


def test_pergola_riomar_calculo_a_mano() -> None:
    # Pérgola de 7,15 × 4,755 m; filas a lo largo del lado de 4,755 m; JA 595 vertical a 5°:
    # ⌊(4755 + 20) / 1154⌋ = 4 por fila; ⌊(7150 + 19,9) / (2269,3 + 19,9)⌋ = 3 filas → 12
    ja = validar.cargar_biblioteca()["ja-solar-jam72d40-595-mb"]
    z = _zona(
        contorno_mm=[[0, 0], [4755, 0], [4755, 7150], [0, 7150]],
        azimut_deg=180,
        inclinacion_deg=5,
    )
    assert len(colocar(z, ja)) == 12


def test_modulos_no_se_traslapan_y_quedan_dentro() -> None:
    from engine.distribucion.colocacion import huella_poligono

    z = _zona(contorno_mm=[[0, 0], [9000, 0], [9000, 3000], [4000, 7000], [0, 7000]])
    equipos, _ = equipos_modulos([z], MOD)
    huellas = [
        Polygon(huella_poligono(tuple(e["colocacion"]["centro_mm"]), z, MOD)) for e in equipos
    ]
    zona = Polygon(z["contorno_mm"])
    assert all(zona.buffer(1).covers(h) for h in huellas)
    for i, a in enumerate(huellas):
        for b in huellas[i + 1 :]:
            assert a.intersection(b).area < 1


def test_numeracion_y_filas() -> None:
    equipos, por_zona = equipos_modulos([_zona()], MOD)
    assert [e["id"] for e in equipos[:3]] == ["modulo-001", "modulo-002", "modulo-003"]
    assert por_zona == {"zona-01": 18}
    assert {e["colocacion"]["fila"] for e in equipos} == {1, 2}
    assert max(e["colocacion"]["columna"] for e in equipos) == 9


# --- Validación de la distribución en el proyecto ------------------------------


def _proyecto_con_distribucion() -> dict[str, Any]:
    p = validar.cargar_json(validar.DIR_PROYECTOS / "ejemplo-vivienda-001" / "proyecto.json")
    ja = validar.cargar_biblioteca()["ja-solar-jam72d40-595-mb"]
    z = _zona(contorno_mm=[[500, 500], [7500, 500], [7500, 5500], [500, 5500]], inclinacion_deg=5)
    p["vivienda"]["zonas_instalacion"] = [z]
    modulos, _ = equipos_modulos([z], ja)
    p["equipos"] += modulos
    return p


def test_distribucion_valida_en_proyecto() -> None:
    assert validar.validar_proyecto(_proyecto_con_distribucion()) == []


def test_traslape_se_detecta() -> None:
    p = _proyecto_con_distribucion()
    mods = [e for e in p["equipos"] if e["tipo"] == "modulo"]
    mods[1]["colocacion"]["centro_mm"] = copy.copy(mods[0]["colocacion"]["centro_mm"])
    assert any("se traslapan" in e for e in validar.validar_proyecto(p))


def test_modulo_fuera_de_zona_se_detecta() -> None:
    p = _proyecto_con_distribucion()
    next(e for e in p["equipos"] if e["tipo"] == "modulo")["colocacion"]["centro_mm"] = [9500, 3000]
    assert any("se sale de zona-01" in e for e in validar.validar_proyecto(p))


def test_zona_fuera_de_cubierta_se_detecta() -> None:
    p = _proyecto_con_distribucion()
    p["vivienda"]["zonas_instalacion"][0]["contorno_mm"][1] = [12000, 500]
    assert any("la zona se sale de cubierta-01" in e for e in validar.validar_proyecto(p))


# --- Línea de comandos --------------------------------------------------------


def test_cli_propone_sin_aplicar_y_luego_aplica(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    monkeypatch.setattr(validar, "DIR_PROYECTOS", tmp_path)
    origen = validar.RAIZ / "projects" / "ejemplo-vivienda-001" / "proyecto.json"
    carpeta = tmp_path / "ejemplo-vivienda-001"
    (carpeta / "insumos").mkdir(parents=True)
    (carpeta / "proyecto.json").write_text(origen.read_text(encoding="utf-8"), encoding="utf-8")
    z = _zona(contorno_mm=[[500, 500], [7500, 500], [7500, 5500], [500, 5500]], inclinacion_deg=5)
    (carpeta / "insumos" / "zonas.json").write_text(json.dumps([z]), encoding="utf-8")

    assert cli(["proponer", "ejemplo-vivienda-001", "--modulo", "ja-solar-jam72d40-595-mb"]) == 0
    salida = capsys.readouterr().out
    assert "Propuesta válida" in salida
    assert (carpeta / "salidas" / "verificacion_distribucion.png").is_file()
    assert "colocacion" not in (carpeta / "proyecto.json").read_text()

    assert (
        cli(
            [
                "proponer",
                "ejemplo-vivienda-001",
                "--modulo",
                "ja-solar-jam72d40-595-mb",
                "--aplicar",
            ]
        )
        == 0
    )
    aplicado = validar.cargar_json(carpeta / "proyecto.json")
    # 7 × 5 m, vertical a 5°: ⌊7020/1154⌋ = 6 por fila; ⌊5019,9/2289,2⌋ = 2 filas → 12
    assert sum(1 for e in aplicado["equipos"] if e["tipo"] == "modulo") == 12


def test_cli_rechaza_modulo_que_no_es_modulo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(validar, "DIR_PROYECTOS", validar.RAIZ / "projects")
    assert cli(["proponer", "ejemplo-vivienda-001", "--modulo", "deye-gb-l"]) == 1


def test_holgura_minima_con_esquinas_redondeadas() -> None:
    # Pérgola de Riomar: 6,84 × 4,97 m girada 140,8°; JA 595 vertical a 5°, separación 10 mm.
    # Pendiente: 3 × 2269,3 + 2 × 9,96 = 6827,8 mm ≤ 6840 (12 mm de holgura) → 3 filas.
    # Fila: 4 × 1134 + 3 × 10 = 4566 ≤ 4970 → 4 por fila. Total 12, aunque las esquinas
    # se redondeen a mm enteros.
    ja = validar.cargar_biblioteca()["ja-solar-jam72d40-595-mb"]
    ul, ua = direccion(140.8), direccion(50.8)
    cx, cy = 12345.6, 7890.1
    pts = [
        [
            round(cx + sl * 3420 * ul[0] + sa * 2485 * ua[0]),
            round(cy + sl * 3420 * ul[1] + sa * 2485 * ua[1]),
        ]
        for sl, sa in ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ]
    z = _zona(contorno_mm=pts, inclinacion_deg=5, azimut_deg=140.8, separacion_mm=10)
    assert len(colocar(z, ja)) == 12
