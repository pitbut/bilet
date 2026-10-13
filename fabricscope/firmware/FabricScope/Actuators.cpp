#include "Actuators.h"
#include <ESP32Servo.h>
#include "Config.h"
#include "Settings.h"

// ---- PressureServo ----

static Servo sPressureServo;

// The pulse width that actually produces zero speed on this specific
// converted servo — kept as a belt-and-braces default for the brief instant
// right after power-on/before power-off, but no longer load-bearing: the
// relay now cuts real power whenever the servo is "stopped", so a not-quite-
// perfect trim can no longer cause creep. See Settings::servoStopTrimUs.
static int stopPulseUs() {
	return SERVO_STOP_US + gSettings.servoStopTrimUs;
}

static void setServoPower(bool on) {
	bool activeLevel = SERVO_POWER_ACTIVE_LOW ? LOW : HIGH;
	bool idleLevel = SERVO_POWER_ACTIVE_LOW ? HIGH : LOW;
	digitalWrite(PIN_SERVO_POWER, on ? activeLevel : idleLevel);
	if (on) delay(SERVO_POWER_WARMUP_MS); // let the servo's own electronics boot before driving it
}

static bool pressureZeroSwitchTripped() {
#if HAS_LIMIT_PRESSURE_ZERO
	return digitalRead(PIN_LIMIT_PRESSURE_ZERO) == LOW; // active low, pulled up
#else
	return false;
#endif
}

static bool pressureMaxSwitchTripped() {
#if HAS_LIMIT_PRESSURE_MAX
	return digitalRead(PIN_LIMIT_PRESSURE_MAX) == LOW; // active low, pulled up
#else
	return false;
#endif
}

// A switch only matters when travel is heading INTO it. "Towards zero"
// means driving the same literal rotation as homing uses (by definition —
// that's what homing drives towards it). Without this direction check, a
// move deliberately heading AWAY from a switch that's still tripped (e.g.
// right after homing completes, while the zero switch is still pressed)
// would immediately abort itself on the very first update() tick.
static ServoStopReason pressureLimitBlocks(bool clockwise) {
	bool towardZero = (clockwise == gSettings.pressureHomeClockwise);
	if (towardZero && pressureZeroSwitchTripped()) return ServoStopReason::LimitZero;
	if (!towardZero && pressureMaxSwitchTripped()) return ServoStopReason::LimitMax;
	return ServoStopReason::None;
}

const char *servoStopReasonName(ServoStopReason r) {
	switch (r) {
		case ServoStopReason::None:            return "none";
		case ServoStopReason::Target:          return "target";
		case ServoStopReason::AlreadyThere:    return "already_there";
		case ServoStopReason::LimitZero:       return "limit_zero";
		case ServoStopReason::LimitMax:        return "limit_max";
		case ServoStopReason::Stall:           return "stall";
		case ServoStopReason::WrongDirection:  return "wrong_direction";
		case ServoStopReason::Timeout:         return "timeout";
		case ServoStopReason::Stopped:         return "stopped";
		case ServoStopReason::HomeReached:     return "home";
		case ServoStopReason::HomeWrongSwitch: return "home_wrong_switch";
	}
	return "unknown";
}

void PressureServo::begin() {
	pinMode(PIN_SERVO_POWER, OUTPUT);
	setServoPower(false); // safe default: unpowered until something actually needs it
	sPressureServo.setPeriodHertz(50);
	sPressureServo.attach(PIN_SERVO, SERVO_FULL_CCW_US, SERVO_FULL_CW_US);
	sPressureServo.writeMicroseconds(stopPulseUs());
#if HAS_LIMIT_PRESSURE_ZERO
	pinMode(PIN_LIMIT_PRESSURE_ZERO, INPUT_PULLUP);
#endif
#if HAS_LIMIT_PRESSURE_MAX
	pinMode(PIN_LIMIT_PRESSURE_MAX, INPUT_PULLUP);
#endif
}

// Speed is the pulse's distance from the (trimmed) stop pulse — clockwise
// is above it, counter-clockwise below, same sense as SERVO_FULL_CW_US.
void PressureServo::setSpeed(bool clockwise, uint32_t speedUs) {
	int us = stopPulseUs() + (clockwise ? (int)speedUs : -(int)speedUs);
	us = constrain(us, SERVO_FULL_CCW_US, SERVO_FULL_CW_US);
	sPressureServo.writeMicroseconds(us);
}

// Powers up and starts spinning. Returns false if stop() was called (from
// the web task) during the power-up warmup — in that case power is cut
// again and nothing should be driven.
bool PressureServo::driveAt(bool clockwise, uint32_t speedUs) {
	clockwise_ = clockwise;
	sPressureServo.writeMicroseconds(stopPulseUs());
	setServoPower(true);
	if (mode_ == ServoDriveMode::Idle) {
		setServoPower(false);
		return false;
	}
	setSpeed(clockwise, speedUs);
	return true;
}

void PressureServo::post(const Command &cmd) {
	portENTER_CRITICAL(&mux_);
	cmd_ = cmd;
	cmdPending_ = true;
	portEXIT_CRITICAL(&mux_);
}

