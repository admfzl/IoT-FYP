// ============================================================================
// Fish Feeder v2 — ESP32-S3 + ADXL345 Firmware (v2 Contract)
//
// Key v2 changes (§5.1 & §9):
// 1. Samples ADXL345 at 100 Hz on Core 1, summarizes 1-second windows
//    (mean ax, ay, az in m/s², mean & peak dynamic g), and posts a 2-sample
//    batch every 2 seconds to `POST /api/esp32/telemetry`.
// 2. Reuses a persistent `WiFiClientSecure` + `HTTPClient::setReuse(true)`
//    (TLS keep-alive) so feed triggers and telemetry do not pay a ~1,300 ms
//    TLS handshake penalty on every request.
// 3. Reads `GET /api/trigger-sources` every 60 seconds to sync `enabled`,
//    `threshold_g`, and `cooldown_seconds` for `ESP32_SENSOR` from the dashboard.
// 4. Fires `POST /api/feed` with `{ "source": "ESP32_SENSOR", "vibrationG": ... }`
//    and reports round-trip latency (`millis()` delta) to `POST /api/feed/rtt`
//    with `{ "feedEventId": ..., "clientRttMs": ... }`.
// 5. Respects HTTP 429 (cooldown) and HTTP 409 (source disabled) responses.
// ============================================================================

#include <WiFi.h>
#include <Wire.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <math.h>

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* SERVER_URL    = "https://iot-fyp.adam1410faizal.workers.dev";
const char* FEED_TOKEN    = "YOUR_FEED_API_TOKEN";
const char* DEVICE_ID     = "esp32-s3-1";
const char* FIRMWARE_VER  = "2.0.0";

#define SDA_PIN 8
#define SCL_PIN 9
#define ADXL345_ADDR 0x53

#define POWER_CTL   0x2D
#define DATA_FORMAT 0x31
#define BW_RATE     0x2C
#define DATAX0      0x32

// 100 Hz sampling (10 ms interval)
const uint32_t SAMPLE_INTERVAL_US = 10000;

// Runtime config synced from GET /api/trigger-sources every 60 s
volatile bool     cfgEnabled    = true;
volatile float    cfgThresholdG = 0.30f;
volatile uint32_t cfgCooldownMs = 5000;

// Gravity low-pass filter state
float gravityX = 0, gravityY = 0, gravityZ = 0;
bool  gravityInitialized = false;

// 1-second accumulator on Core 1
struct OneSecSummary {
  uint32_t offsetMs;
  float ax;
  float ay;
  float az;
  float gMean;
  float gPeak;
};

portMUX_TYPE summaryMux = portMUX_INITIALIZER_UNLOCKED;
OneSecSummary batchBuffer[2];
volatile int  batchCount = 0;

float accAxSum = 0, accAySum = 0, accAzSum = 0, accGMeanSum = 0, accGPeak = 0;
uint32_t accSamples = 0;
uint32_t windowStartMs = 0;
uint32_t batchStartMs  = 0;

// Trigger queue
volatile bool  pendingTrigger  = false;
volatile float pendingTriggerG = 0;
uint32_t lastTriggerMs = 0;

// Persistent TLS client for HTTP keep-alive (§9)
WiFiClientSecure tlsClient;
HTTPClient       http;

