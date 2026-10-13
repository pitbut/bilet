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
static bool pressureLimitBlocks(bool clockwise) {
	bool towardZero = (clockwise == gSettings.pressureHomeClockwise);
	if (towardZero && pressureZeroSwitchTripped()) return true;
	if (!towardZero && pressureMaxSwitchTripped()) return true;
	return false;
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

void PressureServo::driveAt(bool clockwise) {
	clockwise_ = clockwise;
	setServoPower(true);
	sPressureServo.writeMicroseconds(clockwise ? SERVO_FULL_CW_US : SERVO_FULL_CCW_US);
}

void PressureServo::startTimed(bool clockwise, uint32_t maxDurationMs) {
	mode_ = ServoDriveMode::Timed;
	startMs_ = millis();
	timeoutMs_ = min(maxDurationMs, (uint32_t)SERVO_MANUAL_MAX_DURATION_MS);
	driveAt(clockwise);
}

void PressureServo::startMoveToEncoderTarget(RackEncoder *encoder, int32_t targetCounts, uint32_t timeoutMs) {
	encoder_ = encoder;
	targetCounts_ = targetCounts;
	int32_t start = encoder->counts();
	if (targetCounts == start) { mode_ = ServoDriveMode::Idle; return; } // already there
	mode_ = ServoDriveMode::EncoderTarget;
	startMs_ = millis();
	timeoutMs_ = timeoutMs;
	driveAt(targetCounts > start);
}

void PressureServo::startHoming(RackEncoder *encoder, bool clockwise, uint32_t timeoutMs) {
	encoder_ = encoder;
	lastHomeReached_ = false;
	if (pressureZeroSwitchTripped()) {
		encoder->zero();
		lastHomeReached_ = true;
		mode_ = ServoDriveMode::Idle;
		return;
	}
	mode_ = ServoDriveMode::Homing;
	startMs_ = millis();
	timeoutMs_ = timeoutMs;
	driveAt(clockwise);
}

void PressureServo::update() {
	if (mode_ == ServoDriveMode::Idle) return;
	bool timedOut = millis() - startMs_ > timeoutMs_;

	switch (mode_) {
		case ServoDriveMode::Timed:
			if (pressureLimitBlocks(clockwise_) || timedOut) stop();
			break;

		case ServoDriveMode::EncoderTarget: {
			int32_t now = encoder_->counts();
			bool reached = clockwise_ ? (now >= targetCounts_) : (now <= targetCounts_);
			if (reached || pressureLimitBlocks(clockwise_) || timedOut) stop();
			break;
		}

		case ServoDriveMode::Homing:
			if (pressureZeroSwitchTripped()) {
				encoder_->zero();
				lastHomeReached_ = true;
				stop();
			} else if (pressureMaxSwitchTripped()) {
				// Hit the wrong switch — pressureHomeClockwise is probably backwards.
				lastHomeReached_ = false;
				stop();
			} else if (timedOut) {
				lastHomeReached_ = false;
				stop();
			}
			break;

		default:
			break;
	}
}

void PressureServo::stop() {
	mode_ = ServoDriveMode::Idle;
	sPressureServo.writeMicroseconds(stopPulseUs());
	setServoPower(false);
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
