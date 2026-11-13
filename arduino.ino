#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <math.h>

// ========================================
// WIFI CONFIGURATION
// ========================================

const char* WIFI_SSID = "me broke";
const char* WIFI_PASSWORD = "N0_Th1ng";

// ========================================
// DEFAULT NEXT.JS / CLOUDFLARE SERVER CONFIG
// (Can also be updated live in the ESP32 Web UI at http://<ESP32_IP>/ without reflashing)
// ========================================
// Local PC Wi-Fi IP:      http://172.20.80.178:3000
// Windows Mobile Hotspot: http://192.168.137.1:3000
// Cloudflare Workers:     https://fish-feeder.<your-subdomain>.workers.dev

const char* DEFAULT_SERVER_URL = "http://172.20.80.178:3000";
const char* DEFAULT_FEED_TOKEN = "fyp2-5a65c3f277e544e889e9a75281f6e6b6";
const char* DEFAULT_RUN_LABEL  = "esp32-wifi";
const float DEFAULT_THRESHOLD_G = 0.30f;
const uint32_t DEFAULT_COOLDOWN_MS = 5000;

// Runtime settings (persisted in ESP32 NVS Preferences)
Preferences prefs;
String cfgServerUrl   = DEFAULT_SERVER_URL;
String cfgFeedToken   = DEFAULT_FEED_TOKEN;
String cfgRunLabel    = DEFAULT_RUN_LABEL;
float  cfgThresholdG  = DEFAULT_THRESHOLD_G;
uint32_t cfgCooldownMs = DEFAULT_COOLDOWN_MS;
bool   cfgAutoTrigger = true;
bool   cfgPushTelemetry = true;

// ========================================
// ADXL345 CONFIGURATION
// ========================================

#define SDA_PIN 8
#define SCL_PIN 9
#define ADXL345_ADDR 0x53

#define POWER_CTL 0x2D
#define DATA_FORMAT 0x31
#define BW_RATE 0x2C
#define DATAX0 0x32

// Target sampling rate: 100 Hz
const uint32_t SAMPLE_INTERVAL_US = 10000;

// Store up to 12 seconds of samples
const int BUFFER_SIZE = 1200;

// Limit samples per HTTP response
const int BATCH_SIZE = 80;

struct Sample {
  uint32_t sequence;
  uint32_t timestamp_us;
  float x;
  float y;
  float z;
};

Sample samples[BUFFER_SIZE];

volatile uint32_t nextSequence = 0;
uint32_t nextSampleTime = 0;
volatile uint32_t sensorErrors = 0;

volatile float latestX = 0;
volatile float latestY = 0;
volatile float latestZ = 0;
volatile float latestDynamicG = 0;
volatile float latestRawTotalG = 0;
volatile bool hasReading = false;

// Low-pass gravity filter state (matches /sensor phone logic)
float gravityX = 0;
float gravityY = 0;
float gravityZ = 0;
bool gravityInitialized = false;

// Trigger & Telemetry tracking
volatile bool pendingFeedTrigger = false;
volatile float pendingTriggerG = 0;
uint32_t lastTriggerQueuedMs = 0;

String lastTriggerStatus = "Idle (no triggers fired yet)";
int32_t lastTriggerRttMs = -1;
int32_t lastServerTotalMs = -1;
int32_t lastTuyaApiMs = -1;
int32_t lastLogId = -1;
uint32_t totalTriggersSent = 0;
String lastTelemetryStatus = "Waiting...";

WebServer server(80);

// ========================================
// NVS PREFERENCES LOAD / SAVE
// ========================================

void loadSettings() {
  prefs.begin("fyp-esp32", true);
  cfgServerUrl = prefs.getString("serverUrl", DEFAULT_SERVER_URL);
  cfgFeedToken = prefs.getString("feedToken", DEFAULT_FEED_TOKEN);
  cfgRunLabel = prefs.getString("runLabel", DEFAULT_RUN_LABEL);
  cfgThresholdG = prefs.getFloat("thresholdG", DEFAULT_THRESHOLD_G);
  cfgCooldownMs = prefs.getUInt("cooldownMs", DEFAULT_COOLDOWN_MS);
  cfgAutoTrigger = prefs.getBool("autoTrig", true);
  cfgPushTelemetry = prefs.getBool("pushTelem", true);
  prefs.end();

  // Trim trailing slash on serverUrl
  cfgServerUrl.trim();
  while (cfgServerUrl.endsWith("/")) {
    cfgServerUrl.remove(cfgServerUrl.length() - 1);
  }
}

