// Living Grid meter: is electricity cheap right now, and when is it cheapest, on a Waveshare
// ESP32-S3-Touch-AMOLED-1.8 (V2 board, CO5300 screen, 368x448). Data: the Living Grid /household endpoint,
// which uses published Agile prices where they exist and our forecast beyond them.
//
// Three screens, chosen from what makes in-home displays easy to read:
//   1. NOW: a traffic-light gauge, the price in pence and a plain verdict ("Cheap now", "Wait if you can").
//      Cost, not kWh, and a comparison with today's average, so nobody has to do maths.
//   2. NEXT 24 HOURS: a clock ring of half-hour prices with "now" and the cheapest window marked.
//   3. SAVE: what to run when, with the saving, for the car, the dishwasher and the heating.
// Tap the screen or press BOOT (upper side button) for the next screen, PWR (lower) for the previous one (short press;
// holding PWR for 6 s powers the board off). Paddles on the right edge show where the buttons are and flash when pressed.
// It moves on by itself after 12 s when nobody touches it.
// Over USB serial, '1' '2' '3' pick a screen and 'S' dumps the frame (raw RGB565) for checking the design.

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "Arduino_GFX_Library.h"
#include "Arduino_DriveBus_Library.h"
#include <Adafruit_XCA9554.h>
#include "pin_config.h"
#include "HWCDC.h"
#include "FreeSansBold24pt7b.h"
#include "FreeSansBold18pt7b.h"
#include "FreeSansBold12pt7b.h"
#include "FreeSansBold9pt7b.h"
#include "FreeSans12pt7b.h"
#include "FreeSans9pt7b.h"

#include "meter_types.h"
#include "secrets.h"  // WIFI_SSID_VALUE, WIFI_PASS_VALUE (local only, never committed)

// ---------- settings ----------
const char *WIFI_SSID = WIFI_SSID_VALUE;
const char *WIFI_PASS = WIFI_PASS_VALUE;  // "" for an open network
const char *URL = "https://htb.stefvuck.dev/api/household?region=N";
const char *PLACE = "EDINBURGH";
const uint32_t REFRESH_MS = 60000;
const uint32_t AUTO_NEXT_MS = 12000;   // move to the next screen after this long ...
const uint32_t IDLE_MS = 45000;        // ... once nobody has touched it for this long
const int BOOT_BUTTON = 0;
const int PWR_EXIO = 4;              // PWR is read through the IO expander, high = pressed (Waveshare FAQ)
// Paddle centres on the right edge, next to the side buttons: BOOT is the upper button, PWR the lower (checked on
// the board). BOOT is "next" because it is pressed most and, unlike PWR, cannot power the board off if held.
const int PADDLE_BOOT_Y = 150, PADDLE_PWR_Y = 262, PADDLE_H = 64;
const uint32_t FLASH_MS = 260;
const int SCREENS = 3;
// Price levels as Tibber defines them (developer.tibber.com/docs/reference, PriceLevel): cheap at or below 90% of
// the average, expensive at or above 115%. Tibber averages the trailing 3 days; we use the 24 hours on screen.
const float CHEAP_BELOW = 0.90f;
const float PRICEY_ABOVE = 1.15f;
const char *UK_TZ = "GMT0BST,M3.5.0/1,M10.5.0";  // UK clocks: GMT, BST from the last Sunday in March
const float HEAT_KW = 2.0;             // heating plan assumption: a 2 kW heater or heat pump for 2 hours
const int HEAT_SLOTS = 4;              // 4 half-hours
const int READY_BY = 7;                // warm by 07:00

// ---------- hardware ----------
HWCDC USBSerial;
Adafruit_XCA9554 expander;
Arduino_DataBus *bus = new Arduino_ESP32QSPI(LCD_CS, LCD_SCLK, LCD_SDIO0, LCD_SDIO1, LCD_SDIO2, LCD_SDIO3);
Arduino_CO5300 *panel = new Arduino_CO5300(bus, GFX_NOT_DEFINED, 0, LCD_WIDTH, LCD_HEIGHT, 16, 0, 0, 0);
Arduino_Canvas *gfx = new Arduino_Canvas(LCD_WIDTH, LCD_HEIGHT, panel);  // draw off-screen, then flush: no flicker
std::shared_ptr<Arduino_IIC_DriveBus> iicBus = std::make_shared<Arduino_HWIIC>(IIC_SDA, IIC_SCL, &Wire);
void onTouch() {}
std::unique_ptr<Arduino_IIC> touch(new Arduino_CST816x(iicBus, CST816T_DEVICE_ADDRESS, DRIVEBUS_DEFAULT_VALUE, TP_INT, onTouch));
bool haveTouch = false;
bool haveExpander = false;
uint32_t flashUntil[2] = {0, 0};  // 0 = PWR (back), 1 = BOOT (next)

