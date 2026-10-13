#pragma once

// ---- Wi-Fi ----
// Device runs its own AP so the phone can connect directly without a router.
#define WIFI_AP_SSID       "FabricScope"
#define WIFI_AP_PASSWORD   "12345678"
#define WEB_SERVER_PORT    80

// ---- I2C (VL53L1X laser rangefinder, mounted to read distance from scope head to fabric) ----
#define PIN_I2C_SDA        21
#define PIN_I2C_SCL        22
#define PIN_RANGEFINDER_XSHUT 4    // optional hardware reset/shutdown line, -1 if not wired
#define RANGEFINDER_I2C_ADDR 0x29

// ---- Quadrature encoder on the presser-foot rack (thickness measurement) ----
// On regular GPIOs (not the input-only 32/33/34/35/36/39), so the internal
// pull-up can actually hold the line steady between real transitions — the
// encoder was previously on 34/35, which have NO pull resistor at all (a
// hardware limit on those six pins, not something firmware can work around),
// and floated/picked up noise from the nearby motor and servo MOSFET.
#define PIN_ENCODER_A      16
#define PIN_ENCODER_B      17
#define ENCODER_COUNTS_PER_MM  800.0f   // calibrate against a known-thickness shim; see /api/settings

// ---- Continuous-rotation servo (60T -> 20T gear -> lead screw, presses the foot spring) ----
// DS3240MG with its internal position-feedback potentiometer physically
// removed — genuinely continuous now, speed set by deviation from 1500us.
#define PIN_SERVO          13
#define SERVO_STOP_US       1500   // pulse width that stops a 360 continuous-rotation servo
#define SERVO_FULL_CW_US    2500   // library's own absolute max (ESP32Servo.h MAX_PULSE_WIDTH)
#define SERVO_FULL_CCW_US   500    // library's own absolute min (ESP32Servo.h MIN_PULSE_WIDTH)

// Relay module cutting the servo's real power line (5-6V from its own
// supply, not from the ESP32) whenever it's not actively being driven. A
// bare GPIO can't power the servo directly — nowhere near enough current —
// so this pin only drives the relay's control input, which draws a few mA.
// Fixes slow creep at a not-quite-right "stop" pulse (see servoStopTrimUs
// in Settings.h) by removing the possibility entirely: no power, no motion.
// Most cheap relay modules are ACTIVE-LOW (LOW on IN = relay energized);
// a bare N-MOSFET switch module is the opposite (HIGH on gate = conducts) —
// this is wired for an N-MOS module (low-side, cutting the servo's ground
// return), hence false here. Flip back to true if you switch to a relay.
#define PIN_SERVO_POWER          23
#define SERVO_POWER_ACTIVE_LOW   false
#define SERVO_POWER_WARMUP_MS    150   // time after power-up before the servo reliably responds to PWM

// Limit switch (active LOW, pulled up) marking the presser-foot rack's zero
// position. The quadrature encoder has no memory of its own across a reboot
// (it just resets count to 0 wherever the rack happens to be sitting) — this
// switch is what gives "pressure step 0" a real, repeatable meaning. Which
// way the servo has to turn to reach it depends on how the mechanism was
// assembled, so that direction is a Settings field (pressureHomeClockwise),
// not hardcoded here.
#define PIN_LIMIT_PRESSURE_ZERO  27
#define HAS_LIMIT_PRESSURE_ZERO  true
#define PRESSURE_HOME_TIMEOUT_MS 8000

// Second limit switch at the OTHER end of the rack's travel (maximum
// pressure / most compressed spring). Together with PIN_LIMIT_PRESSURE_ZERO
// this bounds the rack mechanically on both ends. Each switch only blocks
// travel APPROACHING it (see pressureLimitBlocks() in Actuators.cpp) — a
// move deliberately heading away from a switch that's still tripped (e.g.
// right after homing, while the zero switch is still pressed) is allowed.
#define PIN_LIMIT_PRESSURE_MAX   19
// Temporarily false: the physical switch isn't wired to this pin yet, so
// INPUT_PULLUP leaves it floating — its weak internal pull-up can pick up
// noise from nearby motor/MOSFET switching and read a false trip, instantly
// stopping the servo for no real reason. Flip back to true once the switch
// is actually wired (GND on press, same as the zero switch).
#define HAS_LIMIT_PRESSURE_MAX   false

