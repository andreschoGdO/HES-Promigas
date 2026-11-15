"""Pruebas de la biblioteca real (Paso 2), con valores calculados a mano desde las fichas."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from engine import validar
from engine.biblioteca import coherencia_componente, compatibilidad_inversor_bateria

BIBLIOTECA = validar.cargar_biblioteca()

REALES = [
    "deye-sun-15k-sg01hp3-us-am2",
    "huawei-sun2000-10k-lc0",
    "deye-gb-l",
    "huawei-luna2000-s1",
    "huawei-smartguard-63a-s0",
    "ja-solar-jam72d40-595-mb",
]


def comp(id_: str) -> dict[str, Any]:
    return copy.deepcopy(BIBLIOTECA[id_])


@pytest.mark.parametrize("id_", REALES)
def test_componente_real_valido_y_con_ficha(id_: str) -> None:
    c = comp(id_)
    assert c["es_ejemplo"] is False
    assert validar.validar_componente(c) == []
    archivo = validar.RAIZ / c["fuente"]["archivo"]
    assert archivo.is_file() and archivo.suffix == ".pdf"


def test_ningun_manual_en_la_biblioteca() -> None:
    pdfs = list((validar.RAIZ / "library" / "fichas").rglob("*"))
    assert not [p for p in pdfs if "manual" in p.name.lower()]


# --- Coherencia, calculada a mano ---------------------------------------------


def test_ja_595_vmp_por_imp() -> None:
    # 44,64 V × 13,33 A = 595,05 W ≈ 595 W
    e = comp("ja-solar-jam72d40-595-mb")["electrico"]
    assert e["vmp_v"] * e["imp_a"] == pytest.approx(595.05, abs=0.01)


def test_error_de_transcripcion_en_modulo_se_detecta() -> None:
    m = comp("ja-solar-jam72d40-595-mb")
    m["electrico"]["imp_a"] = 12.33  # dígito cambiado: 44,64 × 12,33 = 550,4 W
    assert any("Vmp × Imp" in e for e in coherencia_componente(m))


@pytest.mark.parametrize(
    ("config", "energia", "tension"),
    # n × 4,09 kWh y n × 102,4 V (GB-LM4.0)
    [("m2", 8.18, 204.8), ("m4", 16.36, 409.6), ("m6", 24.54, 614.4)],
)
def test_gb_l_energia_y_tension_por_modulos(config: str, energia: float, tension: float) -> None:
    c = next(x for x in comp("deye-gb-l")["electrico"]["configuraciones"] if x["id"] == config)
    assert c["energia_nominal_kwh"] == pytest.approx(energia, rel=0.01)
    assert c["tension_nominal_v"] == pytest.approx(tension, rel=0.001)
    assert c["energia_util_kwh"] == pytest.approx(0.9 * c["energia_nominal_kwh"], rel=0.01)


def test_luna_energia_util_por_modulos() -> None:
    # 6,9 kWh por módulo, 100 % DoD → 6,9 / 13,8 / 20,7 kWh
    configs = comp("huawei-luna2000-s1")["electrico"]["configuraciones"]
    assert [c["energia_util_kwh"] for c in configs] == [6.9, 13.8, 20.7]
    assert [c["potencia_max_descarga_w"] for c in configs] == [3500, 7000, 10500]


def test_error_en_energia_de_bateria_se_detecta() -> None:
    b = comp("deye-gb-l")
    b["electrico"]["configuraciones"][0]["energia_nominal_kwh"] = 9.18
    assert any("no coincide con la energía nominal" in e for e in coherencia_componente(b))


# --- Compatibilidad inversor-batería, calculada a mano ------------------------


@pytest.mark.parametrize(
    ("config", "compatible"),
    # Puerto DEYE 160–500 V: 204,8 / 307,2 / 409,6 V sí; 512 y 614,4 V no.
    [("m2", True), ("m3", True), ("m4", True), ("m5", False), ("m6", False)],
)
def test_deye_15k_con_gb_l(config: str, compatible: bool) -> None:
    problemas = compatibilidad_inversor_bateria(
        comp("deye-sun-15k-sg01hp3-us-am2"), comp("deye-gb-l"), config
    )
    assert (problemas == []) is compatible
    if not compatible:
        assert "fuera del rango" in problemas[0]


@pytest.mark.parametrize("config", ["m1", "m2", "m3"])
def test_huawei_lc0_con_luna(config: str) -> None:
    # La ficha del LC0 lista LUNA2000-7/14/21-S1; rango monofásico 350–560 V = puerto 350–560 V.
    assert (
        compatibilidad_inversor_bateria(
            comp("huawei-sun2000-10k-lc0"), comp("huawei-luna2000-s1"), config
        )
        == []
    )


def test_huawei_lc0_con_gb_l_no_esta_en_la_lista() -> None:
    problemas = compatibilidad_inversor_bateria(
        comp("huawei-sun2000-10k-lc0"), comp("deye-gb-l"), "m3"
    )
    assert any("no lista 'GB-L'" in p for p in problemas)


def test_deye_15k_con_luna_rango_trifasico_no_cabe() -> None:
    # LUNA en sistema trifásico trabaja a 600–980 V; el puerto DEYE llega a 500 V.
    problemas = compatibilidad_inversor_bateria(
        comp("deye-sun-15k-sg01hp3-us-am2"), comp("huawei-luna2000-s1"), "m2"
    )
    assert any("sistema_trifasico" in p for p in problemas)


# --- Proyecto con equipos reales ---------------------------------------------


def _proyecto_t1_huawei() -> dict[str, Any]:
    p = validar.cargar_json(validar.DIR_PROYECTOS / "ejemplo-vivienda-001" / "proyecto.json")
    p["sistema"].update(
        tipologia="T1", fases_red="bifasica", arquitectura="paralelo", conmutacion="smartguard"
    )
    p["equipos"] = [
        {"id": "inversor-01", "tipo": "inversor", "componente_ref": "huawei-sun2000-10k-lc0"},
        {
            "id": "bateria-01",
            "tipo": "bateria",
            "componente_ref": "huawei-luna2000-s1",
            "configuracion": "m2",
        },
        {
            "id": "conmutacion-01",
            "tipo": "conmutacion",
            "componente_ref": "huawei-smartguard-63a-s0",
        },
        {"id": "modulo-001", "tipo": "modulo", "componente_ref": "ja-solar-jam72d40-595-mb"},
    ]
    return p


def test_t1_huawei_monofasico_usado_como_bifasico_es_valido() -> None:
    assert validar.validar_proyecto(_proyecto_t1_huawei(), biblioteca=BIBLIOTECA) == []


def test_t2_con_inversor_monofasico_falla() -> None:
    p = _proyecto_t1_huawei()
    p["sistema"].update(tipologia="T2", fases_red="trifasica", conmutacion="ats")
    errores = validar.validar_proyecto(p, biblioteca=BIBLIOTECA)
    assert any("no corresponde a la tipología T2" in e for e in errores)


def test_t2_deye_con_gb_l_fuera_de_rango_falla() -> None:
    p = _proyecto_t1_huawei()
    p["sistema"].update(tipologia="T2", fases_red="trifasica", conmutacion="ats")
    p["equipos"][0]["componente_ref"] = "deye-sun-15k-sg01hp3-us-am2"
    p["equipos"][1].update(componente_ref="deye-gb-l", configuracion="m4")
    del p["equipos"][2]  # SmartGuard es solo para Huawei monofásico
    assert validar.validar_proyecto(p, biblioteca=BIBLIOTECA) == []
    p["equipos"][1]["configuracion"] = "m5"
    errores = validar.validar_proyecto(p, biblioteca=BIBLIOTECA)
    assert any("512" in e and "fuera del rango" in e for e in errores)