void PressureServo::startTimed(bool clockwise, uint32_t maxDurationMs) {
	post({ServoDriveMode::Timed, clockwise, 0, min(maxDurationMs, (uint32_t)SERVO_MANUAL_MAX_DURATION_MS), nullptr});
}

void PressureServo::startMoveToEncoderTarget(RackEncoder *encoder, int32_t targetCounts, uint32_t timeoutMs) {
	post({ServoDriveMode::EncoderTarget, false, targetCounts, timeoutMs, encoder});
}

void PressureServo::startHoming(RackEncoder *encoder, bool clockwise, uint32_t timeoutMs) {
	post({ServoDriveMode::Homing, clockwise, 0, timeoutMs, encoder});
}

// Loop task only. Any move already running is replaced by the new one.
void PressureServo::execute(const Command &cmd) {
	encoder_ = cmd.encoder;
	timeoutMs_ = cmd.timeoutMs;
	startMs_ = millis();

	switch (cmd.mode) {
		case ServoDriveMode::Timed:
			mode_ = ServoDriveMode::Timed;
			driveAt(cmd.clockwise, SERVO_FULL_SPEED_US);
			break;

		case ServoDriveMode::EncoderTarget: {
			targetCounts_ = cmd.targetCounts;
			startCounts_ = encoder_->counts();
			int32_t distance = targetCounts_ - startCounts_;
			if (abs(distance) <= SERVO_TARGET_TOLERANCE_COUNTS) {
				finish(ServoStopReason::AlreadyThere);
				return;
			}
			increasing_ = distance > 0;
			// Counts increase moving AWAY from the zero switch, i.e. opposite
			// to the homing rotation.
			bool cw = increasing_ ? !gSettings.pressureHomeClockwise : gSettings.pressureHomeClockwise;
			ServoStopReason blocked = pressureLimitBlocks(cw);
			if (blocked != ServoStopReason::None) {
				finish(blocked);
				return;
			}
			mode_ = ServoDriveMode::EncoderTarget;
			if (!driveAt(cw, SERVO_FULL_SPEED_US)) return;
			// Stall clock starts after the power-up warmup, not before it.
			lastProgressCounts_ = encoder_->counts();
			lastProgressMs_ = millis();
			break;
		}

		case ServoDriveMode::Homing:
			lastHomeReached_ = false;
			encoderFlipped_ = false;
			if (pressureZeroSwitchTripped()) {
				encoder_->zero();
				lastHomeReached_ = true;
				finish(ServoStopReason::HomeReached);
				return;
			}
			startCounts_ = encoder_->counts();
			mode_ = ServoDriveMode::Homing;
			driveAt(cmd.clockwise, SERVO_FULL_SPEED_US);
			break;

		default:
			break;
	}
}

void PressureServo::update() {
	if (cmdPending_) {
		Command cmd;
		portENTER_CRITICAL(&mux_);
		cmd = cmd_;
		cmdPending_ = false;
		portEXIT_CRITICAL(&mux_);
		execute(cmd);
	}

	if (mode_ == ServoDriveMode::Idle) return;
	bool timedOut = millis() - startMs_ > timeoutMs_;

	switch (mode_) {
		case ServoDriveMode::Timed: {
			ServoStopReason blocked = pressureLimitBlocks(clockwise_);
			if (blocked != ServoStopReason::None) finish(blocked);
			else if (timedOut) finish(ServoStopReason::Timeout);
			break;
		}

		case ServoDriveMode::EncoderTarget: {
			int32_t now = encoder_->counts();
			int32_t remaining = increasing_ ? (targetCounts_ - now) : (now - targetCounts_);
			int32_t progress = increasing_ ? (now - startCounts_) : (startCounts_ - now);
			ServoStopReason blocked = pressureLimitBlocks(clockwise_);

			if (abs(now - lastProgressCounts_) >= SERVO_STALL_MIN_COUNTS) {
				lastProgressCounts_ = now;
				lastProgressMs_ = millis();
			}

			if (remaining <= SERVO_TARGET_TOLERANCE_COUNTS) finish(ServoStopReason::Target);
			else if (blocked != ServoStopReason::None) finish(blocked);
			else if (progress < -SERVO_WRONG_DIR_COUNTS) finish(ServoStopReason::WrongDirection);
			else if (millis() - lastProgressMs_ > SERVO_STALL_TIMEOUT_MS) finish(ServoStopReason::Stall);
			else if (timedOut) finish(ServoStopReason::Timeout);
			else {
				// Linear slow-down inside the slow zone, so the servo's own
				// coasting doesn't carry the rack past the target.
				uint32_t speed = SERVO_FULL_SPEED_US;
				if (remaining < SERVO_SLOW_ZONE_COUNTS) {
					speed = SERVO_MIN_SPEED_US +
						(uint32_t)((SERVO_FULL_SPEED_US - SERVO_MIN_SPEED_US) * (int64_t)remaining / SERVO_SLOW_ZONE_COUNTS);
				}
				setSpeed(clockwise_, speed);
			}
			break;
		}

		case ServoDriveMode::Homing:
			if (pressureZeroSwitchTripped()) {
				// Travelling towards zero must make the counts go DOWN. If they
				// clearly went up instead, the encoder is wired/mounted the
				// other way round — fix the sign once, here, where the
				// direction of travel is known for certain.
				int32_t delta = encoder_->counts() - startCounts_;
				if (delta > SERVO_WRONG_DIR_COUNTS) {
					gSettings.encoderReversed = !gSettings.encoderReversed;
					gSettings.save();
					encoderFlipped_ = true;
				}
				encoder_->zero();
				lastHomeReached_ = true;
				finish(ServoStopReason::HomeReached);
			} else if (pressureMaxSwitchTripped()) {
				// Hit the wrong switch — pressureHomeClockwise is probably backwards.
				lastHomeReached_ = false;
				finish(ServoStopReason::HomeWrongSwitch);
			} else if (timedOut) {
				lastHomeReached_ = false;
				finish(ServoStopReason::Timeout);
			}
			break;

		default:
			break;
	}
}