void saveSettings() {
  cfgServerUrl.trim();
  while (cfgServerUrl.endsWith("/")) {
    cfgServerUrl.remove(cfgServerUrl.length() - 1);
  }
  cfgFeedToken.trim();
  cfgRunLabel.trim();

  prefs.begin("fyp-esp32", false);
  prefs.putString("serverUrl", cfgServerUrl);
  prefs.putString("feedToken", cfgFeedToken);
  prefs.putString("runLabel", cfgRunLabel);
  prefs.putFloat("thresholdG", cfgThresholdG);
  prefs.putUInt("cooldownMs", cfgCooldownMs);
  prefs.putBool("autoTrig", cfgAutoTrigger);
  prefs.putBool("pushTelem", cfgPushTelemetry);
  prefs.end();
}

// ========================================
// ADXL345 FUNCTIONS
// ========================================

bool writeRegister(byte reg, byte value) {
  Wire.beginTransmission(ADXL345_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readAcceleration(float &x, float &y, float &z) {
  Wire.beginTransmission(ADXL345_ADDR);
  Wire.write(DATAX0);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(ADXL345_ADDR, 6) != 6) {
    return false;
  }

  int16_t rawX = Wire.read() | (Wire.read() << 8);
  int16_t rawY = Wire.read() | (Wire.read() << 8);
  int16_t rawZ = Wire.read() | (Wire.read() << 8);

  const float scale = 0.0039f * 9.80665f;

  x = rawX * scale;
  y = rawY * scale;
  z = rawZ * scale;

  return true;
}

void initializeSensor() {
  writeRegister(POWER_CTL, 0x00);
  writeRegister(DATA_FORMAT, 0x0B);
  writeRegister(BW_RATE, 0x0A);
  writeRegister(POWER_CTL, 0x08);
}

// ========================================
// CONTINUOUS SAMPLING (100 Hz on Core 1)
// ========================================

void collectSample() {
  float x, y, z;

  // Capture actual acquisition time
  uint32_t timestamp = micros();

  if (!readAcceleration(x, y, z)) {
    sensorErrors++;
    return;
  }

  // Gravity removal via low-pass filter (identical to /sensor page)
  if (!gravityInitialized) {
    gravityX = x;
    gravityY = y;
    gravityZ = z;
    gravityInitialized = true;
  } else {
    gravityX = 0.9f * gravityX + 0.1f * x;
    gravityY = 0.9f * gravityY + 0.1f * y;
    gravityZ = 0.9f * gravityZ + 0.1f * z;
  }

  float linX = x - gravityX;
  float linY = y - gravityY;
  float linZ = z - gravityZ;

  float dynG = sqrtf(linX * linX + linY * linY + linZ * linZ) / 9.80665f;
  float rawG = sqrtf(x * x + y * y + z * z) / 9.80665f;

  uint32_t seq = nextSequence;
  int index = seq % BUFFER_SIZE;

  samples[index].sequence = seq;
  samples[index].timestamp_us = timestamp;
  samples[index].x = x;
  samples[index].y = y;
  samples[index].z = z;

  latestX = x;
  latestY = y;
  latestZ = z;
  latestDynamicG = dynG;
  latestRawTotalG = rawG;
  hasReading = true;

  nextSequence = seq + 1;

  // Check vibration threshold & cooldown for automatic ESP32_SENSOR trigger
  uint32_t nowMs = millis();
  if (cfgAutoTrigger &&
      !pendingFeedTrigger &&
      dynG >= cfgThresholdG &&
      (nowMs - lastTriggerQueuedMs >= cfgCooldownMs)) {
    lastTriggerQueuedMs = nowMs;
    pendingTriggerG = dynG;
    pendingFeedTrigger = true;
  }
}

// ========================================
// JSON PARSING HELPER (Zero External Deps)
// ========================================

long extractJsonInt(const String &json, const char *key, long defaultVal = -1) {
  String pattern = String("\"") + key + "\":";
  int idx = json.indexOf(pattern);
  if (idx < 0) return defaultVal;
  idx += pattern.length();
  while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == '\t')) {
    idx++;
  }
  if (idx >= (int)json.length()) return defaultVal;
  if (json.substring(idx, idx + 4) == "null") return defaultVal;

  long sign = 1;
  if (json[idx] == '-') {
    sign = -1;
    idx++;
  }
  if (idx >= (int)json.length() || !isDigit(json[idx])) return defaultVal;

  long val = 0;
  while (idx < (int)json.length() && isDigit(json[idx])) {
    val = val * 10 + (json[idx] - '0');
    idx++;
  }
  return val * sign;
}