// ---------- data ----------

Slot slots[96];
int nSlots = 0;
Window wins[3];
int nWins = 0;
char updated[6] = "--:--";
int nowMinute = 0;
char status[48] = "Starting";
bool haveData = false;
int screen = 0;
uint32_t lastFetch = 0, lastInput = 0, shownAt = 0;

// ---------- colours (RGB565) ----------
uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3); }
const uint16_t BG = 0x0000;
const uint16_t INK = rgb(244, 244, 246), QUIET = rgb(150, 150, 160), DIM = rgb(70, 70, 80), CARD = rgb(22, 22, 28);
const uint16_t GOOD = rgb(46, 204, 113), MID = rgb(245, 176, 65), BAD = rgb(235, 87, 87), PAID = rgb(80, 180, 255);
const uint16_t BRAND = rgb(200, 255, 100);

// ---------- small helpers ----------
int minutesOf(const char *hhmm) { return atoi(hhmm) * 60 + atoi(hhmm + 3); }

long daysFromCivil(int y, unsigned m, unsigned d) {  // days since 1970-01-01 (Howard Hinnant's algorithm)
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long)doe - 719468;
}

void copyHHMM(char *dst, const char *iso) {  // "2026-11-08T03:00:00Z" (UTC) -> "03:00" in UK local time
  int y = atoi(iso), mo = atoi(iso + 5), d = atoi(iso + 8), h = atoi(iso + 11), mi = atoi(iso + 14);
  time_t t = (time_t)(daysFromCivil(y, mo, d) * 86400L + h * 3600L + mi * 60L);
  struct tm local;
  localtime_r(&t, &local);
  snprintf(dst, 6, "%02d:%02d", local.tm_hour, local.tm_min);
}

float avgP() { float s = 0; for (int i = 0; i < nSlots; i++) s += slots[i].p; return nSlots ? s / nSlots : 0; }
float minP() { float m = 1e9; for (int i = 0; i < nSlots; i++) m = min(m, slots[i].p); return m; }
float maxP() { float m = -1e9; for (int i = 0; i < nSlots; i++) m = max(m, slots[i].p); return m; }

Band bandOf(float p) {
  float a = avgP();
  if (p < 0) return B_PAID;
  if (p <= a * CHEAP_BELOW) return B_CHEAP;
  if (p >= a * PRICEY_ABOVE) return B_PRICEY;
  return B_NORMAL;
}
uint16_t colourOf(Band b) { return b == B_PAID ? PAID : b == B_CHEAP ? GOOD : b == B_PRICEY ? BAD : MID; }

void text(const GFXfont *f, int size, uint16_t col, int x, int y, const char *s) {
  gfx->setFont(f);
  gfx->setTextSize(size);
  gfx->setTextColor(col);
  gfx->setCursor(x, y);
  gfx->print(s);
}

int textWidth(const GFXfont *f, int size, const char *s) {
  int16_t x1, y1;
  uint16_t w, h;
  gfx->setFont(f);
  gfx->setTextSize(size);
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return w + x1;
}

void textC(const GFXfont *f, int size, uint16_t col, int cx, int y, const char *s) {
  text(f, size, col, cx - textWidth(f, size, s) / 2, y, s);
}

void textR(const GFXfont *f, int size, uint16_t col, int rx, int y, const char *s) {
  text(f, size, col, rx - textWidth(f, size, s), y, s);
}

// fillArc in this library measures degrees clockwise from 3 o'clock; split arcs that cross 0.
void arc(int cx, int cy, int r1, int r2, float a0, float a1, uint16_t c) {
  while (a0 >= 360) { a0 -= 360; a1 -= 360; }
  if (a1 > 360) {
    gfx->fillArc(cx, cy, r1, r2, a0, 359.99f, c);
    gfx->fillArc(cx, cy, r1, r2, 0, a1 - 360, c);
  } else {
    gfx->fillArc(cx, cy, r1, r2, a0, a1, c);
  }
}

