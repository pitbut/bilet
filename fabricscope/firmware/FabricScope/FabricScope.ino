#include <Arduino.h>
#include <WiFi.h>
#include "Config.h"
#include "Settings.h"
#include "Sensors.h"
#include "Actuators.h"
#include "StateMachine.h"
#include "Sweep.h"
#include "WebApi.h"

static RangeFinder gRange;
static RackEncoder gEncoder;
static PressureServo gServo;
static ScopeLift gLift;
static UltrasoundDriver gUltrasound;

static uint32_t sLastBroadcastMs = 0;

void setup() {
	Serial.begin(115200);
	delay(200);
	Serial.println("\nFabricScope ESP32 controller starting...");

	gSettings.load();

	// Wi-Fi comes up before anything touches I2C/sensors on purpose: the phone
	// must be able to find and connect to the AP even if a sensor isn't wired
	// up yet and its init takes a while (or, on some boards/cores, hangs) —
	// e.g. VL53L1X.init() polling a bus with nothing answering on it.
	WiFi.mode(WIFI_AP);
	WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
	Serial.printf("AP '%s' up, IP: %s\n", WIFI_AP_SSID, WiFi.softAPIP().toString().c_str());

	bool rangeOk = gRange.begin();
	Serial.printf("Rangefinder (VL53L1X): %s\n", rangeOk ? "OK" : "NOT DETECTED");

	gEncoder.begin();
	gServo.begin();
	gLift.begin();
	gUltrasound.begin();

	gFsm.begin(&gRange, &gEncoder, &gServo, &gLift, &gUltrasound);

	// Started before homing (which blocks for up to PRESSURE_HOME_TIMEOUT_MS)
	// so the phone can already reach /api/status while that runs — the async
	// server has its own task, independent of this setup() call finishing.
	beginWebApi(&gRange, &gEncoder, &gServo, &gLift, &gUltrasound);
	Serial.println("Web API listening on port 80 (/api/..., /ws)");

	// Home the presser-foot rack against its zero limit switch so "pressure
	// step 0" means the same real position every boot — the encoder itself
	// remembers nothing across a reset. Non-fatal if it times out (switch
	// not wired yet, wrong direction in Settings, or rack stuck): the cycle
	// still runs, just measured from whatever position the encoder reset to.
	gServo.startHoming(&gEncoder, gSettings.pressureHomeClockwise, PRESSURE_HOME_TIMEOUT_MS);
	while (gServo.isBusy()) {
		gServo.update();
		delay(5);
	}
	Serial.printf("Pressure zero homing: %s\n", gServo.lastHomeReached() ? "OK" : "NOT REACHED (check switch wiring / pressureHomeClockwise)");
}

void loop() {
	gFsm.tick();

	// Advances whatever the servo is currently doing (manual test move,
	// encoder-target move, or homing) — required every iteration now that
	// PressureServo is a non-blocking state machine. See Actuators.h.
	gServo.update();

	// Advances an in-progress auto-sweep, if any — must run after
	// gServo.update() above since SweepRunner only reads servo busy state,
	// it never drives the servo itself outside of its own start calls.
	gSweep.update();

	// Continuous safety net: the automatic raise sequence already checks
	// this switch itself (see StateMachine::runRaiseScope), but a manual
	// Test-screen "up" command just drives the motor and returns — nothing
	// was watching the switch for that case before. This runs every loop
	// iteration regardless of mode, so the switch always has an effect.
	if (gLift.currentDirection() == MotorDir::Up && gLift.isAtTopLimit()) {
		gLift.stop();
	}

	uint32_t now = millis();
	if (now - sLastBroadcastMs >= 150) {
		sLastBroadcastMs = now;
		broadcastTelemetry();
	}
}
