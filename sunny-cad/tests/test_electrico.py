"""Pruebas del Paso 5: motor eléctrico, con casos calculados a mano.

Datos: JA Solar JAM72D40-595/MB y Livoltek HP3-15KL2 (fichas de la biblioteca).
Temperaturas de prueba: mínima 15 °C, ambiente máxima 40 °C.
"""

from __future__ import annotations

import math

import pytest

from engine import validar
from engine.electrico import circuitos, strings

BIB = validar.cargar_biblioteca()
JA = BIB["ja-solar-jam72d40-595-mb"]
HP3 = BIB["livoltek-hp3-15kl2"]
CRIT = validar.cargar_json(validar.RAIZ / "templates" / "criterios_electricos.json")
COND = {"temperatura_min_c": 15, "temperatura_max_ambiente_c": 40}


def _t() -> strings.Temperaturas:
    return strings.temperaturas(COND, JA, CRIT)


def test_temperatura_de_celda_noct() -> None:
    # Tc = 40 + (45 − 20) × 1000 / 800 = 71,25 °C
    assert _t().max_celda_c == pytest.approx(71.25)


def test_limites_por_modulo() -> None:
    lim = strings.limites_string(JA, HP3, _t())
    # Voc frío = 52,58 × (1 − 0,0026 × (15 − 25)) = 52,58 × 1,026 = 53,947 V
    assert lim.voc_frio_v == pytest.approx(53.947, abs=0.001)
    # Vmp caliente = 44,64 × (1 − 0,0029 × 46,25) = 38,653 V
    assert lim.vmp_caliente_v == pytest.approx(38.653, abs=0.001)
    # n mín = ⌈150 / 38,653⌉ = 4 ; n máx = ⌊1000 / 53,947⌋ = 18
    assert (lim.n_min, lim.n_max) == (4, 18)
    assert lim.motivo_n_max == "tensión máxima DC del inversor"


def test_opciones_para_15_modulos() -> None:
    lim = strings.limites_string(JA, HP3, _t())
    assert strings.opciones(15, lim, HP3) == [[15], [8, 7], [5, 5, 5]]
    assert strings.elegir([[15], [8, 7], [5, 5, 5]], preferidos=2) == [8, 7]
    assert strings.elegir([[15], [8, 7], [5, 5, 5]], preferidos=1) == [15]


def test_tres_modulos_no_alcanzan_el_mppt() -> None:
    # 3 × 38,65 = 116 V < 150 V: la terraza alta sola no puede ser un string.
    lim = strings.limites_string(JA, HP3, _t())
    assert 3 < lim.n_min


def test_verificacion_detecta_string_largo() -> None:
    # 19 × 53,947 = 1025 V > 1000 V
    _, errores = strings.verificar([19], JA, HP3, _t(), CRIT)
    assert any("Voc en frío" in e for e in errores)


def test_corriente_bifacial() -> None:
    assert strings.corrientes_modulo(JA, CRIT) == (15.11, 14.40)


@pytest.mark.parametrize(
    ("corriente", "ambiente", "esperado"),
    [
        # String: 15,11 × 1,25 × 1,25 = 23,6 A; a 40 °C (×0,88):
        # 12 AWG = 22,0 A < 23,6 → 10 AWG (30,8 A)
        (15.11 * 1.25 * 1.25, 40, "10"),
        # AC HP3-15KL2: 39,4 × 1,25 = 49,25 A; 8 AWG = 44 A; 6 AWG = 57,2 A → 6 AWG
        (39.4 * 1.25, 40, "6"),
        # Batería: 48 × 1,25 = 60 A; 6 AWG = 57,2 A < 60 → 4 AWG (74,8 A)
        (60, 40, "4"),
        # A 30 °C, 60 A sí cabe en 6 AWG (65 A)
        (60, 30, "6"),
    ],
)
def test_calibre_por_ampacidad(corriente: float, ambiente: float, esperado: str) -> None:
    assert circuitos.calibre_por_ampacidad(corriente, CRIT, ambiente, "12") == esperado


@pytest.mark.parametrize(("corriente", "esperado"), [(49.25, 50), (60, 60), (18.9, 20), (50, 50)])
def test_interruptor_estandar(corriente: float, esperado: int) -> None:
    assert circuitos.interruptor(corriente, CRIT) == esperado


def test_caida_dc_a_mano() -> None:
    # 2 × 13 m × 14,4 A × 0,02097 / 5,26 mm² = 1,4926 V; sobre 8 × 44,64 = 357,12 V → 0,418 %
    assert circuitos.caida_dc_pct(13, 14.4, 357.12, "10", CRIT) == pytest.approx(0.418, abs=0.001)


def test_caida_ac_trifasica_a_mano() -> None:
    # √3 × 20 m × 39,4 A × 0,02097 / 13,3 mm² = 2,152 V; sobre 220 V → 0,978 %
    assert circuitos.caida_ac3f_pct(20, 39.4, 220, "6", CRIT) == pytest.approx(0.978, abs=0.001)


def test_longitud_en_l_con_reserva() -> None:
    # 3 m y 4 m sobre los ejes del edificio (rumbo 0) + 1 m de altura = 8 m; × 1,15 + 2 = 11,2 m
    assert circuitos.longitud_ruta_m((0, 0), 0, (3000, 4000), 1000, 0, CRIT) == pytest.approx(11.2)
    # Mismo recorrido girado 50,8°: la distancia en L no cambia.
    ux, uy = math.sin(math.radians(50.8)), math.cos(math.radians(50.8))
    vx, vy = math.sin(math.radians(140.8)), math.cos(math.radians(140.8))
    b = (3000 * ux + 4000 * vx, 3000 * uy + 4000 * vy)
    assert circuitos.longitud_ruta_m((0, 0), 0, b, 1000, 50.8, CRIT) == pytest.approx(11.2)


def test_criterios_marcados_por_confirmar() -> None:
    assert CRIT["estado"] == "por_confirmar"
    for clave in (
        "corriente_maxima_fv",
        "corriente_continua",
        "ampacidad_cu_75c_a",
        "caida_tension_max_pct",
    ):
        assert "referencia" in CRIT[clave]


def test_riomar_calculo_completo() -> None:
    from engine.electrico.__main__ import calcular

    carpeta = validar.DIR_PROYECTOS / "riomar-terraza-barranquilla"
    proyecto = validar.cargar_json(carpeta / "proyecto.json")
    entrada = validar.cargar_json(carpeta / "insumos" / "electrico.json")
    r = calcular(proyecto, entrada, BIB, CRIT)
    res = r["resultado"]
    assert [f["modulos"] for f in res["strings"]] == [8, 7]
    assert res["errores"] == []
    assert res["potencia_fv_w"] == 15 * 595
    ac = next(c for c in res["circuitos"] if c["id"] == "AC-RED")
    assert (ac["calibre_awg"], ac["proteccion"]) == ("6", "interruptor 50 A tripolar")
    mods = [e for e in r["propuesta"]["equipos"] if e["tipo"] == "modulo"]
    assert sum(1 for m in mods if m["string"] == "S1.1.1") == 8
    assert validar.validar_proyecto(r["propuesta"]) == []
