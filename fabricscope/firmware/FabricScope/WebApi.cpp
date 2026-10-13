#include "WebApi.h"
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "Config.h"
#include "Settings.h"
#include "StateMachine.h"
#include "Sweep.h"

static AsyncWebServer server(WEB_SERVER_PORT);
static AsyncWebSocket ws("/ws");

static RangeFinder *sRange;
static RackEncoder *sEncoder;
static PressureServo *sServo;
static ScopeLift *sLift;
static UltrasoundDriver *sUltrasound;

static void sendJson(AsyncWebServerRequest *req, int code, const String &body) {
	AsyncWebServerResponse *res = req->beginResponse(code, "application/json", body);
	res->addHeader("Access-Control-Allow-Origin", "*");
	req->send(res);
}

static void sendError(AsyncWebServerRequest *req, int code, const String &message) {
	JsonDocument doc;
	doc["error"] = message;
	String out;
	serializeJson(doc, out);
	sendJson(req, code, out);
}

static String readBody(uint8_t *data, size_t len) {
	String s;
	s.reserve(len);
	for (size_t i = 0; i < len; i++) s += (char)data[i];
	return s;
}

static void buildStatusJson(String &out) {
	JsonDocument doc;
	doc["state"] = gFsm.stateName();
	doc["manualTestAllowed"] = gFsm.manualTestAllowed();
	if (gFsm.state() == StateMachine::State::Error) doc["error"] = gFsm.lastError();

	Reading dist = sRange->isPresent() ? sRange->readDistanceMm() : Reading{false, 0};
	JsonObject rangefinder = doc["rangefinder"].to<JsonObject>();
	rangefinder["present"] = sRange->isPresent();
	rangefinder["valid"] = dist.valid;
	if (dist.valid) rangefinder["distanceMm"] = dist.value;

	JsonObject encoder = doc["encoder"].to<JsonObject>();
	encoder["counts"] = sEncoder->counts();
	encoder["mm"] = sEncoder->millimeters(gSettings.encoderCountsPerMm);
	encoder["reversed"] = gSettings.encoderReversed;

	// Direct GPIO reads, not inferred — the one place to actually see why a
	// servo move just stopped (hit a switch) instead of guessing from timing.
	JsonObject servo = doc["servo"].to<JsonObject>();
	servo["busy"] = sServo->isBusy();
	servo["zeroSwitchTripped"] = sServo->zeroSwitchTripped();
	servo["maxSwitchTripped"] = sServo->maxSwitchTripped();
	servo["targetCounts"] = sServo->targetCounts();
	servo["lastStop"] = servoStopReasonName(sServo->lastStopReason());

	Reading current = sUltrasound->readCurrentSense();
	JsonObject ultrasound = doc["ultrasound"].to<JsonObject>();
	ultrasound["running"] = sUltrasound->isRunning();
	ultrasound["currentSenseRaw"] = current.value;

	doc["wifiClients"] = ws.count();
	serializeJson(doc, out);
}

void broadcastTelemetry() {
	if (ws.count() == 0) return;
	String out;
	buildStatusJson(out);
	ws.textAll(out);
}

