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


# 10 px wide, 80000 px tall long-note body strip.
width, height = 10, 80000
content_x0, content_x1 = 2, 7
content_y0, content_y1 = 5, height - 5

rows = []
for y in range(height):
    row = bytearray()
    for x in range(width):
        if content_x0 <= x <= content_x1 and content_y0 <= y <= content_y1:
            row += bytes((255, 255, 255, 255))
        else:
            row += bytes((0, 0, 0, 0))
    rows.append(bytes(row))

with open(sys.argv[1], "wb") as handle:
    handle.write(make_png(width, height, rows))