void polar(int cx, int cy, float r, float deg, int &x, int &y) {
  x = cx + (int)lroundf(r * cosf(deg * DEG_TO_RAD));
  y = cy + (int)lroundf(r * sinf(deg * DEG_TO_RAD));
}

void thickLine(int x0, int y0, int x1, int y1, int w, uint16_t c) {
  float dx = x1 - x0, dy = y1 - y0, len = sqrtf(dx * dx + dy * dy);
  if (len < 1) return;
  float nx = -dy / len * w / 2, ny = dx / len * w / 2;
  gfx->fillTriangle(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, c);
  gfx->fillTriangle(x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, c);
  gfx->fillCircle(x0, y0, w / 2, c);
  gfx->fillCircle(x1, y1, w / 2, c);
}

// ---------- vector icons ----------
void drawBolt(int cx, int cy, int s, uint16_t c) {  // lightning bolt from two triangles, s = half height
  gfx->fillTriangle(cx + s * 0.30f, cy - s, cx - s * 0.50f, cy + s * 0.15f, cx + s * 0.12f, cy + s * 0.15f, c);
  gfx->fillTriangle(cx - s * 0.30f, cy + s, cx + s * 0.50f, cy - s * 0.15f, cx - s * 0.12f, cy - s * 0.15f, c);
}

void drawLogo(int cx, int cy, int r) {  // hexagon (a grid cell) with a bolt
  int px[6], py[6];
  for (int k = 0; k < 6; k++) polar(cx, cy, r, -90 + 60 * k, px[k], py[k]);
  for (int k = 0; k < 6; k++) thickLine(px[k], py[k], px[(k + 1) % 6], py[(k + 1) % 6], 3, BRAND);
  drawBolt(cx, cy, r * 0.62f, BRAND);
}

void drawCheck(int cx, int cy, int s, uint16_t c) {
  thickLine(cx - s, cy, cx - s / 3, cy + s * 2 / 3, 5, c);
  thickLine(cx - s / 3, cy + s * 2 / 3, cx + s, cy - s * 2 / 3, 5, c);
}

void drawClock(int cx, int cy, int r, uint16_t c, uint16_t bg) {
  gfx->fillCircle(cx, cy, r, c);
  gfx->fillCircle(cx, cy, r - 4, bg);
  thickLine(cx, cy, cx, cy - r * 0.6f, 3, c);
  thickLine(cx, cy, cx + r * 0.45f, cy, 3, c);
}

void drawEqual(int cx, int cy, int s, uint16_t c) {
  thickLine(cx - s, cy - s / 3, cx + s, cy - s / 3, 5, c);
  thickLine(cx - s, cy + s / 3, cx + s, cy + s / 3, 5, c);
}

void drawCar(int x, int y, uint16_t c, uint16_t bg) {  // 64 x 44
  gfx->fillRoundRect(x, y + 18, 64, 18, 7, c);
  gfx->fillRoundRect(x + 13, y + 4, 36, 22, 9, c);
  gfx->fillRoundRect(x + 18, y + 9, 12, 10, 3, bg);
  gfx->fillRoundRect(x + 33, y + 9, 11, 10, 3, bg);
  for (int wx : {x + 15, x + 49}) { gfx->fillCircle(wx, y + 37, 8, bg); gfx->fillCircle(wx, y + 37, 6, c); gfx->fillCircle(wx, y + 37, 2, bg); }
  drawBolt(x + 32, y + 27, 6, bg);
}

void drawDishwasher(int x, int y, uint16_t c, uint16_t bg) {  // 48 x 52
  gfx->fillRoundRect(x, y, 48, 52, 8, c);
  gfx->fillRoundRect(x + 4, y + 14, 40, 34, 5, bg);
  gfx->fillCircle(x + 10, y + 7, 3, bg);
  gfx->fillCircle(x + 20, y + 7, 3, bg);
  gfx->fillRoundRect(x + 30, y + 5, 12, 5, 2, bg);
  for (int k = 0; k < 3; k++) gfx->fillRoundRect(x + 11 + k * 10, y + 22, 6, 20, 3, c);  // plates
}

