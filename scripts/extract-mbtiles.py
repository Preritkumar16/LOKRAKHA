#!/usr/bin/env python3
"""
Extract a focused Mumbai/Western-suburbs XYZ vector-tile set from the
OpenMapTiles MBTiles source.

Source:
  osm-2020-02-10-v3.11_india_mumbai.mbtiles

Output:
  public/assets/maps/mumbai/{z}/{x}/{y}.pbf

The MBTiles source uses TMS rows; this script converts them to XYZ.
"""
from pathlib import Path
import sqlite3
import math
import shutil
import gzip

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "osm-2020-02-10-v3.11_india_mumbai.mbtiles"
OUT = ROOT / "public" / "assets" / "maps" / "mumbai"

# Mumbai/Western suburbs + surrounding demonstration area.
WEST, SOUTH, EAST, NORTH = 72.65, 18.75, 73.15, 19.40
MIN_ZOOM, MAX_ZOOM = 10, 14

def lon_to_x(lon, z):
    return int((lon + 180.0) / 360.0 * (2 ** z))

def lat_to_y(lat, z):
    return int(
        (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi)
        / 2.0 * (2 ** z)
    )


def decode_tile_payload(data: bytes) -> bytes:
    if data.startswith(b"\x1f\x8b"):
        return gzip.decompress(data)
    return data


if not SOURCE.exists():
    raise SystemExit(
        f"Missing MBTiles source: {SOURCE}\n"
        "Place osm-2020-02-10-v3.11_india_mumbai.mbtiles in the project root."
    )

if OUT.exists():
    shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(SOURCE)
meta = dict(db.execute("SELECT name, value FROM metadata").fetchall())

if meta.get("format") != "pbf":
    raise SystemExit(f"Expected PBF MBTiles, found format={meta.get('format')!r}")
if meta.get("scheme", "tms").lower() != "tms":
    raise SystemExit(f"Expected TMS scheme, found scheme={meta.get('scheme')!r}")

total = 0

for z in range(MIN_ZOOM, MAX_ZOOM + 1):
    x_min = lon_to_x(WEST, z)
    x_max = lon_to_x(EAST, z)

    xyz_y_north = lat_to_y(NORTH, z)
    xyz_y_south = lat_to_y(SOUTH, z)

    tms_y_min = (2 ** z - 1) - xyz_y_south
    tms_y_max = (2 ** z - 1) - xyz_y_north

    rows = db.execute(
        """
        SELECT map.tile_column, map.tile_row, images.tile_data
        FROM map
        JOIN images ON map.tile_id = images.tile_id
        WHERE map.zoom_level = ?
          AND map.tile_column BETWEEN ? AND ?
          AND map.tile_row BETWEEN ? AND ?
        GROUP BY map.zoom_level, map.tile_column, map.tile_row
        """,
        (z, x_min, x_max, min(tms_y_min, tms_y_max), max(tms_y_min, tms_y_max))
    )

    count = 0
    for x, tms_y, data in rows:
        xyz_y = (2 ** z - 1) - tms_y
        destination = OUT / str(z) / str(x) / f"{xyz_y}.pbf"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(decode_tile_payload(data))
        count += 1
        total += 1

    print(f"z{z}: extracted {count:,} vector tiles")

db.close()

print(f"\nDone. Extracted {total:,} local vector tiles.")
print(f"Coverage: {WEST},{SOUTH} to {EAST},{NORTH}")
print(f"Zoom range: z{MIN_ZOOM}–z{MAX_ZOOM}")
print(f"Output: {OUT}")
