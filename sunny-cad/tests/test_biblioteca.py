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
    "livoltek-hp3-10kl2",
    "livoltek-hp3-15kl2",
    "livoltek-bhf",
    "star-dtsy23s",
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
    assert any("solo se usa con inversores deye" in p for p in problemas)


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


# --- Reglas confirmadas por el usuario: marca y torres en paralelo ------------


@pytest.mark.parametrize(
    ("inversor", "bateria", "config"),
    [
        ("deye-sun-15k-sg01hp3-us-am2", "huawei-luna2000-s1", "m2"),
        ("livoltek-hp3-15kl2", "deye-gb-l", "m4"),
        ("deye-sun-15k-sg01hp3-us-am2", "livoltek-bhf", "s20"),
        ("huawei-sun2000-10k-lc0", "livoltek-bhf", "s25"),
    ],
)
def test_baterias_solo_con_su_marca(inversor: str, bateria: str, config: str) -> None:
    problemas = compatibilidad_inversor_bateria(comp(inversor), comp(bateria), config)
    assert any("solo se usa con inversores" in p for p in problemas)


@pytest.mark.parametrize("inversor", ["livoltek-hp3-10kl2", "livoltek-hp3-15kl2"])
@pytest.mark.parametrize("config", ["s10", "s15", "s20", "s25", "s30"])
def test_livoltek_hp3_con_bhf(inversor: str, config: str) -> None:
    # Puerto HP3: 100–700 V. Rangos BHF: 172,8–230,4 … 518,4–691,2 V; S20 por su nominal 409,6 V.
    assert compatibilidad_inversor_bateria(comp(inversor), comp("livoltek-bhf"), config) == []


@pytest.mark.parametrize(
    ("bateria", "config", "torres", "valido"),
    [
        ("deye-gb-l", "m4", 3, True),  # máximo Sunny: 3 torres de 4 módulos
        ("deye-gb-l", "m4", 4, False),
        ("huawei-luna2000-s1", "m3", 1, True),
        ("huawei-luna2000-s1", "m3", 2, False),  # 4 en paralelo solo con SUN2000-MB0
        ("livoltek-bhf", "s15", 2, True),  # 2 torres de 3 módulos ≈ 30 kWh (usuario)
        ("livoltek-bhf", "s20", 2, False),  # en paralelo, máximo 3 módulos por torre
        ("livoltek-bhf", "s15", 3, False),
        ("livoltek-bhf", "s30", 1, True),
        ("deye-gb-l", "m5", 2, False),  # en paralelo, máximo 4 módulos por torre
    ],
)
def test_torres_en_paralelo(bateria: str, config: str, torres: int, valido: bool) -> None:
    inversor = {
        "deye-gb-l": "deye-sun-15k-sg01hp3-us-am2",
        "huawei-luna2000-s1": "huawei-sun2000-10k-lc0",
        "livoltek-bhf": "livoltek-hp3-15kl2",
    }[bateria]
    p = _proyecto_t1_huawei()
    tipologia = "T1" if bateria == "huawei-luna2000-s1" else "T2"
    p["sistema"].update(
        tipologia=tipologia,
        fases_red="bifasica" if tipologia == "T1" else "trifasica",
        conmutacion="smartguard" if tipologia == "T1" else "ats",
    )
    p["equipos"] = [
        {"id": "inversor-01", "tipo": "inversor", "componente_ref": inversor},
        {
            "id": "bateria-01",
            "tipo": "bateria",
            "componente_ref": bateria,
            "configuracion": config,
            "sistemas_en_paralelo": torres,
        },
    ]
    errores = validar.validar_proyecto(p, biblioteca=BIBLIOTECA)
    assert (errores == []) is valido, errores


def test_paralelo_en_equipo_que_no_es_bateria_falla() -> None:
    p = _proyecto_t1_huawei()
    p["equipos"][0]["sistemas_en_paralelo"] = 2
    errores = validar.validar_proyecto(p, biblioteca=BIBLIOTECA)
    assert any("solo aplica a baterías" in e for e in errores)


# --- Coherencia de los datos nuevos ------------------------------------------