// Manual Test-screen taps now run until the requested duration, a pressure
// limit switch, or an explicit /api/stop — this is a hard backstop in case
// neither of those happens (e.g. a switch isn't wired yet), not a normal
// operating limit like the old 3-second cap was.
#define SERVO_MANUAL_MAX_DURATION_MS 120000

// Closed-loop move (/api/test/servo/move, the automatic cycle, the sweep)
// stops on whichever comes first: target reached on the external rack
// encoder, a limit switch in the direction of travel, encoder STALL (servo
// powered but the encoder isn't counting — rack jammed, encoder unplugged,
// or not coupled to the lead screw), encoder counting the WRONG WAY (see
// Settings::encoderReversed), or this overall backstop. Stall detection is
// what makes a long backstop safe: it no longer has to be ~2s to keep a
// blind spin short, so a long move finishes in one tap instead of several.
#define SERVO_MOVE_STEP_TIMEOUT_MS     30000
#define SERVO_STALL_TIMEOUT_MS         600   // no encoder progress for this long while driving -> stop
#define SERVO_STALL_MIN_COUNTS         3     // encoder change that counts as "still moving"
#define SERVO_WRONG_DIR_COUNTS         40    // moved this far AWAY from the target -> stop (encoder direction reversed)
#define SERVO_TARGET_TOLERANCE_COUNTS  4     // "reached" when within this many counts of the target

// Speed profile near the target (continuous-rotation servo: speed is the
// pulse's distance from the stop pulse). Full speed far away, slowing
// linearly inside the slow zone down to MIN — which must stay above the
// servo's own dead band, or it stops short and reports "stall".
#define SERVO_FULL_SPEED_US            1000  // 1500 +/- 1000 -> 2500/500us, same as before
#define SERVO_MIN_SPEED_US             150
#define SERVO_SLOW_ZONE_COUNTS         400

// Ultrasound/force resonance sweep ("авто-свип") — the real alternative to
// a guessed frequency<->force formula: automatically moves to each
// requested rack position, steps the ultrasound frequency across a range
// at each one, and records the current-sense ADC response, so the actual
// dependency can be read off real measurements on this machine. See Sweep.h.
#define SWEEP_MAX_POSITIONS        10
#define SWEEP_MAX_POINTS           600
#define SWEEP_SETTLE_AFTER_MOVE_MS 300

// ---- DC motor + driver (raises/lowers the microscope head) ----
// Two-pin PWM driver (DRV8871 / TB6612-style): drive one pin high+PWM, other low, for each direction.
#define PIN_MOTOR_IN1      25
#define PIN_MOTOR_IN2      26
#define PIN_MOTOR_PWM_FREQ  20000
#define PIN_MOTOR_PWM_RES   8      // bits
#define MOTOR_PWM_DUTY      200    // 0..255, tuned for the weak DC motor in use

// Optional top limit switch (active LOW, pulled up) confirming "fully raised".
// If not wired, raising falls back to a fixed duration from settings.
#define PIN_LIMIT_UP        14
#define HAS_LIMIT_UP_SWITCH true

// ---- Electromagnet ultrasound driver (MOSFET gate + parallel LC tank) ----
#define PIN_ULTRASOUND_GATE  32
#define PIN_CURRENT_SENSE    33   // ADC1 channel, shunt across the MOSFET source for resonance tracking
#define ULTRASOUND_PWM_RES_BITS 8
#define ULTRASOUND_DUTY_PERCENT 50   // symmetric drive into the LC tank

// ---- Safety timeouts (never let a motor run forever if a sensor goes silent) ----
#define LOWER_SCOPE_TIMEOUT_MS   8000
#define ANALYSIS_TIMEOUT_MS      20000
#define PRESSURE_ADJUST_TIMEOUT_MS 5000

// ---- NVS namespace for persisted calibration ----
#define PREFS_NAMESPACE "fscope"
