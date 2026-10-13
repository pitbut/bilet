#include "StateMachine.h"
#include "Config.h"
#include "Settings.h"

StateMachine gFsm;

void StateMachine::begin(RangeFinder *range, RackEncoder *encoder, PressureServo *servo,
                          ScopeLift *lift, UltrasoundDriver *ultrasound) {
	range_ = range;
	encoder_ = encoder;
	servo_ = servo;
	lift_ = lift;
	ultrasound_ = ultrasound;
	state_ = State::Idle;
}

const char *StateMachine::stateName() const {
	switch (state_) {
		case State::Idle: return "idle";
		case State::LoweringScope: return "lowering_scope";
		case State::WaitingAnalysis: return "waiting_analysis";
		case State::RaisingScope: return "raising_scope";
		case State::SettingPressure: return "setting_pressure";
		case State::Ultrasound: return "ultrasound";
		case State::Error: return "error";
	}
	return "unknown";
}

void StateMachine::requestStart() {
	if (state_ == State::Idle) startRequested_ = true;
}

void StateMachine::requestStop() {
	abortRequested_ = true;
	if (state_ == State::Error) {
		state_ = State::Idle;
		lastError_ = "";
	}
}

void StateMachine::submitAnalysisResult(uint8_t pressureStep) {
	if (state_ != State::WaitingAnalysis) return;
	pendingPressureStep_ = pressureStep;
	analysisResultReady_ = true;
}

void StateMachine::fail(const String &reason) {
	lastError_ = reason;
	state_ = State::Error;
}

void StateMachine::tick() {
	switch (state_) {
		case State::Idle:
			if (startRequested_) {
				startRequested_ = false;
				state_ = State::LoweringScope;
				runLowerScope();
			}
			break;

		case State::WaitingAnalysis:
			if (abortRequested_) {
				abortRequested_ = false;
				lift_->stop();
				state_ = State::Idle;
			} else if (analysisResultReady_) {
				analysisResultReady_ = false;
				state_ = State::RaisingScope;
				runRaiseScope();
				if (state_ != State::Error) {
					state_ = State::SettingPressure;
					runSetPressure(pendingPressureStep_);
				}
				if (state_ != State::Error) {
					state_ = State::Ultrasound;
					runUltrasound();
				}
				if (state_ != State::Error) state_ = State::Idle;
			} else if (millis() - waitingAnalysisStartMs_ > ANALYSIS_TIMEOUT_MS) {
				lift_->stop();
				fail("Таймаут: телефон не прислал результат анализа ткани");
			}
			break;

		// LoweringScope/RaisingScope/SettingPressure/Ultrasound run to
		// completion synchronously inside their run* calls above/below —
		// tick() only re-enters here if something external left the FSM
		// parked mid-way (shouldn't happen, but don't spin silently).
		default:
			break;
	}
}

void StateMachine::runLowerScope() {
	if (!range_->isPresent()) {
		fail("Дальномер (VL53L1X) не отвечает — опускание отменено");
		return;
	}
	lift_->drive(MotorDir::Down);
	uint32_t startMs = millis();
	while (true) {
		if (abortRequested_) {
			abortRequested_ = false;
			lift_->stop();
			state_ = State::Idle;
			return;
		}
		Reading d = range_->readDistanceMm();
		if (d.valid && d.value <= (gSettings.focusTargetDistanceMm + gSettings.focusToleranceMm)) {
			lift_->stop();
			state_ = State::WaitingAnalysis;
			waitingAnalysisStartMs_ = millis();
			return;
		}
		if (millis() - startMs > gSettings.scopeLowerTimeoutMs) {
			lift_->stop();
			fail("Таймаут опускания микроскопа — дальномер не подтвердил нужную дистанцию");
			return;
		}
		delay(20);
	}
}

void StateMachine::runRaiseScope() {
	lift_->drive(MotorDir::Up);
	uint32_t startMs = millis();
	while (millis() - startMs < gSettings.scopeRaiseDurationMs) {
		if (abortRequested_) {
			abortRequested_ = false;
			lift_->stop();
			state_ = State::Idle;
			return;
		}
		if (lift_->isAtTopLimit()) break;
		delay(10);
	}
	lift_->stop();
}

void StateMachine::runSetPressure(uint8_t step) {
	if (step > gSettings.servoMaxSteps) step = gSettings.servoMaxSteps;
	if (abortRequested_) return;
	// Absolute target from wherever the encoder was last zeroed (see
	// /api/test/encoder/zero) — not relative to wherever the rack
	// happens to be right now, so repeated cycles don't drift.
	int32_t targetCounts = (int32_t)(step * gSettings.pressureStepMm * gSettings.encoderCountsPerMm);
	servo_->startMoveToEncoderTarget(encoder_, targetCounts, PRESSURE_ADJUST_TIMEOUT_MS);
	while (servo_->isBusy()) {
		if (abortRequested_) {
			abortRequested_ = false;
			servo_->stop();
			break;
		}
		servo_->update();
		delay(5);
	}
}

void StateMachine::runUltrasound() {
	ultrasound_->start(gSettings.ultrasoundFrequencyHz);
	uint32_t startMs = millis();
	while (millis() - startMs < gSettings.ultrasoundDurationMs) {
		if (abortRequested_) {
			abortRequested_ = false;
			break;
		}
		delay(20);
	}
	ultrasound_->stop();
}
