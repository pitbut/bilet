#pragma once
#include <Arduino.h>
#include "Sensors.h" // for Reading, RackEncoder

enum class MotorDir : uint8_t { Stop, Down, Up };

enum class ServoDriveMode : uint8_t { Idle, Timed, EncoderTarget, Homing };

// True continuous-rotation servo (the position-feedback potentiometer was
// physically removed from the DS3240MG — without it, the servo has no idea
// what angle it's at, so it just spins at a speed proportional to how far
// the pulse is from 1500us, same as any continuous-rotation hobby servo).
// There is no angle feedback from the servo itself, so closing the loop on
// actual presser-foot pressure is entirely the job of the independent
// quadrature encoder on the rack (RackEncoder) — not this class.
// Real power to the servo is switched by an N-MOS module (PIN_SERVO_POWER
// in Config.h), cut whenever nothing is actively driving it.
//
// Every move is non-blocking: a start*() call sets things in motion and
// returns immediately; update() (called every loop() iteration) carries it
// forward and stops it when done/limit-hit/timed-out. This matters because
// ESPAsyncWebServer runs request handlers on its own single task — a
// handler that blocks with delay() ties up that task completely, so no
// *other* request (like /api/stop) can be processed until it returns. A
// blocking rotate() used to make the Test screen's Stop button unusable
// during a long manual spin for exactly this reason.
class PressureServo {
public:
	void begin();

	// Manual Test-screen tap: spins at full speed until maxDurationMs
	// elapses, a pressure limit switch (in the direction of travel) trips,
	// or stop() is called.
	void startTimed(bool clockwise, uint32_t maxDurationMs);

	// Closed-loop move: spins towards targetCounts on the given encoder,
	// until reached, a relevant limit switch trips, or timeoutMs elapses
	// (encoder not moving / rack stuck).
	void startMoveToEncoderTarget(RackEncoder *encoder, int32_t targetCounts, uint32_t timeoutMs);

	// Spins toward the pressure-zero limit switch until it trips (zeroing
	// the encoder right there — the real "pressure step 0" reference), the
	// *other* (max) switch trips (wrong direction — pressureHomeClockwise
	// is probably backwards), or timeoutMs elapses. Check lastHomeReached()
	// once isBusy() goes false.
	void startHoming(RackEncoder *encoder, bool clockwise, uint32_t timeoutMs);

	// Call every loop() iteration — advances whatever is currently running
	// and stops it when its condition is met. No-op when idle.
	void update();

	// Aborts whatever is running, immediately, and cuts power. Safe to call
	// any time, including when already idle.
	void stop();

	bool isBusy() const { return mode_ != ServoDriveMode::Idle; }
	bool lastHomeReached() const { return lastHomeReached_; }

	// Live, direct GPIO reads of the two physical limit switches — not
	// inferred from mode/history. Exposed so /api/status can show the
	// actual switch state instead of everyone guessing why a move stopped
	// (e.g. "barely moved and stood" is instant and obvious once you can
	// see the zero switch reads tripped right now).
	bool zeroSwitchTripped() const;
	bool maxSwitchTripped() const;

private:
	ServoDriveMode mode_ = ServoDriveMode::Idle;
	bool clockwise_ = true;
	uint32_t startMs_ = 0;
	uint32_t timeoutMs_ = 0;
	int32_t targetCounts_ = 0;
	RackEncoder *encoder_ = nullptr;
	bool lastHomeReached_ = false;

	void driveAt(bool clockwise);
};

// DC motor + 2-pin driver that raises/lowers the microscope head.
class ScopeLift {
public:
	void begin();
	void drive(MotorDir dir);
	void stop();
	bool isAtTopLimit() const; // reads the physical limit switch, if wired
	// What drive() was last told to do — lets loop() enforce the limit
	// switch as a continuous safety net (see main.cpp), not just inside the
	// automatic raise sequence. A manual Test-screen command never checked
	// this switch at all before; that's the gap being closed.
	MotorDir currentDirection() const { return dir_; }

private:
	MotorDir dir_ = MotorDir::Stop;
};

// MOSFET-gated electromagnet / LC tank, driven as an ultrasound source.
class UltrasoundDriver {
public:
	void begin();
	void start(uint32_t frequencyHz);
	void stop();
	bool isRunning() const { return running_; }
	// Raw ADC counts from the current-sense shunt — used by the app/host to
	// hand-tune frequency against tank current, not interpreted on-device.
	Reading readCurrentSense() const;

private:
	bool running_ = false;
};