void drawRadiator(int x, int y, uint16_t c, uint16_t bg) {  // 56 x 52
  for (int k = 0; k < 5; k++) gfx->fillRoundRect(x + 3 + k * 10, y + 12, 8, 36, 4, c);
  gfx->fillRect(x, y + 40, 56, 4, c);
  for (int k = 0; k < 3; k++) {  // heat waves
    int wx = x + 12 + k * 15;
    thickLine(wx, y + 8, wx + 4, y + 4, 2, c);
    thickLine(wx + 4, y + 4, wx, y, 2, c);
  }
}

void drawPlug(int x, int y, uint16_t c, uint16_t bg) {  // 48 x 52, any appliance
  gfx->fillRoundRect(x + 8, y + 10, 32, 26, 8, c);
  gfx->fillRect(x + 15, y, 5, 12, c);
  gfx->fillRect(x + 28, y, 5, 12, c);
  gfx->fillRect(x + 21, y + 36, 6, 16, c);
  drawBolt(x + 24, y + 23, 8, bg);
}

void drawTaskIcon(const char *task, int x, int y, uint16_t c, uint16_t bg) {
  if (!strcmp(task, "ev")) drawCar(x - 6, y + 4, c, bg);
  else if (!strcmp(task, "dishwasher")) drawDishwasher(x, y, c, bg);
  else if (!strcmp(task, "heating")) drawRadiator(x - 4, y, c, bg);
  else drawPlug(x, y, c, bg);
}

// ---------- shared chrome ----------
void drawHeader(const char *title) {
  drawLogo(28, 34, 16);
  text(&FreeSansBold12pt7b, 1, INK, 54, 44, title);
  textR(&FreeSansBold12pt7b, 1, QUIET, 344, 44, updated);
}

void drawPaddle(int idx, int cy, bool next) {
  bool lit = millis() < flashUntil[idx];
  uint16_t c = lit ? BRAND : DIM;
  gfx->fillRoundRect(LCD_WIDTH - 7, cy - PADDLE_H / 2, 5, PADDLE_H, 2, c);
  int x = LCD_WIDTH - 17;  // a chevron pointing on (right) or back (left)
  if (next) gfx->fillTriangle(x - 3, cy - 6, x - 3, cy + 6, x + 4, cy, c);
  else gfx->fillTriangle(x + 4, cy - 6, x + 4, cy + 6, x - 3, cy, c);
}

void drawFooter() {
  drawPaddle(1, PADDLE_BOOT_Y, true);
  if (haveExpander) drawPaddle(0, PADDLE_PWR_Y, false);
  for (int i = 0; i < SCREENS; i++) {
    int x = 184 + (i - 1) * 22;
    if (i == screen) gfx->fillRoundRect(x - 9, 431, 18, 7, 3, INK); else gfx->fillCircle(x, 434, 3, DIM);
  }
  text(&FreeSans12pt7b, 1, DIM, 14, 441, "tap or press");
}

// ---------- screen 1: now ----------
const int GX = 184, GY = 206, GR1 = 118, GR2 = 100;
const float G0 = 135, GSPAN = 270;

float gaugeAngle(float p, float lo, float hi) {
  float t = hi > lo ? (p - lo) / (hi - lo) : 0.5f;
  return G0 + GSPAN * constrain(t, 0.0f, 1.0f);
}

void drawGauge(float p) {
  float lo = minP(), hi = maxP(), a = avgP();
  float cheap = constrain(a * CHEAP_BELOW, lo, hi), pricey = constrain(a * PRICEY_ABOVE, lo, hi);
  float aCheap = gaugeAngle(cheap, lo, hi), aPricey = gaugeAngle(pricey, lo, hi);
  arc(GX, GY, GR1, GR2, G0, aCheap - 1.5f, GOOD);
  arc(GX, GY, GR1, GR2, aCheap + 1.5f, aPricey - 1.5f, MID);
  arc(GX, GY, GR1, GR2, aPricey + 1.5f, G0 + GSPAN, BAD);
  int kx, ky;
  polar(GX, GY, (GR1 + GR2) / 2.0f, gaugeAngle(p, lo, hi), kx, ky);
  gfx->fillCircle(kx, ky, 15, BG);
  gfx->fillCircle(kx, ky, 12, INK);
  gfx->fillCircle(kx, ky, 6, colourOf(bandOf(p)));
  char buf[16];
  int lx, ly;
  polar(GX, GY, GR1, G0, lx, ly);
  snprintf(buf, sizeof buf, "%.0fp", lo);
  textR(&FreeSans12pt7b, 1, QUIET, lx - 6, ly + 4, buf);
  polar(GX, GY, GR1, G0 + GSPAN, lx, ly);
  snprintf(buf, sizeof buf, "%.0fp", hi);
  text(&FreeSans12pt7b, 1, QUIET, lx + 6, ly + 4, buf);
}