void beginWebApi(RangeFinder *range, RackEncoder *encoder, PressureServo *servo,
                  ScopeLift *lift, UltrasoundDriver *ultrasound) {
	sRange = range;
	sEncoder = encoder;
	sServo = servo;
	sLift = lift;
	sUltrasound = ultrasound;

	// ---- Status / telemetry ----
	server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *req) {
		String out;
		buildStatusJson(out);
		sendJson(req, 200, out);
	});

	// ---- Full-cycle control ----
	server.on("/api/start", HTTP_POST, [](AsyncWebServerRequest *req) {
		gFsm.requestStart();
		sendJson(req, 200, "{\"ok\":true}");
	});

	server.on("/api/stop", HTTP_POST, [](AsyncWebServerRequest *req) {
		// Real emergency stop: cut the lift and servo directly, not just
		// flag the automatic cycle to abort. requestStop()'s abort flag is
		// only ever polled inside the FSM's own blocking loops, so on its
		// own it does nothing for a motor/servo left running by a manual
		// Test-screen command — those never went through the FSM at all.
		sLift->stop();
		sServo->stop();
		gSweep.stop();
		gFsm.requestStop();
		sendJson(req, 200, "{\"ok\":true}");
	});

	// Phone posts this once its on-device classifier has a result for the
	// current fabric sample. pressureStep indexes the calibrated presser-foot
	// steps (0..servoMaxSteps), chosen by the phone from the matched fabric.
	server.on("/api/analysis_result", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			JsonDocument doc;
			if (deserializeJson(doc, readBody(data, len))) {
				sendError(req, 400, "bad json");
				return;
			}
			if (!doc["pressureStep"].is<int>()) {
				sendError(req, 400, "pressureStep required");
				return;
			}
			if (gFsm.state() != StateMachine::State::WaitingAnalysis) {
				sendError(req, 409, "not waiting for analysis");
				return;
			}
			gFsm.submitAnalysisResult((uint8_t)doc["pressureStep"].as<int>());
			sendJson(req, 200, "{\"ok\":true}");
		});

	// ---- Test mode: one actuator/sensor at a time, only while Idle ----
	server.on("/api/test/servo", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
			JsonDocument doc;
			if (deserializeJson(doc, readBody(data, len))) { sendError(req, 400, "bad json"); return; }
			bool cw = doc["clockwise"] | true;
			uint32_t durationMs = doc["durationMs"] | gSettings.servoStepDurationMs;
			// Returns immediately — the spin itself is carried forward by
			// gServo.update() in loop() (a different task from this web
			// handler), so /api/stop stays responsive no matter how long this
			// runs. No cap here beyond SERVO_MANUAL_MAX_DURATION_MS inside
			// startTimed() itself: a limit switch or /api/stop ends it sooner.
			sServo->startTimed(cw, durationMs);
			sendJson(req, 200, "{\"ok\":true}");
		});

	// Drives to an absolute target position (mm, same reference as
	// encoder.mm in /api/status — zeroed by homing) using the same safe
	// closed loop the automatic cycle uses: stops at the target, at a
	// relevant limit switch, on encoder stall / wrong encoder direction,
	// on timeout, or on /api/stop. Why it stopped: servo.lastStop in status.
	// This is the "крутится до значения или до концевика" test mode —
	// unlike /api/test/servo (startTimed), it has an actual stop condition
	// besides elapsed time, so it can't stall the servo against a hard
	// mechanical end of travel the way a long blind timed spin can.
	server.on("/api/test/servo/move", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
			JsonDocument doc;
			if (deserializeJson(doc, readBody(data, len))) { sendError(req, 400, "bad json"); return; }
			if (!doc["targetMm"].is<float>() && !doc["targetMm"].is<int>()) { sendError(req, 400, "targetMm required"); return; }
			float targetMm = doc["targetMm"].as<float>();
			int32_t targetCounts = (int32_t)(targetMm * gSettings.encoderCountsPerMm);
			sServo->startMoveToEncoderTarget(sEncoder, targetCounts, SERVO_MOVE_STEP_TIMEOUT_MS);
			sendJson(req, 200, "{\"ok\":true}");
		});

	// ---- Auto-sweep: real force x frequency measurement, not a guessed
	// formula. Moves to each listed position, steps ultrasound frequency
	// across the given range at each one, and records the current-sense
	// ADC reading per step — see Sweep.h for why. Non-blocking: start()
	// returns immediately, progress/results are polled separately so
	// /api/stop stays responsive for the whole (potentially long) run.
	server.on("/api/test/sweep/start", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
			if (gSweep.isBusy()) { sendError(req, 409, "sweep already running"); return; }
			JsonDocument doc;
			if (deserializeJson(doc, readBody(data, len))) { sendError(req, 400, "bad json"); return; }
			JsonArray posArr = doc["positionsMm"].as<JsonArray>();
			if (posArr.isNull() || posArr.size() == 0) { sendError(req, 400, "positionsMm required"); return; }
			if (posArr.size() > SWEEP_MAX_POSITIONS) { sendError(req, 400, "too many positions"); return; }
			float positions[SWEEP_MAX_POSITIONS];
			uint8_t n = 0;
			for (JsonVariant v : posArr) positions[n++] = v.as<float>();
			uint32_t freqMinHz = doc["freqMinHz"] | 30000;
			uint32_t freqMaxHz = doc["freqMaxHz"] | 50000;
			uint32_t freqStepHz = doc["freqStepHz"] | 500;
			uint32_t dwellMs = doc["dwellMs"] | 150;
			bool ok = gSweep.start(sServo, sEncoder, sUltrasound, positions, n,
				freqMinHz, freqMaxHz, freqStepHz, dwellMs);
			if (!ok) { sendError(req, 400, "bad sweep parameters (too many points for buffer)"); return; }
			sendJson(req, 200, "{\"ok\":true}");
		});

	server.on("/api/test/sweep/stop", HTTP_POST, [](AsyncWebServerRequest *req) {
		gSweep.stop();
		sendJson(req, 200, "{\"ok\":true}");
	});

	server.on("/api/test/sweep/status", HTTP_GET, [](AsyncWebServerRequest *req) {
		JsonDocument doc;
		doc["busy"] = gSweep.isBusy();
		doc["done"] = gSweep.isDone();
		doc["resultCount"] = (uint32_t)gSweep.resultCount();
		String out;
		serializeJson(doc, out);
		sendJson(req, 200, out);
	});

	server.on("/api/test/sweep/results", HTTP_GET, [](AsyncWebServerRequest *req) {
		JsonDocument doc;
		JsonArray arr = doc["points"].to<JsonArray>();
		for (size_t i = 0; i < gSweep.resultCount(); i++) {
			const SweepPoint &p = gSweep.result(i);
			JsonObject o = arr.add<JsonObject>();
			o["positionMm"] = p.positionMm;
			o["frequencyHz"] = p.frequencyHz;
			o["currentRaw"] = p.currentRaw;
		}
		String out;
		serializeJson(doc, out);
		sendJson(req, 200, out);
	});

	server.on("/api/test/motor", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
			JsonDocument doc;
			if (deserializeJson(doc, readBody(data, len))) { sendError(req, 400, "bad json"); return; }
			String action = doc["action"] | "stop";
			if (action == "down") sLift->drive(MotorDir::Down);
			else if (action == "up") sLift->drive(MotorDir::Up);
			else sLift->stop();
			sendJson(req, 200, "{\"ok\":true}");
		});

	server.on("/api/test/ultrasound", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
			JsonDocument doc;
			if (deserializeJson(doc, readBody(data, len))) { sendError(req, 400, "bad json"); return; }
			String action = doc["action"] | "off";
			if (action == "on") {
				uint32_t freq = doc["frequencyHz"] | gSettings.ultrasoundFrequencyHz;
				sUltrasound->start(freq);
			} else {
				sUltrasound->stop();
			}
			sendJson(req, 200, "{\"ok\":true}");
		});

	server.on("/api/test/encoder/zero", HTTP_POST, [](AsyncWebServerRequest *req) {
		if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
		sEncoder->zero();
		sendJson(req, 200, "{\"ok\":true}");
	});

	// Re-applies the current "stop" pulse (1500us + Settings.servoStopTrimUs)
	// right now — use after changing the trim to see immediately whether the
	// servo still creeps, without needing a full move first.
	server.on("/api/test/servo/center", HTTP_POST, [](AsyncWebServerRequest *req) {
		if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
		sServo->stop();
		sendJson(req, 200, "{\"ok\":true}");
	});

	// Drives the presser-foot rack to its zero limit switch and zeroes the
	// encoder there — the real "pressure step 0" reference. Direction comes
	// from Settings (pressureHomeClockwise) unless overridden in the request,
	// which is how you find the right direction in the first place: try one
	// way, if it reports ok:false (never reached the switch) flip and retry.
	server.on("/api/test/servo/home", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			if (!gFsm.manualTestAllowed()) { sendError(req, 409, "cycle in progress"); return; }
			JsonDocument doc;
			if (len > 0 && deserializeJson(doc, readBody(data, len))) { sendError(req, 400, "bad json"); return; }
			bool cw = doc["clockwise"] | gSettings.pressureHomeClockwise;
			// Queued and driven by loop() like every other servo move — this
			// handler only waits for the result (calling update() here too
			// would drive the servo from two tasks at once).
			sServo->startHoming(sEncoder, cw, PRESSURE_HOME_TIMEOUT_MS);
			uint32_t waitStart = millis();
			while (sServo->isBusy() && millis() - waitStart < PRESSURE_HOME_TIMEOUT_MS + 2000) {
				delay(5);
			}
			JsonDocument res;
			res["ok"] = sServo->lastHomeReached();
			res["encoderCounts"] = sEncoder->counts();
			res["lastStop"] = servoStopReasonName(sServo->lastStopReason());
			res["encoderDirectionFlipped"] = sServo->encoderDirectionFlipped();
			String out;
			serializeJson(res, out);
			sendJson(req, 200, out);
		});

	// ---- Settings ----
	server.on("/api/settings", HTTP_GET, [](AsyncWebServerRequest *req) {
		String out;
		gSettings.toJson(out);
		sendJson(req, 200, out);
	});

	server.on("/api/settings", HTTP_POST, [](AsyncWebServerRequest *req) {},
		nullptr,
		[](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
			String body = readBody(data, len);
			if (!gSettings.fromJson(body)) { sendError(req, 400, "bad json"); return; }
			String out;
			gSettings.toJson(out);
			sendJson(req, 200, out);
		});

	server.onNotFound([](AsyncWebServerRequest *req) {
		sendError(req, 404, "not found");
	});

	ws.onEvent([](AsyncWebSocket *, AsyncWebSocketClient *client, AwsEventType type,
	              void *, uint8_t *, size_t) {
		if (type == WS_EVT_CONNECT) {
			String out;
			buildStatusJson(out);
			client->text(out);
		}
	});
	server.addHandler(&ws);

	server.begin();
}
