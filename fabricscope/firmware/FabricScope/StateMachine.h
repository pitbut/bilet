#pragma once
#include <Arduino.h>
#include "Sensors.h"
#include "Actuators.h"

// The full-cycle FSM described to the operator as:
//   опустить микроскоп -> дождаться результата анализа с телефона ->
//   поднять микроскоп -> выставить прижим лапки -> ультразвук -> готово.
//
// Each state's work runs synchronously inside tick() (blocking the Arduino
// loop task only, never the AsyncWebServer task), polling an abort flag that
// /api/stop can set from any other task. There is no "simulate success"
// fallback anywhere here: a missing/unresponsive sensor takes the machine to
// Error with a reason string, not a guessed transition.
class StateMachine {
public:
	enum class State : uint8_t {
		Idle,
		LoweringScope,
		WaitingAnalysis,
		RaisingScope,
		SettingPressure,
		Ultrasound,
		Error
	};

	void begin(RangeFinder *range, RackEncoder *encoder, PressureServo *servo,
	           ScopeLift *lift, UltrasoundDriver *ultrasound);

	// Call every loop() iteration.
	void tick();

	// Called from the (async, different-task) HTTP handlers:
	void requestStart();                       // no-op unless currently Idle
	void requestStop();                        // aborts any in-flight motion, clears Error
	void submitAnalysisResult(uint8_t pressureStep); // no-op unless currently WaitingAnalysis

	State state() const { return state_; }
	const char *stateName() const;
	String lastError() const { return lastError_; }
	bool manualTestAllowed() const { return state_ == State::Idle; }

private:
	State state_ = State::Idle;
	volatile bool abortRequested_ = false;
	volatile bool startRequested_ = false;
	volatile bool analysisResultReady_ = false;
	volatile uint8_t pendingPressureStep_ = 0;
	uint32_t waitingAnalysisStartMs_ = 0;
	String lastError_;

	RangeFinder *range_ = nullptr;
	RackEncoder *encoder_ = nullptr;
	PressureServo *servo_ = nullptr;
	ScopeLift *lift_ = nullptr;
	UltrasoundDriver *ultrasound_ = nullptr;

	void runLowerScope();
	void runRaiseScope();
	void runSetPressure(uint8_t step);
	void runUltrasound();
	void fail(const String &reason);
};

extern StateMachine gFsm;