bool writeReg(byte reg, byte val) {
  Wire.beginTransmission(ADXL345_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool readAccel(float &x, float &y, float &z) {
  Wire.beginTransmission(ADXL345_ADDR);
  Wire.write(DATAX0);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(ADXL345_ADDR, 6) != 6) return false;
  int16_t rx = Wire.read() | (Wire.read() << 8);
  int16_t ry = Wire.read() | (Wire.read() << 8);
  int16_t rz = Wire.read() | (Wire.read() << 8);
  const float scale = 0.0039f * 9.80665f;
  x = rx * scale;
  y = ry * scale;
  z = rz * scale;
  return true;
}

void initAdxl345() {
  writeReg(POWER_CTL, 0x00);
  writeReg(DATA_FORMAT, 0x0B);
  writeReg(BW_RATE, 0x0A);
  writeReg(POWER_CTL, 0x08);
}

long extractJsonInt(const String &json, const char *key, long fallback = -1) {
  String pat = String("\"") + key + "\":";
  int idx = json.indexOf(pat);
  if (idx < 0) return fallback;
  idx += pat.length();
  while (idx < (int)json.length() && json[idx] == ' ') idx++;
  if (idx >= (int)json.length() || (!isDigit(json[idx]) && json[idx] != '-')) return fallback;
  return json.substring(idx).toInt();
}

// Persistent HTTPS POST helper with connection reuse
int postJsonKeepAlive(const String &url, const String &body, String &respOut, uint32_t timeoutMs = 8000) {
  http.setTimeout(timeoutMs);
  http.setReuse(true);
  if (!http.begin(tlsClient, url)) {
    respOut = "http.begin failed";
    return -1;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "keep-alive");
  http.addHeader("x-feed-token", FEED_TOKEN);
  int code = http.POST(body);
  if (code > 0) {
    respOut = http.getString();
  } else {
    respOut = http.errorToString(code);
  }
  http.end();
  return code;
}

void syncConfigFromServer() {
  if (WiFi.status() != WL_CONNECTED) return;
  String url = String(SERVER_URL) + "/api/trigger-sources";
  http.setTimeout(5000);
  http.setReuse(true);
  if (!http.begin(tlsClient, url)) return;
  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    int espIdx = payload.indexOf("\"ESP32_SENSOR\"");
    if (espIdx >= 0) {
      String sub = payload.substring(espIdx, min((int)payload.length(), espIdx + 320));
      int enIdx = sub.indexOf("\"enabled\":");
      if (enIdx >= 0) {
        cfgEnabled = sub.substring(enIdx + 10, enIdx + 16).startsWith("true");
      }
      int thrIdx = sub.indexOf("\"threshold_g\":");
      if (thrIdx >= 0) {
        float t = sub.substring(thrIdx + 14).toFloat();
        if (t >= 0.05f && t <= 10.0f) cfgThresholdG = t;
      }
      int cdIdx = sub.indexOf("\"cooldown_seconds\":");
      if (cdIdx >= 0) {
        long cd = sub.substring(cdIdx + 19).toInt();
        if (cd >= 1 && cd <= 3600) cfgCooldownMs = (uint32_t)(cd * 1000);
      }
    }
  }
  http.end();
}

void sendFeedTrigger(float vibG) {
  String feedUrl = String(SERVER_URL) + "/api/feed";
  String body = String("{\"source\":\"ESP32_SENSOR\",\"vibrationG\":") + String(vibG, 3) + "}";
  String resp;

  uint32_t t0 = millis();
  int status = postJsonKeepAlive(feedUrl, body, resp, 10000);
  uint32_t clientRttMs = max(1UL, (unsigned long)(millis() - t0));

  if (status == 429) {
    long retryMs = extractJsonInt(resp, "retryAfterMs", cfgCooldownMs);
    lastTriggerMs = millis() - cfgCooldownMs + (uint32_t)retryMs;
    Serial.printf("[Feed] 429 cooldown (retry in %ld ms)\n", retryMs);
    return;
  }
  if (status == 409) {
    cfgEnabled = false;
    Serial.println("[Feed] 409 ESP32_SENSOR disabled in dashboard.");
    return;
  }

  long feedEventId = extractJsonInt(resp, "feedEventId", -1);
  if (feedEventId > 0) {
    String rttUrl = String(SERVER_URL) + "/api/feed/rtt";
    String rttBody = String("{\"feedEventId\":") + String(feedEventId) +
                     ",\"clientRttMs\":" + String(clientRttMs) + "}";
    String rttResp;
    postJsonKeepAlive(rttUrl, rttBody, rttResp, 5000);
  }
}

void sendTelemetryBatch(const OneSecSummary *items, int count) {
  if (count <= 0 || WiFi.status() != WL_CONNECTED) return;

  String body = "{";
  body += String("\"deviceId\":\"") + DEVICE_ID + "\",";
  body += String("\"rssi\":") + String(WiFi.RSSI()) + ",";
  body += String("\"firmware\":\"") + FIRMWARE_VER + "\",";
  body += String("\"ip\":\"") + WiFi.localIP().toString() + "\",";
  body += "\"samples\":[";
  for (int i = 0; i < count; i++) {
    if (i > 0) body += ",";
    body += "{";
    body += String("\"offsetMs\":") + String(items[i].offsetMs) + ",";
    body += String("\"ax\":") + String(items[i].ax, 4) + ",";
    body += String("\"ay\":") + String(items[i].ay, 4) + ",";
    body += String("\"az\":") + String(items[i].az, 4) + ",";
    body += String("\"gMean\":") + String(items[i].gMean, 4) + ",";
    body += String("\"gPeak\":") + String(items[i].gPeak, 4);
    body += "}";
  }
  body += "]}";

  String resp;
  int code = postJsonKeepAlive(String(SERVER_URL) + "/api/esp32/telemetry", body, resp, 4000);
  if (code >= 200 && code < 300) {
    int enIdx = resp.indexOf("\"enabled\":");
    if (enIdx >= 0) {
      cfgEnabled = resp.substring(enIdx + 10, enIdx + 16).startsWith("true");
    }
    int thrIdx = resp.indexOf("\"thresholdG\":");
    if (thrIdx >= 0) {
      float t = resp.substring(thrIdx + 13).toFloat();
      if (t >= 0.01f && t <= 16.0f) cfgThresholdG = t;
    }
    long cdMs = extractJsonInt(resp, "cooldownMs", -1);
    if (cdMs >= 500 && cdMs <= 3600000L) {
      cfgCooldownMs = (uint32_t)cdMs;
    }
  }
}