// ========================================
// HTTP / HTTPS POST HELPER
// Works with both local http://...:3000 and https://*.workers.dev
// ========================================

int sendJsonPost(const String &fullUrl, const String &token, const String &jsonBody, String &responseOut, uint32_t timeoutMs = 8000) {
  HTTPClient http;
  http.setTimeout(timeoutMs);

  bool isHttps = fullUrl.startsWith("https://");
  int httpCode = -1;

  if (isHttps) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure(); // Skip CA pin check for Cloudflare Workers TLS
    if (!http.begin(secureClient, fullUrl)) {
      responseOut = "http.begin(HTTPS) failed";
      return -1;
    }
    http.addHeader("Content-Type", "application/json");
    if (token.length() > 0) {
      http.addHeader("x-feed-token", token);
    }
    httpCode = http.POST(jsonBody);
    if (httpCode > 0) {
      responseOut = http.getString();
    } else {
      responseOut = http.errorToString(httpCode);
    }
    http.end();
  } else {
    WiFiClient plainClient;
    if (!http.begin(plainClient, fullUrl)) {
      responseOut = "http.begin(HTTP) failed";
      return -1;
    }
    http.addHeader("Content-Type", "application/json");
    if (token.length() > 0) {
      http.addHeader("x-feed-token", token);
    }
    httpCode = http.POST(jsonBody);
    if (httpCode > 0) {
      responseOut = http.getString();
    } else {
      responseOut = http.errorToString(httpCode);
    }
    http.end();
  }

  return httpCode;
}

// ========================================
// SEND ESP32_SENSOR FEED TRIGGER + RTT
// ========================================

void executeEsp32FeedTrigger(float vibG) {
  if (WiFi.status() != WL_CONNECTED || cfgServerUrl.length() == 0) {
    lastTriggerStatus = "Skipped: WiFi disconnected or empty Server URL";
    return;
  }

  float safeG = vibG > 0.001f ? vibG : 0.01f;
  String feedUrl = cfgServerUrl + "/api/feed";
  String body = "{";
  body += "\"source\":\"ESP32_SENSOR\",";
  body += "\"vibrationG\":" + String(safeG, 3) + ",";
  body += "\"runLabel\":\"" + cfgRunLabel + "\"";
  body += "}";

  Serial.printf("[ESP32->Server] POST %s | vibG=%.3f\n", feedUrl.c_str(), safeG);

  String resp;
  uint32_t t0 = millis();
  int status = sendJsonPost(feedUrl, cfgFeedToken, body, resp, 10000);
  uint32_t rttMs = millis() - t0;
  if (rttMs == 0) rttMs = 1;

  if (status <= 0) {
    lastTriggerStatus = "ERR (" + String(status) + "): " + resp;
    Serial.println("[ESP32->Server] Feed Error: " + lastTriggerStatus);
    return;
  }

  if (status == 429) {
    long retryMs = extractJsonInt(resp, "retryAfterMs", 5000);
    lastTriggerRttMs = rttMs;
    lastTriggerStatus = "429 Cooldown (retry " + String(retryMs) + " ms)";
    Serial.println("[ESP32->Server] " + lastTriggerStatus);
    return;
  }

  long logId = extractJsonInt(resp, "logId", -1);
  long serverTotalMs = extractJsonInt(resp, "serverTotalMs", -1);
  long tuyaApiMs = extractJsonInt(resp, "tuyaApiMs", -1);

  lastTriggerRttMs = rttMs;
  lastServerTotalMs = serverTotalMs;
  lastTuyaApiMs = tuyaApiMs;
  lastLogId = logId;
  totalTriggersSent++;

  // Report clientRttMs to POST /api/feed/rtt if logId was returned
  if (logId > 0) {
    String rttUrl = cfgServerUrl + "/api/feed/rtt";
    String rttBody = "{\"logId\":" + String(logId) + ",\"clientRttMs\":" + String(rttMs) + "}";
    String rttResp;
    int rttStatus = sendJsonPost(rttUrl, cfgFeedToken, rttBody, rttResp, 5000);
    Serial.printf("[ESP32->Server] POST /api/feed/rtt (logId=%ld, rtt=%lu ms) -> HTTP %d\n",
                  logId, (unsigned long)rttMs, rttStatus);
  }

  if (status >= 200 && status < 300) {
    lastTriggerStatus = "OK #" + String(logId) + " | RTT " + String(rttMs) + "ms | Srv " + String(serverTotalMs) + "ms";
  } else {
    lastTriggerStatus = "HTTP " + String(status) + " (#" + String(logId) + ")";
  }
  Serial.println("[ESP32->Server] Result: " + lastTriggerStatus);
}