void PressureServo::finish(ServoStopReason reason) {
	mode_ = ServoDriveMode::Idle;
	sPressureServo.writeMicroseconds(stopPulseUs());
	setServoPower(false);
	lastStop_ = reason;
}

void PressureServo::stop() {
	portENTER_CRITICAL(&mux_);
	bool wasPending = cmdPending_;
	cmdPending_ = false;
	portEXIT_CRITICAL(&mux_);
	if (wasPending || mode_ != ServoDriveMode::Idle) {
		finish(ServoStopReason::Stopped);
	} else {
		// Already idle: re-apply the stop pulse / cut power (the trim test
		// relies on this) but keep the real reason the last move ended.
		sPressureServo.writeMicroseconds(stopPulseUs());
		setServoPower(false);
	}
}

bool PressureServo::zeroSwitchTripped() const { return pressureZeroSwitchTripped(); }
bool PressureServo::maxSwitchTripped() const { return pressureMaxSwitchTripped(); }

// ---- ScopeLift ----

void ScopeLift::begin() {
	pinMode(PIN_MOTOR_IN1, OUTPUT);
	pinMode(PIN_MOTOR_IN2, OUTPUT);
	digitalWrite(PIN_MOTOR_IN1, LOW);
	digitalWrite(PIN_MOTOR_IN2, LOW);
#if HAS_LIMIT_UP_SWITCH
	pinMode(PIN_LIMIT_UP, INPUT_PULLUP);
#endif
}

void ScopeLift::drive(MotorDir dir) {
	dir_ = dir;
	switch (dir) {
		case MotorDir::Down:
			analogWrite(PIN_MOTOR_IN1, MOTOR_PWM_DUTY);
			analogWrite(PIN_MOTOR_IN2, 0);
			break;
		case MotorDir::Up:
			analogWrite(PIN_MOTOR_IN1, 0);
			analogWrite(PIN_MOTOR_IN2, MOTOR_PWM_DUTY);
			break;
		case MotorDir::Stop:
		default:
			analogWrite(PIN_MOTOR_IN1, 0);
			analogWrite(PIN_MOTOR_IN2, 0);
			break;
	}
}

void ScopeLift::stop() {
	drive(MotorDir::Stop);
}

bool ScopeLift::isAtTopLimit() const {
#if HAS_LIMIT_UP_SWITCH
	return digitalRead(PIN_LIMIT_UP) == LOW; // active low, pulled up
#else
	return false; // no switch wired — caller must rely on timed raise only
#endif
}

// ---- UltrasoundDriver ----

void UltrasoundDriver::begin() {
	// arduino-esp32 core 3.x dropped the old channel-based ledcSetup()/
	// ledcAttachPin() API in favor of attaching the LEDC timer directly to a
	// pin; ledcWrite()/ledcChangeFrequency() then address that pin too.
	ledcAttach(PIN_ULTRASOUND_GATE, 40000 /* placeholder, overwritten in start() */, ULTRASOUND_PWM_RES_BITS);
	ledcWrite(PIN_ULTRASOUND_GATE, 0);
	analogReadResolution(12);
}

void UltrasoundDriver::start(uint32_t frequencyHz) {
	ledcChangeFrequency(PIN_ULTRASOUND_GATE, frequencyHz, ULTRASOUND_PWM_RES_BITS);
	uint32_t duty = (uint32_t)((1 << ULTRASOUND_PWM_RES_BITS) * (ULTRASOUND_DUTY_PERCENT / 100.0f));
	ledcWrite(PIN_ULTRASOUND_GATE, duty);
	running_ = true;
}

void UltrasoundDriver::stop() {
	ledcWrite(PIN_ULTRASOUND_GATE, 0);
	running_ = false;
}

Reading UltrasoundDriver::readCurrentSense() const {
	// A real ADC sample off the shunt — if nothing is wired here it will read
	// noise/float near 0, which is honestly what "no current sense fitted" looks
	// like; we don't second-guess it into a fabricated "ok" value.
	int raw = analogRead(PIN_CURRENT_SENSE);
	return {true, (float)raw};
}
