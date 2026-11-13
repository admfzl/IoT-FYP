import "server-only";
import type { TuyaEndpoint } from "./supabase";

const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

interface CachedTuyaToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedTuyaToken | null = null;

export interface FeedOnceResult {
  success: boolean;
  endpoint: TuyaEndpoint | null;
  tuyaApiMs: number | null;
  tokenRefreshed: boolean;
  error?: string;
}

interface TuyaResponse<T = unknown> {
  success?: boolean;
  code?: number;
  msg?: string;
  result?: T;
  t?: number;
}

function getTuyaConfig() {
  const clientId = process.env.TUYA_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.TUYA_CLIENT_SECRET?.trim() ?? "";
  const deviceId =
    process.env.TUYA_DEVICE_ID?.trim() || "a33d5216f7875b6d3er7kk";
  const baseUrl = (
    process.env.TUYA_BASE_URL?.trim() || "https://openapi-sg.iotbing.com"
  ).replace(/\/+$/, "");

  return { clientId, clientSecret, deviceId, baseUrl };
}

export function isTuyaConfigured(): boolean {
  const { clientId, clientSecret, deviceId, baseUrl } = getTuyaConfig();
  return Boolean(clientId && clientSecret && deviceId && baseUrl);
}

function bufferToHex(buffer: ArrayBuffer, uppercase = false): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return uppercase ? hex.toUpperCase() : hex.toLowerCase();
}

async function sha256LowerHex(input: string): Promise<string> {
  if (!input) {
    return EMPTY_BODY_SHA256;
  }
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return bufferToHex(digest, false);
}

async function hmacSha256UpperHex(
  secret: string,
  payload: string
): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(payload)
  );
  return bufferToHex(signature, true);
}

function canonicalizePathWithSortedQuery(pathAndQuery: string): string {
  const [pathname, rawQuery] = pathAndQuery.split("?");
  if (!rawQuery) {
    return pathname;
  }
  const params = new URLSearchParams(rawQuery);
  const sortedKeys = Array.from(new Set(params.keys())).sort();
  const pairs: string[] = [];
  for (const key of sortedKeys) {
    const val = params.get(key) ?? "";
    pairs.push(`${key}=${val}`);
  }
  return pairs.length > 0 ? `${pathname}?${pairs.join("&")}` : pathname;
}

async function buildStringToSign(
  method: string,
  body: string,
  pathWithQuery: string
): Promise<string> {
  const contentSha256 = await sha256LowerHex(body);
  const sortedPath = canonicalizePathWithSortedQuery(pathWithQuery);
  return `${method.toUpperCase()}\n${contentSha256}\n\n${sortedPath}`;
}

async function fetchNewTuyaToken(): Promise<string> {
  const { clientId, clientSecret, baseUrl } = getTuyaConfig();
  const pathWithQuery = "/v1.0/token?grant_type=1";
  const t = String(Date.now());
  const nonce = "";
  const stringToSign = await buildStringToSign("GET", "", pathWithQuery);
  const payloadToSign = `${clientId}${t}${nonce}${stringToSign}`;
  const sign = await hmacSha256UpperHex(clientSecret, payloadToSign);

  const response = await fetch(`${baseUrl}${pathWithQuery}`, {
    method: "GET",
    headers: {
      client_id: clientId,
      sign,
      t,
      sign_method: "HMAC-SHA256",
      nonce
    },
    cache: "no-store"
  });

  const json = (await response.json()) as TuyaResponse<{
    access_token: string;
    expire_time: number;
  }>;

  if (!response.ok || !json.success || !json.result?.access_token) {
    const errMsg = `Tuya token error: code=${json.code ?? response.status} msg=${json.msg ?? response.statusText}`;
    throw new Error(errMsg);
  }

  const expireSeconds = Number(json.result.expire_time) || 7200;
  cachedToken = {
    accessToken: json.result.access_token,
    expiresAt: Date.now() + expireSeconds * 1000
  };

  return cachedToken.accessToken;
}

async function getValidAccessToken(
  forceRefresh = false
): Promise<{ accessToken: string; refreshed: boolean }> {
  if (
    !forceRefresh &&
    cachedToken &&
    Date.now() < cachedToken.expiresAt - 60_000
  ) {
    return { accessToken: cachedToken.accessToken, refreshed: false };
  }

  const accessToken = await fetchNewTuyaToken();
  return { accessToken, refreshed: true };
}

