#pragma once
#include <Arduino.h>
#include "Sensors.h" // for Reading, RackEncoder

enum class MotorDir : uint8_t { Stop, Down, Up };

enum class ServoDriveMode : uint8_t { Idle, Timed, EncoderTarget, Homing };

// Why the last servo move ended — reported in /api/status (servo.lastStop)
// so "it stopped and I don't know why" is answered by the device itself.
enum class ServoStopReason : uint8_t {
	None,           // nothing has run yet
	Target,         // encoder reached the requested target
	AlreadyThere,   // move requested to where the rack already is
	LimitZero,      // zero limit switch tripped while travelling towards it
	LimitMax,       // max limit switch tripped while travelling towards it
	Stall,          // driving, but the encoder stopped counting
	WrongDirection, // encoder counted AWAY from the target — flip encoderReversed
	Timeout,        // overall backstop elapsed
	Stopped,        // /api/stop, /api/test/servo/center, or an aborted cycle
	HomeReached,    // homing found the zero switch (encoder zeroed there)
	HomeWrongSwitch // homing hit the MAX switch — pressureHomeClockwise is backwards
};
const char *servoStopReasonName(ServoStopReason r);

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
// Every move is non-blocking: a start*() call only queues the command and
// returns immediately; update() (called every loop() iteration, on the
// Arduino loop task) actually starts it, carries it forward and stops it
// when done/limit-hit/stalled/timed-out. Queuing matters because
// ESPAsyncWebServer runs request handlers on a DIFFERENT task: before,
// a handler started the move itself (including the power-up delay) while
// loop() was concurrently running update() on the same object — the two
// tasks raced over mode/direction/target. Now only the loop task ever
// touches the drive state; handlers just post requests. stop() is the one
// exception — it may be called from any task and cuts power immediately.
//
// Direction convention (closed-loop moves): encoder counts INCREASE moving
// away from the zero limit switch (positive mm = more pressure). The servo
// direction for that is therefore !pressureHomeClockwise — not "clockwise
// == counts go up", which only held by luck of wiring. If the external
// encoder counts the other way, set Settings::encoderReversed (homing
// detects and fixes this automatically, see startHoming()).
class PressureServo {
public:
	void begin();

	// Manual Test-screen tap: spins at full speed until maxDurationMs
	// elapses, a pressure limit switch (in the direction of travel) trips,
	// or stop() is called.
	void startTimed(bool clockwise, uint32_t maxDurationMs);

	// Closed-loop move to an absolute encoder position (0 = zero switch):
	// stops when reached, at a limit switch in the direction of travel, on
	// encoder stall, on encoder counting the wrong way, or after timeoutMs.
	// Slows down near the target to avoid overshooting it.
	void startMoveToEncoderTarget(RackEncoder *encoder, int32_t targetCounts, uint32_t timeoutMs);

	// Spins toward the pressure-zero limit switch until it trips (zeroing
	// the encoder right there — the real "pressure step 0" reference), the
	// *other* (max) switch trips (wrong direction — pressureHomeClockwise
	// is probably backwards), or timeoutMs elapses. Check lastHomeReached()
	// once isBusy() goes false. If the encoder counted UP on the way to the
	// zero switch, its direction is backwards: encoderReversed is flipped
	// and saved automatically (see encoderDirectionFlipped()).
	void startHoming(RackEncoder *encoder, bool clockwise, uint32_t timeoutMs);

	// Call every loop() iteration (loop task only) — starts a queued
	// command, advances whatever is running and stops it when its
	// condition is met.
	void update();

	// Aborts whatever is running or queued, immediately, and cuts power.
	// Safe to call any time, from any task, including when already idle.
	void stop();

	// True from the moment a command is queued until it has finished.
	bool isBusy() const { return cmdPending_ || mode_ != ServoDriveMode::Idle; }
	bool lastHomeReached() const { return lastHomeReached_; }
	bool encoderDirectionFlipped() const { return encoderFlipped_; }
	ServoStopReason lastStopReason() const { return lastStop_; }
	ServoDriveMode mode() const { return mode_; }
	int32_t targetCounts() const { return targetCounts_; }

	// Live, direct GPIO reads of the two physical limit switches — not
	// inferred from mode/history. Exposed so /api/status can show the
	// actual switch state instead of everyone guessing why a move stopped
	// (e.g. "barely moved and stood" is instant and obvious once you can
	// see the zero switch reads tripped right now).
	bool zeroSwitchTripped() const;
	bool maxSwitchTripped() const;

private:
	struct Command {
		ServoDriveMode mode;
		bool clockwise;
		int32_t targetCounts;
		uint32_t timeoutMs;
		RackEncoder *encoder;
	};

	portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
	volatile bool cmdPending_ = false;
	Command cmd_ = {};

	volatile ServoDriveMode mode_ = ServoDriveMode::Idle;
	volatile ServoStopReason lastStop_ = ServoStopReason::None;
	bool clockwise_ = true;
	bool increasing_ = true;      // EncoderTarget: target is above the start position
	uint32_t startMs_ = 0;
	uint32_t timeoutMs_ = 0;
	int32_t targetCounts_ = 0;
	int32_t startCounts_ = 0;
	int32_t lastProgressCounts_ = 0;
	uint32_t lastProgressMs_ = 0;
	RackEncoder *encoder_ = nullptr;
	volatile bool lastHomeReached_ = false;
	volatile bool encoderFlipped_ = false;

	void post(const Command &cmd);
	void execute(const Command &cmd);
	void finish(ServoStopReason reason);
	bool driveAt(bool clockwise, uint32_t speedUs);
	void setSpeed(bool clockwise, uint32_t speedUs);
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