void drawVerdict(Band b, int y) {
  const char *word = b == B_PAID ? "PAID TO USE" : b == B_CHEAP ? "CHEAP NOW" : b == B_PRICEY ? "PRICEY NOW" : "NORMAL";
  uint16_t c = colourOf(b);
  int w = textWidth(&FreeSansBold12pt7b, 1, word) + 74;
  int x = 184 - w / 2;
  gfx->fillRoundRect(x, y, w, 46, 23, c);
  int ix = x + 28, iy = y + 23;
  if (b == B_CHEAP) drawCheck(ix, iy, 9, BG);
  else if (b == B_PRICEY) drawClock(ix, iy, 11, BG, c);
  else if (b == B_PAID) drawBolt(ix, iy, 12, BG);
  else drawEqual(ix, iy, 9, BG);
  text(&FreeSansBold12pt7b, 1, BG, x + 52, y + 31, word);
}

void drawNowScreen() {
  drawHeader("Price now");
  const Slot &now = slots[0];
  Band b = bandOf(now.p);
  drawGauge(now.p);
  char buf[48];
  snprintf(buf, sizeof buf, fabsf(now.p) < 10 ? "%.1f" : "%.0f", now.p);
  int w = textWidth(&FreeSansBold24pt7b, 2, buf);
  text(&FreeSansBold24pt7b, 2, INK, GX - (w + 26) / 2, GY + 22, buf);
  text(&FreeSansBold18pt7b, 1, INK, GX - (w + 26) / 2 + w + 4, GY + 22, "p");
  textC(&FreeSans9pt7b, 1, QUIET, GX, GY + 50, "per kWh");
  drawVerdict(b, 316);
  const char *advice = b == B_PAID ? "Plug everything in" : b == B_CHEAP ? "Good time to use power" : b == B_PRICEY ? "Wait if you can" : "About average";
  textC(&FreeSansBold12pt7b, 1, INK, 184, 388, advice);
  snprintf(buf, sizeof buf, "Edinburgh  -  average today %.0fp", avgP());
  textC(&FreeSans12pt7b, 1, QUIET, 184, 414, buf);
}

// ---------- screen 2: next 24 hours ----------
const int RING_X = 184, RING_Y = 232, RING_R1 = 150, RING_R2 = 116;

float clockAngle(int minute) { return 270.0f + minute * 360.0f / 1440.0f; }  // 00:00 at the top, clockwise

int bestSlot() { int b = 0; for (int i = 1; i < nSlots; i++) if (slots[i].p < slots[b].p) b = i; return b; }

