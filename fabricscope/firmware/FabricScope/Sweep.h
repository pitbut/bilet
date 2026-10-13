#pragma once
#include <Arduino.h>
#include "Config.h"
#include "Actuators.h"
#include "Sensors.h"

struct SweepPoint {
	float positionMm;
	uint32_t frequencyHz;
	float currentRaw;
};

enum class SweepState : uint8_t { Idle, Moving, Settling, Measuring, Done };

// Automated force x frequency measurement sweep — the real alternative to a
// guessed formula for "режим моделирование". Moves the presser-foot rack to
// each requested position (a stand-in for force, via the spring model the
// phone already computes from in Settings), and at each one steps the
// ultrasound frequency across a range, recording the current-sense ADC
// reading at every step. The phone is expected to look at where that
// current response peaks or dips (electrical signature of mechanical
// resonance) per position and build its own frequency-vs-force table from
// that — real measurements on this specific machine, not invented physics.
class SweepRunner {
public:
	// false (does nothing) if the request would overflow SWEEP_MAX_POSITIONS
	// or SWEEP_MAX_POINTS — shrink the position list or the frequency range/step.
	bool start(PressureServo *servo, RackEncoder *encoder, UltrasoundDriver *ultrasound,
	           const float *positionsMm, uint8_t numPositions,
	           uint32_t freqMinHz, uint32_t freqMaxHz, uint32_t freqStepHz,
	           uint32_t dwellMs);

	// Call every loop() iteration, AFTER servo->update() has already run for
	// this tick — SweepRunner only reads servo->isBusy(), it never drives the
	// servo itself outside of the startMoveToEncoderTarget() call above.
	void update();

	// Aborts immediately (stops ultrasound + servo); whatever was measured
	// so far stays available via result()/resultCount().
	void stop();

	bool isBusy() const {
		return state_ == SweepState::Moving || state_ == SweepState::Settling || state_ == SweepState::Measuring;
	}
	bool isDone() const { return state_ == SweepState::Done; }
	size_t resultCount() const { return resultCount_; }
	const SweepPoint &result(size_t i) const { return results_[i]; }

private:
	PressureServo *servo_ = nullptr;
	RackEncoder *encoder_ = nullptr;
	UltrasoundDriver *ultrasound_ = nullptr;
	SweepState state_ = SweepState::Idle;

	float positionsMm_[SWEEP_MAX_POSITIONS];
	uint8_t numPositions_ = 0;
	uint8_t posIndex_ = 0;

	uint32_t freqMinHz_ = 0, freqMaxHz_ = 0, freqStepHz_ = 0;
	uint32_t freqCurrentHz_ = 0;
	uint32_t dwellMs_ = 0;
	uint32_t stateStartMs_ = 0;

	SweepPoint results_[SWEEP_MAX_POINTS];
	size_t resultCount_ = 0;

	void beginPosition(uint8_t index);
	void advanceToNextPositionOrDone();
};

extern SweepRunner gSweep;