// ========================================
// SEND LIVE TELEMETRY TO NEXT.JS APP
// ========================================

void sendTelemetryHeartbeat() {
  if (!hasReading || WiFi.status() != WL_CONNECTED || cfgServerUrl.length() == 0) {
    return;
  }

  String telemUrl = cfgServerUrl + "/api/esp32/telemetry";
  String body = "{";
  body += "\"x\":" + String(latestX, 4) + ",";
  body += "\"y\":" + String(latestY, 4) + ",";
  body += "\"z\":" + String(latestZ, 4) + ",";
  body += "\"dynamicG\":" + String(latestDynamicG, 3) + ",";
  body += "\"rawTotalG\":" + String(latestRawTotalG, 3) + ",";
  body += "\"thresholdG\":" + String(cfgThresholdG, 2) + ",";
  body += "\"sequence\":" + String(nextSequence) + ",";
  body += "\"sensorErrors\":" + String(sensorErrors) + ",";
  body += "\"espIp\":\"" + WiFi.localIP().toString() + "\",";
  body += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  body += "\"autoTrigger\":" + String(cfgAutoTrigger ? "true" : "false") + ",";
  body += "\"runLabel\":\"" + cfgRunLabel + "\",";
  body += "\"lastTriggerStatus\":\"" + lastTriggerStatus + "\",";
  body += "\"lastTriggerRttMs\":" + (lastTriggerRttMs > 0 ? String(lastTriggerRttMs) : String("null"));
  body += "}";

  String resp;
  int code = sendJsonPost(telemUrl, cfgFeedToken, body, resp, 2500);
  if (code >= 200 && code < 300) {
    lastTelemetryStatus = "OK (HTTP " + String(code) + ")";
  } else {
    lastTelemetryStatus = "ERR (" + String(code) + ") -> Check Server URL";
  }
}

// ========================================
// BACKGROUND NETWORK TASK (Core 0)
// Keeps 100 Hz ADXL345 sampling on Core 1 completely unblocked!
// ========================================

void networkWorkerTask(void *parameter) {
  uint32_t lastTelemetryMs = 0;

  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      // 1. High priority: send feed trigger if queued
      if (pendingFeedTrigger) {
        float trigG = pendingTriggerG;
        pendingFeedTrigger = false;
        executeEsp32FeedTrigger(trigG);
        // Immediately push updated telemetry after trigger
        if (cfgPushTelemetry) {
          sendTelemetryHeartbeat();
          lastTelemetryMs = millis();
        }
      }

      // 2. Periodic live telemetry push every 1000 ms
      if (cfgPushTelemetry && (millis() - lastTelemetryMs >= 1000)) {
        lastTelemetryMs = millis();
        sendTelemetryHeartbeat();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(25));
  }
}

