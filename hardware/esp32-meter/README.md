# Living Grid meter (ESP32 in-home display)

A small in-home display for the Bank of Scotland track: is electricity cheap right now, when is it cheapest in the
next 24 hours, and what to run later to save money. It reads the same `/api/household?region=N` endpoint as the
Tonight page (published Agile prices where Octopus has released them, our forecast beyond that).

Board: Waveshare ESP32-S3-Touch-AMOLED-1.8, V2 (CO5300 screen, 368x448, CST820 touch, TCA9554 IO expander).

## Screens

1. **Price now**: traffic-light gauge, the price in pence per kWh and a plain verdict ("Cheap now: good time to use
   power"). Cheap and pricey use Tibber's published levels: cheap at or below 90% of the average, expensive at or
   above 115% (developer.tibber.com/docs/reference, `PriceLevel`). We average the 24 hours on screen.
2. **Next 24 hours**: a clock ring of half-hour prices, a "now" marker and the cheapest window bracketed.
3. **Run it later**: car, dishwasher and heating, each with the cheapest window and the saving.

Tap the screen or press BOOT for the next screen, PWR for the previous one (short press; holding PWR for 6 s powers
the board off). Paddles on the right edge mark the buttons and flash when pressed. With nobody touching it, it moves
to the next screen every 12 seconds. Times are UK local time (GMT, BST from the last Sunday in March).

## Build and flash

```
cp living_grid_meter/secrets.example.h living_grid_meter/secrets.h   # then add the Wi-Fi name and password
arduino-cli core install esp32:esp32@3.3.12
arduino-cli compile --fqbn "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,CDCOnBoot=cdc,PartitionScheme=app3M_fat9M_16MB" \
  --libraries <waveshare repo>/examples/arduino-v2/libraries --build-path build living_grid_meter
arduino-cli upload -p /dev/cu.usbmodem101 --fqbn "<same fqbn>" --input-dir build
```

Libraries come from Waveshare's repository (github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.8,
`examples/arduino-v2/libraries`): GFX Library for Arduino, Arduino_DriveBus, Adafruit_XCA9554, Adafruit_BusIO and
`Mylibrary/pin_config.h`. Plus ArduinoJson. The Wi-Fi must be 2.4 GHz. On a Mac with Apple silicon the ESP32 core's
ctags needs Rosetta.

## Checking the design without looking at the board

Over USB serial, `1` `2` `3` pick a screen and `S` dumps the frame as raw RGB565. `tools/grab.py` turns that into PNGs:

```
uv run --with pyserial --with pillow python tools/grab.py /dev/cu.usbmodem101 out 1 2 3
```

Button presses are logged as `PRESS PWR` / `PRESS BOOT`.

Fonts are Adafruit GFX FreeFonts (GNU FreeFont, converted by Adafruit), copied with their include lines removed.
