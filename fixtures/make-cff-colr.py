"""Generate a small, wholly synthetic CFF1 + COLR v0/CPAL font for browser QA.

Requires fontTools. The generated OTF has four glyphs and no third-party outlines.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import newTable
from fontTools.ttLib.tables.C_P_A_L_ import Color
from fontTools.ttLib.tables import otTables

names = [".notdef", "base", "red", "blue"]
fb = FontBuilder(1000, isTTF=False)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({65: "base"})
fb.setupHorizontalMetrics({name: (1000, 0) for name in names})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Synthetic Color QA", "styleName": "Regular", "uniqueFontIdentifier": "Synthetic-Color-QA", "fullName": "Synthetic Color QA", "psName": "SyntheticColorQA-Regular", "version": "Version 1.0"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost()
chars = {}
for name in names:
    pen = T2CharStringPen(1000, None)
    if name != ".notdef":
        left, right = (100, 900) if name == "base" else ((100, 500) if name == "red" else (500, 900))
        pen.moveTo((left, 0)); pen.lineTo((right, 0))
        pen.lineTo((right, 700)); pen.lineTo((left, 700)); pen.closePath()
    chars[name] = pen.getCharString()
fb.setupCFF("SyntheticColorQA-Regular", {"FullName": "Synthetic Color QA", "FamilyName": "Synthetic Color QA", "Weight": "Regular"}, chars, {})
fb.setupMaxp()
colr = newTable("COLR"); colr.version = 0
colr.ColorLayers = {}
for name, color_id in (("red", 0), ("blue", 1)):
    layer = otTables.LayerRecord(); layer.name = name; layer.colorID = color_id
    colr.ColorLayers.setdefault("base", []).append(layer)
cpal = newTable("CPAL"); cpal.version = 0; cpal.numPaletteEntries = 2
cpal.palettes = [
    [Color(blue=0, green=0, red=255, alpha=128), Color(blue=255, green=0, red=0, alpha=255)],
    [Color(blue=0, green=255, red=0, alpha=255), Color(blue=255, green=0, red=255, alpha=128)],
]
fb.font["COLR"] = colr; fb.font["CPAL"] = cpal
fb.save(Path(__file__).with_name("cff-colr-v0.otf"))
print("synthetic fixture OK")
