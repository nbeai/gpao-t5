# T5 native file broker

This is a single-request macOS arm64 helper. It receives already-open directory
capabilities at file descriptors 3 (allowed root) and 4 (private state), accepts
one length-prefixed binary request on stdin, emits one length-prefixed JSON
response on stdout, and exits. It never accepts absolute host paths and never
invokes a shell.

The runtime does not compile this source. Development tests compile it into a
temporary directory; the macOS package build must compile and sign the helper
before shipping it.

Protocol version 1 request body starts with `T5FB`, byte version, byte opcode,
and two zero bytes. `PUT` then carries BE32 relative-path length, path bytes,
BE64 data length, and data bytes. `UNDO_REF` carries BE32 ref length and ref
bytes. `RECOVER` and `SELF_TEST` have no fields. Every request and response is
preceded by a BE32 body length. Responses are UTF-8 JSON bodies beginning with
`T5FR`, version byte, status byte, and two zero bytes.
