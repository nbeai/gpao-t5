---
name: openhue
description: Control Philips Hue only through an available, already authorized local CLI or API route. Use to inspect lights, scenes, and rooms, or to apply a clearly requested lighting change with post-action observation.
---

# Philips Hue

## When to use

Use for a request to inspect or control Philips Hue lights, rooms, or scenes.

## Prerequisites

Verify an already configured local Hue route and the intended bridge or account. Do not request, display, or store bridge credentials in terminal input.

## Procedure

1. Discover available rooms, lights, or scenes and resolve the user's wording to one target.
2. Read the current state before a state-changing request.
3. Apply only the requested brightness, color, power, or scene action.
4. Query the resulting state again and compare it to the requested result.

## Verification

Report only the state observed through the available Hue route after the action.

## Failure and stop conditions

Stop when the route, bridge, or named target is unavailable or ambiguous. Do not broaden a room-level request to all lights, and do not treat a command acknowledgement as proof that a physical light changed.