def test_ja_595_eficiencia_por_area() -> None:
    # 595 W / (2,278 m × 1,134 m) / 1000 W/m² = 23,03 % ≈ 23,0 % de la ficha
    m = comp("ja-solar-jam72d40-595-mb")
    area = m["dimensiones"]["ancho_mm"] * m["dimensiones"]["alto_mm"] / 1e6
    assert 595 / area / 10 == pytest.approx(23.03, abs=0.01)
    m["electrico"]["eficiencia_pct"] = 22.3  # valor de otra columna de la ficha
    assert any("eficiencia calculada" in e for e in coherencia_componente(m))


def test_livoltek_mppt_coherente_y_error_detectado() -> None:
    inv = comp("livoltek-hp3-10kl2")
    assert inv["electrico"]["strings_por_mppt"] == [2, 2, 1]  # 3/(2+2+1)
    assert inv["electrico"]["entradas_fv_totales"] == 5
    inv["electrico"]["corrientes_max_por_mppt_a"] = [32, 16]
    assert any("hay 3 MPPT" in e for e in coherencia_componente(inv))


def test_bhf_s20_rango_de_la_ficha_es_errata() -> None:
    # La ficha da 259,2–345,6 V para S20 (copia de S15), pero su nominal es 4 × 102,4 = 409,6 V.
    b = comp("livoltek-bhf")
    s20 = next(c for c in b["electrico"]["configuraciones"] if c["id"] == "s20")
    assert "rango_tension" not in s20
    s20["rango_tension"] = {"min_v": 259.2, "max_v": 345.6}
    assert any("fuera de su rango" in e for e in coherencia_componente(b))


def test_bhf_energia_por_modulos() -> None:
    # n × 5,12 kWh: 10,24 / 15,36 / 20,48 / 25,6 / 30,72 kWh
    # ≈ ficha: 10,2 / 15,4 / 20,5 / 25,6 / 30,7 kWh
    configs = comp("livoltek-bhf")["electrico"]["configuraciones"]
    for c in configs:
        assert c["energia_nominal_kwh"] == pytest.approx(c["modulos_bateria"] * 5.12, rel=0.01)


# --- Caso real: unifilar DEYE 15 kW + GB-L 4 módulos + 12 × JA 595 (jul 2025) ---


def test_unifilar_deye_15k_calculos_a_mano() -> None:
    ja = comp("ja-solar-jam72d40-595-mb")["electrico"]
    # Strings del plano: 8 y 4 módulos en serie.
    assert 8 * ja["voc_v"] == pytest.approx(420.64)  # "Voc string 1.1.1: 420,64"
    assert 4 * ja["voc_v"] == pytest.approx(210.32)  # "Voc string 1.2.2: 210,32"
    # 12 módulos × 595 W = 7,14 kWp, como dice el plano (la tabla dice 15 módulos: no cuadra).
    assert 12 * ja["potencia_stc_w"] == 7140
    assert 15 * ja["potencia_stc_w"] != 7140
    # Corriente AC a 220 V trifásico: 15 000 / (√3 × 220) = 39,4 A (la del plano en los cables).
    assert 15000 / (3**0.5 * 220) == pytest.approx(39.4, abs=0.05)
    # El 26,24 A de la tabla corresponde a 10 kW, no a 15 kW.
    assert 10000 / (3**0.5 * 220) == pytest.approx(26.24, abs=0.01)
    # Batería del plano: "16,36 kWh Deye HV 4 módulos" = GB-L m4, compatible con el DEYE 15K.
    gbl = comp("deye-gb-l")
    m4 = next(c for c in gbl["electrico"]["configuraciones"] if c["id"] == "m4")
    assert m4["energia_nominal_kwh"] == 16.36
    assert compatibilidad_inversor_bateria(comp("deye-sun-15k-sg01hp3-us-am2"), gbl, "m4") == []
    # Red de 220 V: dentro de 0,85–1,1 × 208 V del DEYE US-AM2 (176,8–228,8 V).
    assert 0.85 * 208 <= 220 <= 1.1 * 208
