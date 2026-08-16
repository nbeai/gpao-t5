#ifndef T5_FILE_BROKER_PROTOCOL_H
#define T5_FILE_BROKER_PROTOCOL_H

#include <stdint.h>

#define T5FB_PROTOCOL_VERSION 1u
#define T5FB_MAGIC "T5FB"
#define T5FB_RESPONSE_MAGIC "T5FR"
#define T5FB_MAX_FRAME (64u * 1024u * 1024u + 8192u)
#define T5FB_MAX_PATH 4096u
#define T5FB_MAX_REF 35u

enum t5fb_opcode {
  T5FB_PUT = 1,
  T5FB_UNDO_REF = 2,
  T5FB_RECOVER = 3,
  T5FB_SELF_TEST = 4,
};

#endif
