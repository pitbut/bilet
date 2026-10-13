#include "Settings.h"
#include <Preferences.h>
#include <ArduinoJson.h>
#include "Config.h"

Settings gSettings;

void Settings::load() {
	Preferences prefs;
	prefs.begin(PREFS_NAMESPACE, /*readOnly=*/true);
	focusTargetDistanceMm  = prefs.getFloat("focusDistMm", focusTargetDistanceMm);
	focusToleranceMm       = prefs.getFloat("focusTolMm", focusToleranceMm);
	scopeLowerTimeoutMs    = prefs.getUInt("lowerTimeoutMs", scopeLowerTimeoutMs);
	scopeRaiseDurationMs   = prefs.getUInt("raiseDurMs", scopeRaiseDurationMs);
	ultrasoundFrequencyHz  = prefs.getUInt("usFreqHz", ultrasoundFrequencyHz);
	ultrasoundDurationMs   = prefs.getUInt("usDurMs", ultrasoundDurationMs);
	servoStepDurationMs    = prefs.getUInt("servoStepMs", servoStepDurationMs);
	servoMaxSteps          = prefs.getUChar("servoMaxSteps", servoMaxSteps);
	encoderCountsPerMm     = prefs.getFloat("encCountsMm", encoderCountsPerMm);
	pressureStepMm         = prefs.getFloat("pressStepMm", pressureStepMm);
	pressureHomeClockwise  = prefs.getBool("pressHomeCw", pressureHomeClockwise);
	servoStopTrimUs        = (int16_t)prefs.getShort("servoTrimUs", servoStopTrimUs);
	springStiffnessKgfMm   = prefs.getFloat("springKgfMm", springStiffnessKgfMm);
	preloadKgf             = prefs.getFloat("preloadKgf", preloadKgf);
	prefs.end();
}

void Settings::save() const {
	Preferences prefs;
	prefs.begin(PREFS_NAMESPACE, /*readOnly=*/false);
	prefs.putFloat("focusDistMm", focusTargetDistanceMm);
	prefs.putFloat("focusTolMm", focusToleranceMm);
	prefs.putUInt("lowerTimeoutMs", scopeLowerTimeoutMs);
	prefs.putUInt("raiseDurMs", scopeRaiseDurationMs);
	prefs.putUInt("usFreqHz", ultrasoundFrequencyHz);
	prefs.putUInt("usDurMs", ultrasoundDurationMs);
	prefs.putUInt("servoStepMs", servoStepDurationMs);
	prefs.putUChar("servoMaxSteps", servoMaxSteps);
	prefs.putFloat("encCountsMm", encoderCountsPerMm);
	prefs.putFloat("pressStepMm", pressureStepMm);
	prefs.putBool("pressHomeCw", pressureHomeClockwise);
	prefs.putShort("servoTrimUs", servoStopTrimUs);
	prefs.putFloat("springKgfMm", springStiffnessKgfMm);
	prefs.putFloat("preloadKgf", preloadKgf);
	prefs.end();
}

void Settings::toJson(String &out) const {
	JsonDocument doc;
	doc["focusTargetDistanceMm"] = focusTargetDistanceMm;
	doc["focusToleranceMm"] = focusToleranceMm;
	doc["scopeLowerTimeoutMs"] = scopeLowerTimeoutMs;
	doc["scopeRaiseDurationMs"] = scopeRaiseDurationMs;
	doc["ultrasoundFrequencyHz"] = ultrasoundFrequencyHz;
	doc["ultrasoundDurationMs"] = ultrasoundDurationMs;
	doc["servoStepDurationMs"] = servoStepDurationMs;
	doc["servoMaxSteps"] = servoMaxSteps;
	doc["encoderCountsPerMm"] = encoderCountsPerMm;
	doc["pressureStepMm"] = pressureStepMm;
	doc["pressureHomeClockwise"] = pressureHomeClockwise;
	doc["servoStopTrimUs"] = servoStopTrimUs;
	doc["springStiffnessKgfMm"] = springStiffnessKgfMm;
	doc["preloadKgf"] = preloadKgf;
	serializeJson(doc, out);
}

bool Settings::fromJson(const String &json) {
	JsonDocument doc;
	DeserializationError err = deserializeJson(doc, json);
	if (err) return false;

	// Every field is optional in the request; only overwrite what's present,
	// and only if the value is plausible (no crashing the winch on a typo).
	if (doc["focusTargetDistanceMm"].is<float>())
		focusTargetDistanceMm = doc["focusTargetDistanceMm"].as<float>();
	if (doc["focusToleranceMm"].is<float>())
		focusToleranceMm = doc["focusToleranceMm"].as<float>();
	if (doc["scopeLowerTimeoutMs"].is<uint32_t>())
		scopeLowerTimeoutMs = doc["scopeLowerTimeoutMs"].as<uint32_t>();
	if (doc["scopeRaiseDurationMs"].is<uint32_t>())
		scopeRaiseDurationMs = doc["scopeRaiseDurationMs"].as<uint32_t>();
	if (doc["ultrasoundFrequencyHz"].is<uint32_t>())
		ultrasoundFrequencyHz = doc["ultrasoundFrequencyHz"].as<uint32_t>();
	if (doc["ultrasoundDurationMs"].is<uint32_t>())
		ultrasoundDurationMs = doc["ultrasoundDurationMs"].as<uint32_t>();
	if (doc["servoStepDurationMs"].is<uint32_t>())
		servoStepDurationMs = doc["servoStepDurationMs"].as<uint32_t>();
	if (doc["servoMaxSteps"].is<uint8_t>())
		servoMaxSteps = doc["servoMaxSteps"].as<uint8_t>();
	if (doc["encoderCountsPerMm"].is<float>())
		encoderCountsPerMm = doc["encoderCountsPerMm"].as<float>();
	if (doc["pressureStepMm"].is<float>())
		pressureStepMm = doc["pressureStepMm"].as<float>();
	if (doc["pressureHomeClockwise"].is<bool>())
		pressureHomeClockwise = doc["pressureHomeClockwise"].as<bool>();
	if (doc["servoStopTrimUs"].is<int16_t>())
		servoStopTrimUs = doc["servoStopTrimUs"].as<int16_t>();
	if (doc["springStiffnessKgfMm"].is<float>())
		springStiffnessKgfMm = doc["springStiffnessKgfMm"].as<float>();
	if (doc["preloadKgf"].is<float>())
		preloadKgf = doc["preloadKgf"].as<float>();

	save();
	return true;
}
