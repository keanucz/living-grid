#pragma once
// Types used by the sketch. They live in a header because the Arduino builder writes function prototypes above the
// first function in the .ino, which would otherwise come before these definitions.
#include <stdint.h>

struct Slot { char hhmm[6]; int minute; float p; bool forecast; };
struct Window { char task[16]; char label[32]; char from[6]; char to[6]; float saving_p; };
struct Plan { bool ok; int start; float cost_p; float late_p; };
enum Band { B_PAID, B_CHEAP, B_NORMAL, B_PRICEY };
