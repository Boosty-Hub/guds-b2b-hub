"""
Letra del PDF del estado de cuenta (fase 20w): instancias estáticas de Plus Jakarta Sans para jsPDF.

jsPDF solo incrusta TrueType estático (no aplica el eje de grosor de una fuente variable ni las funciones OpenType), así
que a partir del MISMO archivo de la plataforma (public/fonts/plus-jakarta-sans-es-v1.woff2, recorte OFL 400–700) se
sacan tres grosores fijos (400, 600 y 700) con las cifras tabulares ('tnum') como cifras por defecto: en el PDF las
columnas de montos quedan alineadas sin depender de funciones OpenType.

  python scripts/fuentes-pdf.py      (requiere fontTools: pip install fonttools brotli)

Salida: public/fonts/pdf/plus-jakarta-sans-pdf-<grosor>-v1.ttf (misma licencia OFL que el original). Si se cambia el
archivo, cambiar el nombre (-v2): /fonts/* tiene caché de un año.
"""
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "public" / "fonts" / "plus-jakarta-sans-es-v1.woff2"
DESTINO = RAIZ / "public" / "fonts" / "pdf"
NOMBRES = {400: "Regular", 600: "SemiBold", 700: "Bold"}


def cifras_tabulares(fuente: TTFont) -> None:
    """Apunta las cifras 0–9 del cmap a sus variantes 'tnum' (todas del mismo ancho)."""
    gsub = fuente["GSUB"].table
    reemplazo: dict[str, str] = {}
    for registro in gsub.FeatureList.FeatureRecord:
        if registro.FeatureTag != "tnum":
            continue
        for indice in registro.Feature.LookupListIndex:
            for sub in gsub.LookupList.Lookup[indice].SubTable:
                sub = getattr(sub, "ExtSubTable", sub)
                reemplazo.update(getattr(sub, "mapping", {}) or {})
    for tabla in fuente["cmap"].tables:
        for codigo, glifo in list(tabla.cmap.items()):
            if 0x30 <= codigo <= 0x39 and glifo in reemplazo:
                tabla.cmap[codigo] = reemplazo[glifo]


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    for grosor, estilo in NOMBRES.items():
        fuente = TTFont(ORIGEN)
        fuente = instancer.instantiateVariableFont(fuente, {"wght": grosor}, updateFontNames=False)
        cifras_tabulares(fuente)
        nombre = fuente["name"]
        nombre.setName("Plus Jakarta Sans PDF", 1, 3, 1, 0x409)
        nombre.setName(estilo, 2, 3, 1, 0x409)
        nombre.setName(f"Plus Jakarta Sans PDF {estilo}", 4, 3, 1, 0x409)
        nombre.setName(f"PlusJakartaSansPDF-{estilo}", 6, 3, 1, 0x409)
        fuente["OS/2"].usWeightClass = grosor
        fuente.flavor = None
        salida = DESTINO / f"plus-jakarta-sans-pdf-{grosor}-v1.ttf"
        fuente.save(salida)
        print(f"{salida.relative_to(RAIZ)}  {salida.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
