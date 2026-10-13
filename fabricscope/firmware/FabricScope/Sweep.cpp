#include "Sweep.h"
#include "Config.h"
#include "Settings.h"

SweepRunner gSweep;

bool SweepRunner::start(PressureServo *servo, RackEncoder *encoder, UltrasoundDriver *ultrasound,
                         const float *positionsMm, uint8_t numPositions,
                         uint32_t freqMinHz, uint32_t freqMaxHz, uint32_t freqStepHz,
                         uint32_t dwellMs) {
	if (numPositions == 0 || numPositions > SWEEP_MAX_POSITIONS) return false;
	if (freqStepHz == 0 || freqMaxHz < freqMinHz) return false;
	uint32_t stepsPerPosition = (freqMaxHz - freqMinHz) / freqStepHz + 1;
	if ((uint32_t)numPositions * stepsPerPosition > SWEEP_MAX_POINTS) return false;

	servo_ = servo;
	encoder_ = encoder;
	ultrasound_ = ultrasound;
	for (uint8_t i = 0; i < numPositions; i++) positionsMm_[i] = positionsMm[i];
	numPositions_ = numPositions;
	freqMinHz_ = freqMinHz;
	freqMaxHz_ = freqMaxHz;
	freqStepHz_ = freqStepHz;
	dwellMs_ = dwellMs;
	resultCount_ = 0;

	beginPosition(0);
	return true;
}

void SweepRunner::beginPosition(uint8_t index) {
	posIndex_ = index;
	int32_t targetCounts = (int32_t)(positionsMm_[posIndex_] * gSettings.encoderCountsPerMm);
	servo_->startMoveToEncoderTarget(encoder_, targetCounts, SERVO_MANUAL_MAX_DURATION_MS);
	state_ = SweepState::Moving;
	stateStartMs_ = millis();
}

void SweepRunner::advanceToNextPositionOrDone() {
	uint8_t next = posIndex_ + 1;
	if (next >= numPositions_) {
		state_ = SweepState::Done;
		return;
	}
	beginPosition(next);
}

void SweepRunner::update() {
	switch (state_) {
		case SweepState::Moving:
			if (!servo_->isBusy()) {
				state_ = SweepState::Settling;
				stateStartMs_ = millis();
			}
			break;

		case SweepState::Settling:
			if (millis() - stateStartMs_ >= SWEEP_SETTLE_AFTER_MOVE_MS) {
				freqCurrentHz_ = freqMinHz_;
				ultrasound_->start(freqCurrentHz_);
				state_ = SweepState::Measuring;
				stateStartMs_ = millis();
			}
			break;

		case SweepState::Measuring:
			if (millis() - stateStartMs_ >= dwellMs_) {
				if (resultCount_ < SWEEP_MAX_POINTS) {
					Reading r = ultrasound_->readCurrentSense();
					results_[resultCount_++] = { positionsMm_[posIndex_], freqCurrentHz_, r.value };
				}
				if (freqCurrentHz_ + freqStepHz_ <= freqMaxHz_) {
					freqCurrentHz_ += freqStepHz_;
					ultrasound_->start(freqCurrentHz_);
					stateStartMs_ = millis();
				} else {
					ultrasound_->stop();
					advanceToNextPositionOrDone();
				}
			}
			break;

		default:
			break;
	}
}

void SweepRunner::stop() {
	if (ultrasound_) ultrasound_->stop();
	if (servo_) servo_->stop();
	state_ = SweepState::Done;
}
