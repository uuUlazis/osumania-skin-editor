import struct
import sys
import zlib


def chunk(tag, data):
    payload = tag + data
    return struct.pack(">I", len(data)) + payload + struct.pack(
        ">I", zlib.crc32(payload) & 0xFFFFFFFF
    )


def make_png(width, height, rows):
    raw = b"".join(b"\x00" + row for row in rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


width, height = 24, 20
rows = []
for y in range(height):
    row = bytearray()
    for x in range(width):
        if 4 <= x <= 18 and 3 <= y <= 13:
            row += bytes((255, 0, 128, 200))
        else:
            row += bytes((0, 0, 0, 0))
    rows.append(bytes(row))

with open(sys.argv[1], "wb") as handle:
    handle.write(make_png(width, height, rows))