void networkTask(void *param) {
  tlsClient.setInsecure();
  uint32_t lastConfigSyncMs = 0;

  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      // 1. Trigger requests always go first so a feed is never delayed behind telemetry
      if (pendingTrigger) {
        float g = pendingTriggerG;
        pendingTrigger = false;
        sendFeedTrigger(g);
      }

      // 2. Send 2-second telemetry batch if ready
      OneSecSummary localCopy[2];
      int toSend = 0;
      portENTER_CRITICAL(&summaryMux);
      if (batchCount >= 2) {
        localCopy[0] = batchBuffer[0];
        localCopy[1] = batchBuffer[1];
        toSend = 2;
        batchCount = 0;
      }
      portEXIT_CRITICAL(&summaryMux);

      if (toSend > 0) {
        sendTelemetryBatch(localCopy, toSend);
      }

      // 3. Sync threshold and enabled state every 60 s
      if (millis() - lastConfigSyncMs >= 60000 || lastConfigSyncMs == 0) {
        lastConfigSyncMs = millis();
        syncConfigFromServer();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);
  initAdxl345();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
  }

  windowStartMs = millis();
  batchStartMs  = windowStartMs;

  xTaskCreatePinnedToCore(networkTask, "NetWorker", 12288, nullptr, 1, nullptr, 0);
}

void loop() {
  static uint32_t nextMicros = micros();
  uint32_t nowUs = micros();
  if ((int32_t)(nowUs - nextMicros) >= 0) {
    nextMicros += SAMPLE_INTERVAL_US;

    float x, y, z;
    if (readAccel(x, y, z)) {
      if (!gravityInitialized) {
        gravityX = x; gravityY = y; gravityZ = z;
        gravityInitialized = true;
      } else {
        gravityX = 0.9f * gravityX + 0.1f * x;
        gravityY = 0.9f * gravityY + 0.1f * y;
        gravityZ = 0.9f * gravityZ + 0.1f * z;
      }
      float lx = x - gravityX;
      float ly = y - gravityY;
      float lz = z - gravityZ;
      float dynG = sqrtf(lx * lx + ly * ly + lz * lz) / 9.80665f;

      accAxSum += x;
      accAySum += y;
      accAzSum += z;
      accGMeanSum += dynG;
      if (dynG > accGPeak) accGPeak = dynG;
      accSamples++;

      uint32_t nowMs = millis();
      if (cfgEnabled && !pendingTrigger && dynG >= cfgThresholdG &&
          (nowMs - lastTriggerMs >= cfgCooldownMs)) {
        lastTriggerMs = nowMs;
        pendingTriggerG = dynG;
        pendingTrigger = true;
      }

      // Every 1000 ms, push one summary into the 2-second batch buffer
      if (nowMs - windowStartMs >= 1000 && accSamples > 0) {
        OneSecSummary s;
        s.ax = accAxSum / accSamples;
        s.ay = accAySum / accSamples;
        s.az = accAzSum / accSamples;
        s.gMean = accGMeanSum / accSamples;
        s.gPeak = accGPeak;

        portENTER_CRITICAL(&summaryMux);
        if (batchCount == 0) batchStartMs = windowStartMs;
        s.offsetMs = windowStartMs - batchStartMs;
        if (batchCount < 2) {
          batchBuffer[batchCount++] = s;
        }
        portEXIT_CRITICAL(&summaryMux);

        accAxSum = accAySum = accAzSum = accGMeanSum = accGPeak = 0;
        accSamples = 0;
        windowStartMs = nowMs;
      }
    }
  }
}

