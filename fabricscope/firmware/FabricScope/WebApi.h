#pragma once
#include "Sensors.h"
#include "Actuators.h"

// Starts the HTTP JSON API + WebSocket telemetry stream the phone app talks to.
// See README.md in this project for the full endpoint contract.
void beginWebApi(RangeFinder *range, RackEncoder *encoder, PressureServo *servo,
                  ScopeLift *lift, UltrasoundDriver *ultrasound);

// Call periodically (e.g. every 150ms) from loop() to push live telemetry to
// any connected WebSocket clients.
void broadcastTelemetry();
