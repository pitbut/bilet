#pragma once
#include <Arduino.h>

// All calibration values the phone app's "Настройки" screen can read and write.
// Persisted in NVS so they survive a reboot/power loss.
struct Settings {
	// Distance (mm) the rangefinder must read, measured from the scope objective
	// to the fabric surface, before we call the scope "in position" and stop lowering.
	float focusTargetDistanceMm = 8.0f;
	float focusToleranceMm = 0.3f;

	// Fallback timings, used only when a feedback sensor is missing/unresponsive.
	uint32_t scopeLowerTimeoutMs = 6000;
	uint32_t scopeRaiseDurationMs = 2500;   // no up-position feedback other than the optional limit switch

	// Ultrasound (electromagnet) driver
	uint32_t ultrasoundFrequencyHz = 40000;
	uint32_t ultrasoundDurationMs = 3000;

	// Presser-foot servo: how long (ms) a single manual test tap spins the
	// continuous-rotation servo for (Test screen only — the automatic cycle
	// below is closed-loop on the encoder, not time-based).
	uint32_t servoStepDurationMs = 150;
	uint8_t  servoMaxSteps = 10;

	// Encoder scale, mm per count — recalibrate whenever the rack/gear is changed.
	float encoderCountsPerMm = 800.0f;

	// How far (mm of rack travel, via the encoder) one pressure "step" moves
	// the lead screw. The automatic cycle targets step * pressureStepMm *
	// encoderCountsPerMm counts from wherever the encoder was last zeroed —
	// calibrate by watching live encoder counts (Test screen) while turning
	// the lead screw a known distance by hand.
	float pressureStepMm = 0.1f;

	// Which way the servo must turn to drive the rack towards the pressure
	// zero limit switch (PIN_LIMIT_PRESSURE_ZERO) — depends on how the gear
	// train was assembled, so it's not something the firmware can assume.
	// Set from the app: if homing times out without reaching the switch,
	// flip this and try again.
	bool pressureHomeClockwise = true;

	// Sign of the external rack encoder. Convention: counts go UP moving
	// away from the zero switch (more pressure). If A/B are swapped or the
	// encoder is mounted mirrored it counts the other way, which used to
	// make "Переместить" spin away from the target until timeout. Homing
	// detects that and flips this automatically; it can also be set by hand.
	bool encoderReversed = false;

	// Fine trim (microseconds) added to the 1500us "stop" pulse. On a servo
	// converted to continuous rotation by physically removing its position
	// pot, the pulse width that actually produces zero speed is almost never
	// exactly 1500us — it depends on the specific unit and how the fixed
	// resistors ended up biased. If the servo creeps slowly while "stopped",
	// nudge this a few microseconds at a time (either sign) until it holds
	// still, using /api/test/servo/center to re-apply it live.
	int16_t servoStopTrimUs = 0;

	// Presser-foot spring model: force (kgf) at rack position x (mm from the
	// pressure-zero limit switch) = preloadKgf + springStiffnessKgfMm * x.
	// Calibrate by hanging/pressing known weights on the foot at a couple of
	// known rack positions and solving for slope/intercept. The phone uses
	// this to convert a desired presser-foot force into a target mm for
	// /api/test/servo/move (or the automatic cycle) — the ESP32 itself never
	// reasons in force units, only position.
	float springStiffnessKgfMm = 0.5f;
	float preloadKgf = 0.3f;

	void load();
	void save() const;
	void toJson(String &out) const;
	// Returns false (and leaves fields untouched) if the payload is missing/malformed.
	bool fromJson(const String &json);
};

extern Settings gSettings;