void drawRingScreen() {
  drawHeader("Next 24 hours");
  for (int i = 0; i < nSlots; i++) {
    float a0 = clockAngle(slots[i].minute), a1 = a0 + 7.5f;
    arc(RING_X, RING_Y, RING_R1, RING_R2, a0 + 0.7f, a1 - 0.7f, colourOf(bandOf(slots[i].p)));
  }
  if (nWins > 0) {  // cheapest window: a bright bracket outside the ring
    float a0 = clockAngle(minutesOf(wins[0].from)), a1 = clockAngle(minutesOf(wins[0].to));
    if (a1 <= a0) a1 += 360;
    arc(RING_X, RING_Y, RING_R1 + 12, RING_R1 + 6, a0, a1, INK);
  }
  int tx, ty, tx2, ty2;  // now: a white needle across the ring
  float an = clockAngle(nowMinute);
  polar(RING_X, RING_Y, RING_R2 - 10, an, tx, ty);
  polar(RING_X, RING_Y, RING_R1 + 4, an, tx2, ty2);
  thickLine(tx, ty, tx2, ty2, 5, INK);
  const char *hours[] = {"00", "06", "12", "18"};
  for (int k = 0; k < 4; k++) {
    int hx, hy;
    polar(RING_X, RING_Y, RING_R2 - 22, 270 + 90 * k, hx, hy);
    textC(&FreeSans12pt7b, 1, QUIET, hx, hy + 8, hours[k]);
  }
  char buf[40];
  textC(&FreeSans12pt7b, 1, QUIET, RING_X, RING_Y - 42, "Cheapest");
  const char *from = nWins ? wins[0].from : slots[bestSlot()].hhmm;
  textC(&FreeSansBold24pt7b, 1, GOOD, RING_X, RING_Y + 6, from);
  int wait = (minutesOf(from) - nowMinute + 1440) % 1440;
  if (wait < 30) snprintf(buf, sizeof buf, "now"); else snprintf(buf, sizeof buf, "in %dh %02dm", wait / 60, wait % 60);
  textC(&FreeSansBold12pt7b, 1, INK, RING_X, RING_Y + 38, buf);
  if (nWins) { snprintf(buf, sizeof buf, "until %s", wins[0].to); textC(&FreeSans12pt7b, 1, QUIET, RING_X, RING_Y + 66, buf); }
  // legend
  struct { uint16_t c; const char *s; } legend[] = {{GOOD, "cheap"}, {MID, "normal"}, {BAD, "pricey"}};
  for (int k = 0; k < 3; k++) {
    int lx = 34 + k * 108;
    gfx->fillRoundRect(lx, 400, 16, 16, 4, legend[k].c);
    text(&FreeSans12pt7b, 1, QUIET, lx + 22, 415, legend[k].s);
  }
}

// ---------- screen 3: save ----------
Plan heatingPlan() {
  Plan plan = {false, -1, 1e9, 0};
  int late = -1;
  for (int i = 0; i + HEAT_SLOTS <= nSlots; i++) {
    int last = slots[i + HEAT_SLOTS - 1].minute;  // the window must end by 07:00 tonight
    if (last >= READY_BY * 60 && last < 18 * 60) break;
    float sum = 0;
    for (int k = 0; k < HEAT_SLOTS; k++) sum += slots[i + k].p;
    if (sum < plan.cost_p) { plan.cost_p = sum; plan.start = i; }
    if (slots[i + HEAT_SLOTS - 1].minute / 60 == READY_BY - 1 && slots[i + HEAT_SLOTS - 1].minute % 60 == 30) late = i;
  }
  if (plan.start < 0) return plan;
  float kwh = HEAT_KW * HEAT_SLOTS / 2.0f;
  plan.cost_p = plan.cost_p / HEAT_SLOTS * kwh;
  if (late >= 0) {
    float s = 0;
    for (int k = 0; k < HEAT_SLOTS; k++) s += slots[late + k].p;
    plan.late_p = s / HEAT_SLOTS * kwh;
  }
  plan.ok = true;
  return plan;
}

void drawTaskCard(int y, const char *task, const char *label, const char *when, float saving_p) {
  gfx->fillRoundRect(10, y, 328, 96, 16, CARD);  // stops short of the button paddles
  gfx->fillRoundRect(20, y + 14, 68, 68, 14, rgb(28, 60, 40));
  drawTaskIcon(task, 30, y + 22, GOOD, rgb(28, 60, 40));
  text(&FreeSansBold12pt7b, 1, INK, 100, y + 36, label);
  text(&FreeSans12pt7b, 1, QUIET, 100, y + 66, when);
  char buf[16];
  snprintf(buf, sizeof buf, saving_p >= 0.5f ? "save %.0fp" : "no saving", saving_p);
  textR(&FreeSansBold12pt7b, 1, GOOD, 328, y + 66, buf);
}

void drawSaveScreen() {
  drawHeader("Run it later");
  char when[24];
  int y = 70;
  for (int i = 0; i < nWins && i < 2; i++, y += 108) {
    snprintf(when, sizeof when, "%s-%s", wins[i].from, wins[i].to);
    drawTaskCard(y, wins[i].task, wins[i].label, when, wins[i].saving_p);
  }
  Plan heat = heatingPlan();
  if (heat.ok) {
    snprintf(when, sizeof when, "%s-%s", slots[heat.start].hhmm, slots[min(heat.start + HEAT_SLOTS, nSlots - 1)].hhmm);
    drawTaskCard(y, "heating", "Pre-heat the house", when, heat.late_p > 0 ? heat.late_p - heat.cost_p : 0);
    y += 108;
  }
  textC(&FreeSans12pt7b, 1, QUIET, 184, min(y + 16, 414), "vs running it at the usual time");
}

