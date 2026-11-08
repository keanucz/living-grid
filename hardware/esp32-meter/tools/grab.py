"""Capture the meter's screens over USB serial: send '1'..'3' to pick a screen, 'S' to dump raw RGB565, save PNGs."""
import sys
import time

import serial
from PIL import Image

PORT = sys.argv[1]
OUT = sys.argv[2]
SCREENS = sys.argv[3:] or ["1", "2", "3"]


def read_frame(s: serial.Serial) -> Image.Image:
    s.reset_input_buffer()
    s.write(b"S")
    deadline = time.time() + 15
    line = b""
    while time.time() < deadline:
        line = s.readline()
        if line.startswith(b"LGIMG"):
            break
    else:
        raise RuntimeError("no LGIMG header")
    _, w, h = line.decode().split()
    w, h = int(w), int(h)
    need = w * h * 2
    buf = bytearray()
    while len(buf) < need and time.time() < deadline + 20:
        buf += s.read(need - len(buf))
    if len(buf) < need:
        raise RuntimeError(f"short frame {len(buf)}/{need}")
    img = Image.new("RGB", (w, h))
    px = img.load()
    for i in range(w * h):
        v = buf[2 * i] | (buf[2 * i + 1] << 8)
        px[i % w, i // w] = (((v >> 11) & 0x1F) << 3, ((v >> 5) & 0x3F) << 2, (v & 0x1F) << 3)
    return img


with serial.Serial(PORT, 115200, timeout=2) as s:
    time.sleep(1.0)
    for sc in SCREENS:
        s.write(sc.encode())
        time.sleep(1.5)
        img = read_frame(s)
        path = f"{OUT}/screen{sc}.png"
        img.save(path)
        print("saved", path)