// ========================================
// WIFI CONNECTION
// ========================================

bool connectWiFi() {
  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi connected!");
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Target Next.js / Cloudflare URL: ");
    Serial.println(cfgServerUrl);
    return true;
  }

  Serial.println();
  Serial.println("WiFi connection failed.");
  return false;
}

// ========================================
// CORS HELPER
// ========================================

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, x-feed-token");
}

void handleOptions() {
  addCorsHeaders();
  server.send(204);
}

// ========================================
// WEB DASHBOARD ON ESP32 (http://<ESP32_IP>/)
// ========================================

const char webpage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESP32-S3 Water-Surface Monitor & Webhook</title>
<style>
body {
  font-family: system-ui, -apple-system, Arial, sans-serif;
  background: #0f172a;
  color: #f8fafc;
  margin: 0;
  padding: 20px;
}
.container {
  max-width: 680px;
  margin: 0 auto;
}
h1 { font-size: 22px; margin-bottom: 4px; }
.sub { color: #94a3b8; font-size: 13px; margin-top: 0; margin-bottom: 18px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.card {
  background: #1e293b;
  border: 1px solid #334155;
  padding: 14px;
  border-radius: 12px;
  text-align: center;
}
.card h3 { margin: 0 0 6px 0; font-size: 12px; color: #94a3b8; text-transform: uppercase; }
.value { font-size: 24px; font-weight: bold; color: #38bdf8; font-family: monospace; }
.value.vib { color: #10b981; }
.unit { font-size: 11px; color: #64748b; margin-top: 4px; }
.panel {
  background: #1e293b;
  border: 1px solid #334155;
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 16px;
}
.panel h2 { margin: 0 0 12px 0; font-size: 16px; }
label { display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px; margin-top: 10px; }
input[type="text"], input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
  font-family: monospace;
  font-size: 13px;
}
.row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
button {
  padding: 9px 14px;
  border-radius: 8px;
  border: none;
  font-weight: bold;
  font-size: 13px;
  cursor: pointer;
}
.btn-primary { background: #0284c7; color: white; }
.btn-trigger { background: #10b981; color: #052e16; }
.btn-preset { background: #334155; color: #e2e8f0; font-size: 11px; padding: 6px 10px; }
.status-box {
  font-family: monospace;
  font-size: 12px;
  background: #0f172a;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #334155;
  margin-top: 8px;
}
</style>
</head>
<body>
<div class="container">
  <h1>ESP32-S3 + ADXL345 Water-Surface Monitor</h1>
  <p class="sub">100 Hz Sampling • Gravity-Removed Vibration Trigger • Local &amp; Cloudflare Workers Ready</p>

  <div class="grid">
    <div class="card">
      <h3>Dynamic Vib</h3>
      <div class="value vib" id="dynG">--</div>
      <div class="unit">g (gravity removed)</div>
    </div>
    <div class="card">
      <h3>X-Axis</h3>
      <div class="value" id="x">--</div>
      <div class="unit">m/s²</div>
    </div>
    <div class="card">
      <h3>Y-Axis</h3>
      <div class="value" id="y">--</div>
      <div class="unit">m/s²</div>
    </div>
    <div class="card">
      <h3>Z-Axis</h3>
      <div class="value" id="z">--</div>
      <div class="unit">m/s²</div>
    </div>
  </div>

  <div class="panel">
    <h2>Webhook &amp; Telemetry Status</h2>
    <div class="status-box">
      <div><strong>Telemetry Stream:</strong> <span id="telemStatus">--</span></div>
      <div style="margin-top:4px;"><strong>Last Feed Trigger:</strong> <span id="trigStatus">--</span></div>
      <div style="margin-top:4px;"><strong>Total Triggers Sent:</strong> <span id="trigCount">0</span> | <strong>Sample Seq:</strong> <span id="seq">0</span></div>
    </div>
    <div class="row">
      <button class="btn-trigger" onclick="fireTestTrigger()">Send Test Feed Trigger Now (ESP32_SENSOR)</button>
    </div>
  </div>

  <div class="panel">
    <h2>Target Server Configuration (Saved in Flash)</h2>
    <div class="row" style="margin-top:0; margin-bottom:8px;">
      <button class="btn-preset" onclick="setPreset('http://172.20.80.178:3000')">Preset: Local PC Wi-Fi (172.20.80.178:3000)</button>
      <button class="btn-preset" onclick="setPreset('http://192.168.137.1:3000')">Preset: Win Hotspot (192.168.137.1:3000)</button>
    </div>

    <label>Next.js Local or Cloudflare Workers URL (no trailing slash)</label>
    <input type="text" id="serverUrl" placeholder="https://fish-feeder.<subdomain>.workers.dev">

    <label>FEED_API_TOKEN (x-feed-token)</label>
    <input type="text" id="feedToken">

    <div class="row">
      <div style="flex:1; min-width:140px;">
        <label>Experiment run_label</label>
        <input type="text" id="runLabel" placeholder="esp32-wifi">
      </div>
      <div style="flex:1; min-width:120px;">
        <label>Trigger Threshold (g)</label>
        <input type="number" step="0.05" min="0.05" max="5.0" id="thresholdG">
      </div>
      <div style="flex:1; min-width:120px;">
        <label>Cooldown (ms)</label>
        <input type="number" step="500" min="1000" id="cooldownMs">
      </div>
    </div>

    <div class="row" style="align-items:center; margin-top:12px;">
      <label style="margin:0;"><input type="checkbox" id="autoTrigger"> Auto-Trigger on Vibration</label>
      <label style="margin:0;"><input type="checkbox" id="pushTelemetry"> Stream Live Telemetry (1 Hz)</label>
    </div>

    <div class="row">
      <button class="btn-primary" onclick="saveConfig()">Save Settings to ESP32</button>
      <span id="saveMsg" style="font-size:12px; color:#38bdf8; align-self:center;"></span>
    </div>
  </div>
</div>

<script>
let configLoaded = false;

function setPreset(url) {
  document.getElementById('serverUrl').value = url;
}

async function updateData() {
  try {
    const response = await fetch('/data');
    if (!response.ok) return;
    const data = await response.json();
    if (data.error) return;

    document.getElementById('x').innerText = data.x.toFixed(3);
    document.getElementById('y').innerText = data.y.toFixed(3);
    document.getElementById('z').innerText = data.z.toFixed(3);
    document.getElementById('dynG').innerText = (data.dynamicG || 0).toFixed(3);
    document.getElementById('seq').innerText = data.sequence;
    document.getElementById('telemStatus').innerText = data.lastTelemetryStatus || '--';
    document.getElementById('trigStatus').innerText = data.lastTriggerStatus || '--';
    document.getElementById('trigCount').innerText = data.totalTriggersSent || 0;

    if (!configLoaded && data.serverUrl !== undefined) {
      configLoaded = true;
      document.getElementById('serverUrl').value = data.serverUrl;
      document.getElementById('feedToken').value = data.feedToken;
      document.getElementById('runLabel').value = data.runLabel;
      document.getElementById('thresholdG').value = data.thresholdG;
      document.getElementById('cooldownMs').value = data.cooldownMs;
      document.getElementById('autoTrigger').checked = data.autoTrigger;
      document.getElementById('pushTelemetry').checked = data.pushTelemetry;
    }
  } catch (e) {}
}

async function saveConfig() {
  const msg = document.getElementById('saveMsg');
  msg.innerText = 'Saving...';
  const payload = {
    serverUrl: document.getElementById('serverUrl').value.trim(),
    feedToken: document.getElementById('feedToken').value.trim(),
    runLabel: document.getElementById('runLabel').value.trim(),
    thresholdG: parseFloat(document.getElementById('thresholdG').value),
    cooldownMs: parseInt(document.getElementById('cooldownMs').value, 10),
    autoTrigger: document.getElementById('autoTrigger').checked,
    pushTelemetry: document.getElementById('pushTelemetry').checked
  };
  try {
    const res = await fetch('/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      msg.innerText = 'Saved! Sending to ' + payload.serverUrl;
    } else {
      msg.innerText = 'Save failed';
    }
  } catch (e) {
    msg.innerText = 'Error saving';
  }
}

async function fireTestTrigger() {
  await fetch('/trigger', { method: 'POST' });
  setTimeout(updateData, 300);
}

setInterval(updateData, 500);
updateData();
</script>
</body>
</html>
)rawliteral";

void handleRoot() {
  addCorsHeaders();
  server.send_P(200, "text/html", webpage);
}

void handleData() {
  addCorsHeaders();
  if (!hasReading) {
    server.send(503, "application/json",
                "{\"error\":\"No sensor readings\"}");
    return;
  }

  String json = "{";
  json += "\"x\":" + String(latestX, 4) + ",";
  json += "\"y\":" + String(latestY, 4) + ",";
  json += "\"z\":" + String(latestZ, 4) + ",";
  json += "\"dynamicG\":" + String(latestDynamicG, 4) + ",";
  json += "\"rawTotalG\":" + String(latestRawTotalG, 4) + ",";
  json += "\"thresholdG\":" + String(cfgThresholdG, 2) + ",";
  json += "\"sequence\":" + String(nextSequence) + ",";
  json += "\"sensorErrors\":" + String(sensorErrors) + ",";
  json += "\"serverUrl\":\"" + cfgServerUrl + "\",";
  json += "\"feedToken\":\"" + cfgFeedToken + "\",";
  json += "\"runLabel\":\"" + cfgRunLabel + "\",";
  json += "\"cooldownMs\":" + String(cfgCooldownMs) + ",";
  json += "\"autoTrigger\":" + String(cfgAutoTrigger ? "true" : "false") + ",";
  json += "\"pushTelemetry\":" + String(cfgPushTelemetry ? "true" : "false") + ",";
  json += "\"lastTriggerStatus\":\"" + lastTriggerStatus + "\",";
  json += "\"lastTelemetryStatus\":\"" + lastTelemetryStatus + "\",";
  json += "\"totalTriggersSent\":" + String(totalTriggersSent);
  json += "}";

  server.send(200, "application/json", json);
}

// ========================================
// CONFIG & MANUAL TRIGGER ENDPOINTS ON ESP32
// ========================================

String extractJsonString(const String &json, const char *key, const String &defaultVal) {
  String pattern = String("\"") + key + "\":\"";
  int idx = json.indexOf(pattern);
  if (idx < 0) return defaultVal;
  idx += pattern.length();
  int endIdx = json.indexOf("\"", idx);
  if (endIdx < 0) return defaultVal;
  return json.substring(idx, endIdx);
}

float extractJsonFloat(const String &json, const char *key, float defaultVal) {
  String pattern = String("\"") + key + "\":";
  int idx = json.indexOf(pattern);
  if (idx < 0) return defaultVal;
  idx += pattern.length();
  while (idx < (int)json.length() && json[idx] == ' ') idx++;
  return json.substring(idx).toFloat();
}

bool extractJsonBool(const String &json, const char *key, bool defaultVal) {
  String pattern = String("\"") + key + "\":";
  int idx = json.indexOf(pattern);
  if (idx < 0) return defaultVal;
  idx += pattern.length();
  while (idx < (int)json.length() && json[idx] == ' ') idx++;
  if (json.substring(idx, idx + 4) == "true") return true;
  if (json.substring(idx, idx + 5) == "false") return false;
  return defaultVal;
}

void handleConfigPost() {
  addCorsHeaders();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }
  String body = server.arg("plain");
  cfgServerUrl = extractJsonString(body, "serverUrl", cfgServerUrl);
  cfgFeedToken = extractJsonString(body, "feedToken", cfgFeedToken);
  cfgRunLabel  = extractJsonString(body, "runLabel", cfgRunLabel);
  float thr    = extractJsonFloat(body, "thresholdG", cfgThresholdG);
  if (thr >= 0.02f && thr <= 10.0f) cfgThresholdG = thr;
  long cd      = extractJsonInt(body, "cooldownMs", cfgCooldownMs);
  if (cd >= 500 && cd <= 120000) cfgCooldownMs = (uint32_t)cd;
  cfgAutoTrigger = extractJsonBool(body, "autoTrigger", cfgAutoTrigger);
  cfgPushTelemetry = extractJsonBool(body, "pushTelemetry", cfgPushTelemetry);

  saveSettings();
  Serial.println("[ESP32 Config Updated] Target Server: " + cfgServerUrl);
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleManualTrigger() {
  addCorsHeaders();
  float trigG = latestDynamicG >= cfgThresholdG ? latestDynamicG : cfgThresholdG;
  pendingTriggerG = trigG;
  lastTriggerQueuedMs = millis();
  pendingFeedTrigger = true;
  server.send(200, "application/json", "{\"queued\":true}");
}

// ========================================
// BATCH DATA ENDPOINT
// ========================================

void handleBatch() {
  addCorsHeaders();
  uint32_t requested = 0;

  if (server.hasArg("from")) {
    requested = strtoul(
      server.arg("from").c_str(), nullptr, 10
    );
  }

  uint32_t currentSeq = nextSequence;
  uint32_t oldest = 0;

  if (currentSeq > BUFFER_SIZE) {
    oldest = currentSeq - BUFFER_SIZE;
  }

  uint32_t lost = 0;

  if (requested < oldest) {
    lost = oldest - requested;
    requested = oldest;
  }

  if (requested > currentSeq) {
    requested = currentSeq;
  }

  uint32_t endSequence = requested + BATCH_SIZE;

  if (endSequence > currentSeq) {
    endSequence = currentSeq;
  }

  String json;
  json.reserve(7000);

  json = "{";
  json += "\"lost\":" + String(lost) + ",";
  json += "\"sensor_errors\":" + String(sensorErrors) + ",";
  json += "\"next\":" + String(endSequence) + ",";
  json += "\"samples\":[";

  bool first = true;

  for (uint32_t seq = requested;
       seq < endSequence; seq++) {

    Sample &s = samples[seq % BUFFER_SIZE];

    if (!first) {
      json += ",";
    }
    first = false;

    json += "[";
    json += String(s.sequence);
    json += ",";
    json += String(s.timestamp_us);
    json += ",";
    json += String(s.x, 5);
    json += ",";
    json += String(s.y, 5);
    json += ",";
    json += String(s.z, 5);
    json += "]";
  }

  json += "]}";

  server.send(200, "application/json", json);
}

// ========================================
// SETUP
// ========================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  loadSettings();

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  initializeSensor();

  // Begin acquisition before Wi-Fi setup
  nextSampleTime = micros();

  connectWiFi();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/data", HTTP_GET, handleData);
  server.on("/batch", HTTP_GET, handleBatch);
  server.on("/config", HTTP_POST, handleConfigPost);
  server.on("/config", HTTP_OPTIONS, handleOptions);
  server.on("/trigger", HTTP_POST, handleManualTrigger);
  server.on("/trigger", HTTP_OPTIONS, handleOptions);

  server.begin();

  // Start background network task on Core 0 so HTTP/HTTPS calls never block 100 Hz sampling
  xTaskCreatePinnedToCore(
    networkWorkerTask,
    "NetworkWorker",
    12288, // 12 KB stack for TLS / WiFiClientSecure
    nullptr,
    1,
    nullptr,
    0
  );

  Serial.println("HTTP server & background webhook worker started.");
  Serial.println("Sampling target: 100 Hz");
}

// ========================================
// MAIN LOOP (100 Hz Sensor Sampling on Core 1)
// ========================================

void loop() {
  uint32_t now = micros();

  if ((int32_t)(now - nextSampleTime) >= 0) {
    collectSample();

    nextSampleTime += SAMPLE_INTERVAL_US;

    // If delayed, skip missed sampling slots.
    if ((int32_t)(micros() - nextSampleTime) >= 0) {
      nextSampleTime =
        micros() + SAMPLE_INTERVAL_US;
    }
  }

  server.handleClient();

  // Reconnect if the hotspot drops
  static unsigned long lastReconnect = 0;

  if (WiFi.status() != WL_CONNECTED &&
      millis() - lastReconnect > 5000) {
    lastReconnect = millis();
    WiFi.reconnect();
  }
}