function isTokenInvalidCode(code?: number): boolean {
  // Tuya OpenAPI token invalid / expired codes: 1010 (token is expired), 1011, 1012
  return code === 1010 || code === 1011 || code === 1012;
}

function isAuthErrorCode(code?: number): boolean {
  // 1004 = sign invalid, 1010-1012 = token invalid, 1106 = permission denied
  return (
    code === 1004 ||
    code === 1010 ||
    code === 1011 ||
    code === 1012 ||
    code === 1106
  );
}

async function issueTuyaPostCommand(
  pathWithQuery: string,
  bodyObj: Record<string, unknown>,
  accessToken: string
): Promise<{ json: TuyaResponse; elapsedMs: number; httpStatus: number }> {
  const { clientId, clientSecret, baseUrl } = getTuyaConfig();
  const bodyStr = JSON.stringify(bodyObj);
  const t = String(Date.now());
  const nonce = "";
  const stringToSign = await buildStringToSign("POST", bodyStr, pathWithQuery);
  const payloadToSign = `${clientId}${accessToken}${t}${nonce}${stringToSign}`;
  const sign = await hmacSha256UpperHex(clientSecret, payloadToSign);

  const cmdStart = Date.now();
  const response = await fetch(`${baseUrl}${pathWithQuery}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id: clientId,
      access_token: accessToken,
      sign,
      t,
      sign_method: "HMAC-SHA256",
      nonce
    },
    body: bodyStr,
    cache: "no-store"
  });
  const elapsedMs = Date.now() - cmdStart;

  let json: TuyaResponse = {};
  try {
    json = (await response.json()) as TuyaResponse;
  } catch {
    json = {
      success: false,
      code: response.status,
      msg: `Non-JSON response from Tuya (HTTP ${response.status})`
    };
  }

  return { json, elapsedMs, httpStatus: response.status };
}

export async function feedOnce(): Promise<FeedOnceResult> {
  if (!isTuyaConfigured()) {
    return {
      success: false,
      endpoint: null,
      tuyaApiMs: null,
      tokenRefreshed: false,
      error: "Tuya credentials are not configured on the server."
    };
  }

  const { deviceId } = getTuyaConfig();
  let tokenRefreshed = false;
  let accessToken: string;

  try {
    const tokenInfo = await getValidAccessToken(false);
    accessToken = tokenInfo.accessToken;
    tokenRefreshed = tokenInfo.refreshed;
  } catch (err) {
    return {
      success: false,
      endpoint: null,
      tuyaApiMs: null,
      tokenRefreshed: true,
      error: err instanceof Error ? err.message : "Failed to fetch Tuya token"
    };
  }

  const shadowPath = `/v2.0/cloud/thing/${encodeURIComponent(deviceId)}/shadow/properties/issue`;
  const shadowBody = { properties: JSON.stringify({ manual_feed: 1 }) };

  let primaryAttempt = await issueTuyaPostCommand(
    shadowPath,
    shadowBody,
    accessToken
  );

  // If token expired mid-flight (e.g. code 1010), refresh once and retry once
  if (!primaryAttempt.json.success && isTokenInvalidCode(primaryAttempt.json.code)) {
    try {
      const refreshedTokenInfo = await getValidAccessToken(true);
      accessToken = refreshedTokenInfo.accessToken;
      tokenRefreshed = true;
      primaryAttempt = await issueTuyaPostCommand(
        shadowPath,
        shadowBody,
        accessToken
      );
    } catch (err) {
      return {
        success: false,
        endpoint: "v2_shadow",
        tuyaApiMs: primaryAttempt.elapsedMs,
        tokenRefreshed: true,
        error:
          err instanceof Error
            ? err.message
            : "Token refresh retry failed on v2_shadow"
      };
    }
  }

  if (primaryAttempt.json.success) {
    return {
      success: true,
      endpoint: "v2_shadow",
      tuyaApiMs: primaryAttempt.elapsedMs,
      tokenRefreshed
    };
  }

  // Only fallback to v1_commands if primary returned success: false for a non-auth reason
  if (isAuthErrorCode(primaryAttempt.json.code)) {
    return {
      success: false,
      endpoint: "v2_shadow",
      tuyaApiMs: primaryAttempt.elapsedMs,
      tokenRefreshed,
      error: `Tuya v2_shadow auth error (code ${primaryAttempt.json.code ?? primaryAttempt.httpStatus}): ${primaryAttempt.json.msg ?? "Authentication failed"}`
    };
  }

  const v1Path = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/commands`;
  const v1Body = { commands: [{ code: "manual_feed", value: 1 }] };

  const fallbackAttempt = await issueTuyaPostCommand(
    v1Path,
    v1Body,
    accessToken
  );

  if (fallbackAttempt.json.success) {
    return {
      success: true,
      endpoint: "v1_commands",
      tuyaApiMs: fallbackAttempt.elapsedMs,
      tokenRefreshed
    };
  }

  return {
    success: false,
    endpoint: "v1_commands",
    tuyaApiMs: fallbackAttempt.elapsedMs,
    tokenRefreshed,
    error: `Tuya feed failed. v2_shadow: [${primaryAttempt.json.code ?? primaryAttempt.httpStatus}] ${primaryAttempt.json.msg ?? "error"}; v1_commands: [${fallbackAttempt.json.code ?? fallbackAttempt.httpStatus}] ${fallbackAttempt.json.msg ?? "error"}`
  };
}

export interface TuyaHardwareSensorStatus {
  lowFoodSensorTriggered: boolean | null; // DP 6 ("status"): "YES" = low food, "NO" = normal
  rawStatusValue: string | null;
  reminderSwitchEnabled: boolean | null; // DP 25 ("switch"): 缺料提醒开关
  updatedAtMs: number | null;
}

// Cache shadow reads so dashboard polling (every 3 s) doesn't burn Tuya API quota.
const HW_STATUS_TTL_MS = 15_000;
let hwStatusCache: { value: TuyaHardwareSensorStatus; fetchedAt: number } | null = null;

export async function getTuyaHardwareStatus(): Promise<TuyaHardwareSensorStatus> {
  if (hwStatusCache && Date.now() - hwStatusCache.fetchedAt < HW_STATUS_TTL_MS) {
    return hwStatusCache.value;
  }
  const value = await fetchTuyaHardwareStatus();
  hwStatusCache = { value, fetchedAt: Date.now() };
  return value;
}

async function fetchTuyaHardwareStatus(): Promise<TuyaHardwareSensorStatus> {
  if (!isTuyaConfigured()) {
    return {
      lowFoodSensorTriggered: null,
      rawStatusValue: null,
      reminderSwitchEnabled: null,
      updatedAtMs: null
    };
  }

  try {
    const { clientId, clientSecret, deviceId, baseUrl } = getTuyaConfig();
    const { accessToken } = await getValidAccessToken(false);
    const pathWithQuery = `/v2.0/cloud/thing/${encodeURIComponent(deviceId)}/shadow/properties`;
    const t = String(Date.now());
    const nonce = "";
    const stringToSign = await buildStringToSign("GET", "", pathWithQuery);
    const payloadToSign = `${clientId}${accessToken}${t}${nonce}${stringToSign}`;
    const sign = await hmacSha256UpperHex(clientSecret, payloadToSign);

    const response = await fetch(`${baseUrl}${pathWithQuery}`, {
      method: "GET",
      headers: {
        client_id: clientId,
        access_token: accessToken,
        sign,
        t,
        sign_method: "HMAC-SHA256",
        nonce
      },
      cache: "no-store"
    });

    const json = (await response.json()) as TuyaResponse<{
      properties?: Array<{
        code: string;
        dp_id: number;
        value: unknown;
        time: number;
      }>;
    }>;

    const props = json?.result?.properties;
    if (!json.success || !Array.isArray(props)) {
      return {
        lowFoodSensorTriggered: null,
        rawStatusValue: null,
        reminderSwitchEnabled: null,
        updatedAtMs: null
      };
    }

    const statusDp = props.find((p) => p.code === "status" || p.dp_id === 6);
    const switchDp = props.find((p) => p.code === "switch" || p.dp_id === 25);
    const rawVal =
      statusDp?.value !== undefined ? String(statusDp.value) : null;

    return {
      lowFoodSensorTriggered:
        rawVal === "YES" ? true : rawVal === "NO" ? false : null,
      rawStatusValue: rawVal,
      reminderSwitchEnabled:
        typeof switchDp?.value === "boolean" ? switchDp.value : null,
      updatedAtMs: typeof statusDp?.time === "number" ? statusDp.time : null
    };
  } catch {
    return {
      lowFoodSensorTriggered: null,
      rawStatusValue: null,
      reminderSwitchEnabled: null,
      updatedAtMs: null
    };
  }
}


