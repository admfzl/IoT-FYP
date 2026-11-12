/**
 * Smart Fish Feeder — ESP32 Webhook Client Example (FYP II Partner Integration)
 *
 * Demonstrates the two-step webhook contract:
 *   1. Record t0 = millis() at the moment of trigger and POST /api/feed
 *   2. Record t1 = millis() on response and POST /api/feed/rtt with { logId, clientRttMs }
 *
 * Note on TLS: Uses WiFiClientSecure::setInsecure() for prototype simplicity.
 * This is documented as a prototype limitation in Chapter 5.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---- Configure these values ----
const char* WIFI_SSID      = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";
const char* WORKER_BASE    = "https://fish-feeder.<your-subdomain>.workers.dev";
const char* FEED_API_TOKEN = "YOUR_SHARED_FEED_API_TOKEN";
const char* RUN_LABEL      = "esp32-wifi";

unsigned long lastTriggerMillis = 0;
const unsigned long LOCAL_COOLDOWN_MS = 5200;

// Minimal helper to parse integer "logId":123 from JSON response without external libraries
long extractLogId(const String& json) {
  int idx = json.indexOf("\"logId\":");
  if (idx < 0) return -1;
  int start = idx + 8;
  while (start < (int)json.length() && (json[start] == ' ')) start++;
  int end = start;
  while (end < (int)json.length() && isDigit(json[end])) end++;
  if (end == start) return -1;
  return json.substring(start, end).toInt();
}

void triggerFeedWithRtt(float vibrationG) {
  if (millis() - lastTriggerMillis < LOCAL_COOLDOWN_MS) {
    Serial.println("[SKIP] Local cooldown active.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Prototype limitation: skips CA chain verification

  HTTPClient https;
  String feedUrl = String(WORKER_BASE) + "/api/feed";

  String payload = String("{\"source\":\"ESP32_SENSOR\",\"vibrationG\":") +
                   String(vibrationG, 2) +
                   String(",\"runLabel\":\"") + String(RUN_LABEL) + String("\"}");

  // Step 1: Record t0 right before POST /api/feed
  unsigned long t0 = millis();

  if (!https.begin(client, feedUrl)) {
    Serial.println("[ERR] Unable to begin HTTPS connection to /api/feed");
    return;
  }

  https.addHeader("Content-Type", "application/json");
  https.addHeader("x-feed-token", FEED_API_TOKEN);

  int httpCode = https.POST(payload);
  unsigned long t1 = millis();
  unsigned long clientRttMs = t1 - t0;

  String responseBody = https.getString();
  https.end();

  Serial.printf("[FEED] HTTP %d (RTT=%lu ms): %s\n", httpCode, clientRttMs, responseBody.c_str());

  if (httpCode == 429) {
    Serial.println("[COOLDOWN] Server returned 429 cooldown.");
    lastTriggerMillis = millis();
    return;
  }

  if (httpCode != 200) {
    Serial.println("[ERR] Feed actuation failed on server.");
    return;
  }

  lastTriggerMillis = millis();

  // Step 2: Report clientRttMs to POST /api/feed/rtt
  long logId = extractLogId(responseBody);
  if (logId > 0 && clientRttMs > 0 && clientRttMs < 60000) {
    String rttUrl = String(WORKER_BASE) + "/api/feed/rtt";
    String rttPayload = String("{\"logId\":") + String(logId) +
                        String(",\"clientRttMs\":") + String(clientRttMs) + String("}");

    if (https.begin(client, rttUrl)) {
      https.addHeader("Content-Type", "application/json");
      https.addHeader("x-feed-token", FEED_API_TOKEN);
      int rttCode = https.POST(rttPayload);
      String rttResp = https.getString();
      https.end();
      Serial.printf("[RTT] HTTP %d: %s\n", rttCode, rttResp.c_str());
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  // Replace this serial test hook with your ADXL345 wave detection trigger condition:
  // e.g. if (waveDetected) { triggerFeedWithRtt(measuredDynamicG); }
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'f' || c == 'F') {
      Serial.println("Manual serial trigger -> sending ESP32_SENSOR webhook...");
      triggerFeedWithRtt(1.85f);
    }
  }
  delay(50);
}