// ---------- fetch ----------
bool fetch() {
  if (WiFi.status() != WL_CONNECTED) { snprintf(status, sizeof status, "Wi-Fi: not connected"); return false; }
  WiFiClientSecure client;
  client.setInsecure();  // demo device: no certificate pinning
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, URL)) { snprintf(status, sizeof status, "Cannot reach the server"); return false; }
  int code = http.GET();
  if (code != 200) {
    snprintf(status, sizeof status, code > 0 ? "No internet (sign-in page?) %d" : "No internet (%d)", code);
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) { snprintf(status, sizeof status, "No internet (sign-in page?)"); return false; }

  int n = 0;
  for (JsonObject s : doc["prices"].as<JsonArray>()) {
    if (n >= 96 || s["p_kwh"].isNull()) continue;
    Slot &d = slots[n++];
    copyHHMM(d.hhmm, s["ts"] | "0000-00-00T00:00:00Z");
    d.minute = minutesOf(d.hhmm);
    d.p = s["p_kwh"].as<float>();
    d.forecast = strcmp(s["kind"] | "actual", "forecast") == 0;
  }
  if (n == 0) { snprintf(status, sizeof status, "No prices yet"); return false; }
  nSlots = n;
  nWins = 0;
  for (JsonObject w : doc["windows"].as<JsonArray>()) {
    if (nWins >= 3) break;
    Window &d = wins[nWins++];
    strlcpy(d.task, w["task"] | "", sizeof d.task);
    strlcpy(d.label, w["label"] | "", sizeof d.label);
    copyHHMM(d.from, w["start"] | "0000-00-00T00:00:00Z");
    copyHHMM(d.to, w["end"] | "0000-00-00T00:00:00Z");
    d.saving_p = 100.0f * (w["saving_gbp"]["p50"] | 0.0f);
  }
  copyHHMM(updated, doc["generated_at"] | "0000-00-00T00:00:00Z");
  nowMinute = minutesOf(updated);
  snprintf(status, sizeof status, "Updated %s", updated);
  return true;
}

// ---------- drawing ----------
void draw() {
  gfx->fillScreen(BG);
  if (!haveData) {
    drawLogo(184, 180, 44);
    textC(&FreeSansBold18pt7b, 1, INK, 184, 270, "Living Grid");
    textC(&FreeSans9pt7b, 1, QUIET, 184, 304, status);
  } else {
    if (screen == 0) drawNowScreen();
    else if (screen == 1) drawRingScreen();
    else drawSaveScreen();
    drawFooter();
  }
  gfx->flush();
}

void showScreen(int s) {
  screen = (s % SCREENS + SCREENS) % SCREENS;
  shownAt = millis();
  draw();
}

void dumpFrame() {  // raw RGB565, little-endian, row-major, after a one-line header
  USBSerial.setTxTimeoutMs(2000);  // block while the host reads, or bytes are dropped
  USBSerial.printf("LGIMG %d %d\n", LCD_WIDTH, LCD_HEIGHT);
  const uint8_t *fb = (const uint8_t *)gfx->getFramebuffer();
  size_t total = (size_t)LCD_WIDTH * LCD_HEIGHT * 2;
  for (size_t off = 0; off < total; off += 1024) USBSerial.write(fb + off, min((size_t)1024, total - off));
  USBSerial.flush();
  USBSerial.setTxTimeoutMs(0);
}

// ---------- input ----------
void initTouch() {
  Wire.begin(IIC_SDA, IIC_SCL);
  if (!expander.begin(0x20)) { USBSerial.println("No IO expander: touch and PWR off"); return; }
  haveExpander = true;
  expander.pinMode(PWR_EXIO, INPUT);
  for (int p = 0; p < 3; p++) { expander.pinMode(p, OUTPUT); expander.digitalWrite(p, LOW); }
  delay(20);
  for (int p = 0; p < 3; p++) expander.digitalWrite(p, HIGH);
  delay(50);
  for (int tries = 0; tries < 3 && !haveTouch; tries++) { haveTouch = touch->begin(); if (!haveTouch) delay(300); }
  USBSerial.println(haveTouch ? "Touch ready" : "Touch not found: BOOT button only");
}

