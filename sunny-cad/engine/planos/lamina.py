"""Láminas de planos (Paso 7): primitivas en mm de papel y exportación a DXF y PDF.

Una lámina es una lista de primitivas en coordenadas de papel (mm, origen abajo a la izquierda).
El mismo contenido se escribe a DXF (editable en CAD) y a PDF (matplotlib), así ambos coinciden.
Los planos se generan desde proyecto.json; nunca se editan a mano (CLAUDE.md).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

FORMATOS_MM = {"A3": (420, 297), "A2": (594, 420), "A1": (841, 594)}

# capa: (color ACI para DXF, color para PDF, grosor de línea en mm)
CAPAS = {
    "MARCO": (7, "#000000", 0.5),
    "CAJETIN": (7, "#000000", 0.35),
    "TEXTO": (7, "#000000", 0.18),
    "CUBIERTA": (8, "#555555", 0.35),
    "ZONA": (30, "#d97a00", 0.25),
    "MODULO": (5, "#1c3a78", 0.18),
    "ESTRUCTURA": (32, "#8b5e3c", 0.25),
    "EQUIPO": (1, "#c0392b", 0.35),
    "COTA": (3, "#2e7d32", 0.18),
    "UNIFILAR": (7, "#000000", 0.3),
    "DC": (1, "#c0392b", 0.3),
    "AC": (5, "#1f4e9c", 0.3),
    "NOTA": (8, "#555555", 0.18),
}


@dataclass
class Lamina:
    numero: int
    codigo: str  # por ejemplo "ARQ-01"
    titulo: str
    formato: str = "A3"
    escala: str = "INDICADA"
    disciplina: str = "ARQ"
    tipo: str = "DIS"
    unidad: str = "m"
    notas: list[str] = field(default_factory=list)
    primitivas: list[dict[str, Any]] = field(default_factory=list)

    @property
    def tamano(self) -> tuple[float, float]:
        return FORMATOS_MM[self.formato]

    # --- primitivas -------------------------------------------------------------------------
    def linea(self, a, b, capa="TEXTO", trazo="continuo") -> None:
        self.primitivas.append(
            {
                "t": "polilinea",
                "pts": [tuple(a), tuple(b)],
                "cerrada": False,
                "capa": capa,
                "trazo": trazo,
            }
        )

    def polilinea(
        self, pts, capa="TEXTO", cerrada=False, relleno: str | None = None, trazo="continuo"
    ) -> None:
        self.primitivas.append(
            {
                "t": "polilinea",
                "pts": [tuple(p) for p in pts],
                "cerrada": cerrada,
                "capa": capa,
                "relleno": relleno,
                "trazo": trazo,
            }
        )

    def rect(self, x, y, w, h, capa="TEXTO", relleno: str | None = None, trazo="continuo") -> None:
        self.polilinea([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], capa, True, relleno, trazo)

    def texto(
        self, p, s: str, altura=2.5, capa="TEXTO", alinear="izq", rotacion=0.0, negrita=False
    ) -> None:
        self.primitivas.append(
            {
                "t": "texto",
                "p": tuple(p),
                "s": str(s),
                "h": altura,
                "capa": capa,
                "alinear": alinear,
                "rot": rotacion,
                "negrita": negrita,
            }
        )

    def circulo(self, c, r, capa="TEXTO", relleno: str | None = None) -> None:
        self.primitivas.append(
            {"t": "circulo", "c": tuple(c), "r": r, "capa": capa, "relleno": relleno}
        )

    def imagen(self, ruta: Path, x, y, w, h) -> None:
        self.primitivas.append({"t": "imagen", "ruta": str(ruta), "x": x, "y": y, "w": w, "h": h})


class Vista:
    """Transformación de mm del proyecto a mm de papel con una escala 1:N."""

    def __init__(self, escala_n: float, origen_modelo, origen_papel):
        self.k = 1 / escala_n
        self.om = origen_modelo
        self.op = origen_papel

    def __call__(self, p):
        return (
            self.op[0] + (p[0] - self.om[0]) * self.k,
            self.op[1] + (p[1] - self.om[1]) * self.k,
        )


# --- exportación ---------------------------------------------------------------------------------
_ALINEAR_DXF = {
    "izq": "BOTTOM_LEFT",
    "centro": "MIDDLE_CENTER",
    "der": "BOTTOM_RIGHT",
    "izq_medio": "MIDDLE_LEFT",
}


def a_dxf(lamina: Lamina, ruta: Path) -> Path:
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new("R2018", setup=True)
    doc.units = ezdxf.units.MM
    for nombre, (aci, _, grosor) in CAPAS.items():
        capa = doc.layers.add(nombre, color=aci)
        capa.dxf.lineweight = int(round(grosor * 100))
    msp = doc.modelspace()
    for p in lamina.primitivas:
        if p["t"] == "polilinea":
            attrs = {"layer": p["capa"]}
            if p.get("trazo") == "discontinuo":
                attrs["linetype"] = "DASHED"
            msp.add_lwpolyline(p["pts"], close=p["cerrada"], dxfattribs=attrs)
        elif p["t"] == "texto":
            t = msp.add_text(
                p["s"], height=p["h"], rotation=p["rot"], dxfattribs={"layer": p["capa"]}
            )
            t.set_placement(p["p"], align=TextEntityAlignment[_ALINEAR_DXF[p["alinear"]]])
        elif p["t"] == "circulo":
            msp.add_circle(p["c"], p["r"], dxfattribs={"layer": p["capa"]})
        elif p["t"] == "imagen":
            msp.add_text(
                f"[imagen: {Path(p['ruta']).name}]", height=3, dxfattribs={"layer": "NOTA"}
            ).set_placement((p["x"] + 2, p["y"] + 2))
            msp.add_lwpolyline(
                [
                    (p["x"], p["y"]),
                    (p["x"] + p["w"], p["y"]),
                    (p["x"] + p["w"], p["y"] + p["h"]),
                    (p["x"], p["y"] + p["h"]),
                ],
                close=True,
                dxfattribs={"layer": "NOTA"},
            )
    ruta.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(ruta)
    return ruta


_ALINEAR_MPL = {
    "izq": ("left", "bottom"),
    "centro": ("center", "center"),
    "der": ("right", "bottom"),
    "izq_medio": ("left", "center"),
}


def a_pdf(laminas: list[Lamina], ruta: Path) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.patches import Circle, Polygon

    PT_POR_MM = 72 / 25.4
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(ruta) as pdf:
        for lam in laminas:
            w, h = lam.tamano
            fig = plt.figure(figsize=(w / 25.4, h / 25.4))
            ax = fig.add_axes((0, 0, 1, 1))
            ax.set_xlim(0, w)
            ax.set_ylim(0, h)
            ax.set_aspect("equal")
            ax.axis("off")
            for p in lam.primitivas:
                _, color, grosor = CAPAS.get(p.get("capa", "TEXTO"), CAPAS["TEXTO"])
                if p["t"] == "polilinea":
                    estilo = "--" if p.get("trazo") == "discontinuo" else "-"
                    if p.get("relleno") or p["cerrada"]:
                        ax.add_patch(
                            Polygon(
                                p["pts"],
                                closed=p["cerrada"],
                                facecolor=p.get("relleno") or "none",
                                edgecolor=color,
                                linewidth=grosor * PT_POR_MM,
                                linestyle=estilo,
                            )
                        )
                    else:
                        xs, ys = zip(*p["pts"], strict=True)
                        ax.plot(xs, ys, color=color, linewidth=grosor * PT_POR_MM, linestyle=estilo)
                elif p["t"] == "texto":
                    ha, va = _ALINEAR_MPL[p["alinear"]]
                    ax.text(
                        *p["p"],
                        p["s"],
                        fontsize=p["h"] * PT_POR_MM / 0.72,
                        color=color,
                        ha=ha,
                        va=va,
                        rotation=p["rot"],
                        rotation_mode="anchor",
                        family="DejaVu Sans",
                        fontweight="bold" if p["negrita"] else "normal",
                    )
                elif p["t"] == "circulo":
                    ax.add_patch(
                        Circle(
                            p["c"],
                            p["r"],
                            facecolor=p.get("relleno") or "none",
                            edgecolor=color,
                            linewidth=grosor * PT_POR_MM,
                        )
                    )
                elif p["t"] == "imagen":
                    img = plt.imread(p["ruta"])
                    ax.imshow(
                        img,
                        extent=(p["x"], p["x"] + p["w"], p["y"], p["y"] + p["h"]),
                        zorder=0,
                        aspect="auto",
                    )
            pdf.savefig(fig)
            plt.close(fig)
    return ruta
