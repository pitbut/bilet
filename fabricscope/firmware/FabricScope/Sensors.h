#pragma once
#include <Arduino.h>

// A reading that's either genuinely there or genuinely not — never a
// placeholder number standing in for "sensor not connected".
struct Reading {
	bool  valid;
	float value;
};

class RangeFinder {
public:
	// Returns false if the VL53L1X never acknowledges on I2C — caller must
	// treat the sensor as absent, not retry-forever with fabricated zeros.
	bool begin();
	// Non-blocking: returns {valid:false} if no fresh sample is ready yet or
	// the sensor stopped responding (I2C timeout / not initialized).
	Reading readDistanceMm();
	bool isPresent() const { return present_; }

private:
	bool present_ = false;
};

class RackEncoder {
public:
	void begin();
	void zero();                  // tare at current rack position
	int32_t counts() const;
	float millimeters(float countsPerMm) const;

	// ISR — must be a free function/static, wired up in begin()
	static void IRAM_ATTR onPinAChange();

private:
	static volatile int32_t count_;
	static volatile int8_t  lastEncoded_;
};