bool tapped() {
  static bool wasDown = false;
  static uint32_t lastRead = 0;
  if (!haveTouch || millis() - lastRead < 30) return false;
  lastRead = millis();
  bool down = touch->IIC_Read_Device_Value(touch->Arduino_IIC_Touch::Value_Information::TOUCH_FINGER_NUMBER) > 0;
  bool tap = down && !wasDown;
  wasDown = down;
  return tap;
}

bool bootPressed() {
  static bool wasDown = false;
  bool down = digitalRead(BOOT_BUTTON) == LOW;
  bool press = down && !wasDown;
  wasDown = down;
  return press;
}

bool pwrPressed() {
  static bool wasDown = false;
  static uint32_t lastRead = 0;
  if (!haveExpander || millis() - lastRead < 25) return false;
  lastRead = millis();
  bool down = expander.digitalRead(PWR_EXIO);
  bool press = down && !wasDown;
  wasDown = down;
  return press;
}

void handleSerial() {
  while (USBSerial.available()) {
    int c = USBSerial.read();
    if (c >= '1' && c <= '0' + SCREENS) { lastInput = millis(); showScreen(c - '1'); }
    else if (c == 'S') dumpFrame();
  }
}

// ---------- Wi-Fi ----------
void connectWifi() {
  snprintf(status, sizeof status, "Joining %s", WIFI_SSID);
  draw();
  WiFi.mode(WIFI_STA);
  if (strlen(WIFI_PASS)) WiFi.begin(WIFI_SSID, WIFI_PASS); else WiFi.begin(WIFI_SSID);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  snprintf(status, sizeof status, WiFi.status() == WL_CONNECTED ? "Wi-Fi joined, loading" : "Wi-Fi: cannot join %s", WIFI_SSID);
  USBSerial.println(status);
  if (WiFi.status() != WL_CONNECTED) {  // list what the 2.4 GHz radio can see, to tell a missing network from a bad password
    WiFi.disconnect();  // a scan fails (-2) while a connection attempt is still running
    delay(200);
    int n = WiFi.scanNetworks();
    USBSerial.printf("Visible 2.4 GHz networks: %d\n", n);
    for (int i = 0; i < n; i++) USBSerial.printf("  %s  %d dBm  %s\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured");
  }
}

// ---------- main ----------
void setup() {
  USBSerial.begin(115200);
  USBSerial.setTxTimeoutMs(0);  // never block on a closed serial port
  setenv("TZ", UK_TZ, 1);
  tzset();
  pinMode(BOOT_BUTTON, INPUT_PULLUP);
  initTouch();
  if (!gfx->begin()) USBSerial.println("gfx->begin() failed (framebuffer?)");
  panel->setBrightness(200);
  connectWifi();
  haveData = fetch();
  lastFetch = millis();
  showScreen(0);
}

void loop() {
  handleSerial();
  static bool flashing = false;
  if (pwrPressed()) { USBSerial.println("PRESS PWR"); lastInput = millis(); flashUntil[0] = millis() + FLASH_MS; flashing = true; showScreen(screen - 1); }
  if (bootPressed()) { USBSerial.println("PRESS BOOT"); lastInput = millis(); flashUntil[1] = millis() + FLASH_MS; flashing = true; showScreen(screen + 1); }
  if (tapped()) { lastInput = millis(); showScreen(screen + 1); }
  if (flashing && millis() > max(flashUntil[0], flashUntil[1])) { flashing = false; draw(); }  // paddle back to dim
  if (haveData && millis() - lastInput > IDLE_MS && millis() - shownAt > AUTO_NEXT_MS) showScreen(screen + 1);
  if (millis() - lastFetch > REFRESH_MS) {
    if (WiFi.status() != WL_CONNECTED) connectWifi();
    bool ok = fetch();
    haveData = haveData || ok;
    lastFetch = millis();
    draw();
    USBSerial.println(status);
  }
  delay(10);
}
