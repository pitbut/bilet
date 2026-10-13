#include "Sensors.h"
#include <Wire.h>
#include <VL53L0X.h>
#include "Config.h"

// VL53L0X, not VL53L1X — different chip, different register map/library.
// The VL53L0X Arduino library has no per-reading status enum like VL53L1X's
// ranging_data.range_status; a "no target in range" reading just comes back
// as a very large millimeter value (the sensor's own out-of-range sentinel,
// ~8190mm) instead of a real distance — treated as "no signal" the same way.
static VL53L0X sVL53;

bool RangeFinder::begin() {
	Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
	Wire.setClock(400000);

#if PIN_RANGEFINDER_XSHUT >= 0
	pinMode(PIN_RANGEFINDER_XSHUT, OUTPUT);
	digitalWrite(PIN_RANGEFINDER_XSHUT, HIGH); // release shutdown, sensor boots
	delay(2);
#endif

	sVL53.setBus(&Wire);
	sVL53.setTimeout(500);
	present_ = sVL53.init();
	if (!present_) {
		// Genuinely not there (wrong wiring, dead sensor, bad address) — say so,
		// don't pretend it initialized.
		return false;
	}
	sVL53.setMeasurementTimingBudget(33000);
	sVL53.startContinuous(33);
	return true;
}

Reading RangeFinder::readDistanceMm() {
	if (!present_) return {false, 0.0f};

	uint16_t mm = sVL53.readRangeContinuousMillimeters();
	if (sVL53.timeoutOccurred()) {
		// The sensor stopped answering on the bus — report "no signal", and let
		// the caller decide whether to abort the motion that depends on it.
		present_ = false;
		return {false, 0.0f};
	}
	if (mm >= 8190) {
		// The sensor's own "nothing came back" sentinel — still "no signal",
		// not a real 8-meter distance.
		return {false, 0.0f};
	}
	return {true, (float)mm};
}

// ---- Quadrature encoder on the presser-foot rack ----

volatile int32_t RackEncoder::count_ = 0;
volatile int8_t  RackEncoder::lastEncoded_ = 0;

void RackEncoder::begin() {
	// INPUT_PULLUP, not plain INPUT: holds each line at a known level between
	// real transitions instead of leaving it floating — these are regular
	// GPIOs (see Config.h), so the internal pull-up actually works here,
	// unlike the old 34/35 pins.
	pinMode(PIN_ENCODER_A, INPUT_PULLUP);
	pinMode(PIN_ENCODER_B, INPUT_PULLUP);
	attachInterrupt(digitalPinToInterrupt(PIN_ENCODER_A), onPinAChange, CHANGE);
	attachInterrupt(digitalPinToInterrupt(PIN_ENCODER_B), onPinAChange, CHANGE);
}

void RackEncoder::zero() {
	noInterrupts();
	count_ = 0;
	interrupts();
}

int32_t RackEncoder::counts() const {
	// Reading a 32-bit value written by an ISR: safe enough on a single-core
	// read without a lock on this platform width, but keep it explicit.
	noInterrupts();
	int32_t c = count_;
	interrupts();
	return c;
}

float RackEncoder::millimeters(float countsPerMm) const {
	if (countsPerMm <= 0.0f) return 0.0f;
	return counts() / countsPerMm;
}

void IRAM_ATTR RackEncoder::onPinAChange() {
	uint8_t a = digitalRead(PIN_ENCODER_A);
	uint8_t b = digitalRead(PIN_ENCODER_B);
	uint8_t state = (a << 1) | b;
	uint8_t combined = (lastEncoded_ << 2) | state;

	// Standard quadrature transition table.
	switch (combined) {
		case 0b0001: case 0b0111: case 0b1110: case 0b1000:
			count_++; break;
		case 0b0010: case 0b1011: case 0b1101: case 0b0100:
			count_--; break;
		default:
			break; // bounce / illegal transition — ignore rather than guess
	}
	lastEncoded_ = state;
}
