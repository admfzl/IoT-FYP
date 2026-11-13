import "server-only";
import type { TuyaEndpoint } from "./supabase-server";

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
  fallbackReason: string | null;
  portionsSent: number;
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
  return code === 1010 || code === 1011 || code === 1012;
}

function isAuthErrorCode(code?: number): boolean {
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

async function issueTuyaGetRequest<T = unknown>(
  pathWithQuery: string,
  accessToken: string
): Promise<{ json: TuyaResponse<T>; elapsedMs: number; httpStatus: number }> {
  const { clientId, clientSecret, baseUrl } = getTuyaConfig();
  const t = String(Date.now());
  const nonce = "";
  const stringToSign = await buildStringToSign("GET", "", pathWithQuery);
  const payloadToSign = `${clientId}${accessToken}${t}${nonce}${stringToSign}`;
  const sign = await hmacSha256UpperHex(clientSecret, payloadToSign);

  const start = Date.now();
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
  const elapsedMs = Date.now() - start;

  let json: TuyaResponse<T> = {};
  try {
    json = (await response.json()) as TuyaResponse<T>;
  } catch {
    json = {
      success: false,
      code: response.status,
      msg: `Non-JSON response from Tuya (HTTP ${response.status})`
    };
  }
  return { json, elapsedMs, httpStatus: response.status };
}

/**
 * Sends a single `manual_feed` command with `value = commandValue` (1..31 per device spec).
 * Uses v2 shadow properties issue first, falling back to v1 commands and recording `fallbackReason`.
 */
export async function feedOnce(commandValue: number = 1): Promise<FeedOnceResult> {
  const safeVal = Math.max(1, Math.min(31, Math.round(commandValue)));
  if (!isTuyaConfigured()) {
    return {
      success: false,
      endpoint: null,
      tuyaApiMs: null,
      tokenRefreshed: false,
      fallbackReason: null,
      portionsSent: 0,
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
      fallbackReason: null,
      portionsSent: 0,
      error: err instanceof Error ? err.message : "Failed to fetch Tuya token"
    };
  }

  const shadowPath = `/v2.0/cloud/thing/${encodeURIComponent(deviceId)}/shadow/properties/issue`;
  const shadowBody = { properties: JSON.stringify({ manual_feed: safeVal }) };

  let primaryAttempt = await issueTuyaPostCommand(
    shadowPath,
    shadowBody,
    accessToken
  );

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
        fallbackReason: null,
        portionsSent: 0,
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
      tokenRefreshed,
      fallbackReason: null,
      portionsSent: safeVal
    };
  }

  const v2Reason = `v2_shadow [${primaryAttempt.json.code ?? primaryAttempt.httpStatus}]: ${primaryAttempt.json.msg ?? "unknown error"}`;

  if (isAuthErrorCode(primaryAttempt.json.code)) {
    return {
      success: false,
      endpoint: "v2_shadow",
      tuyaApiMs: primaryAttempt.elapsedMs,
      tokenRefreshed,
      fallbackReason: null,
      portionsSent: 0,
      error: `Tuya v2_shadow auth error (code ${primaryAttempt.json.code ?? primaryAttempt.httpStatus}): ${primaryAttempt.json.msg ?? "Authentication failed"}`
    };
  }

  const v1Path = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/commands`;
  const v1Body = { commands: [{ code: "manual_feed", value: safeVal }] };

  const fallbackAttempt = await issueTuyaPostCommand(
    v1Path,
    v1Body,
    accessToken
  );

  if (fallbackAttempt.json.success) {
    return {
      success: true,
      endpoint: "v1_commands",
      tuyaApiMs: primaryAttempt.elapsedMs + fallbackAttempt.elapsedMs,
      tokenRefreshed,
      fallbackReason: v2Reason,
      portionsSent: safeVal
    };
  }

  return {
    success: false,
    endpoint: "v1_commands",
    tuyaApiMs: primaryAttempt.elapsedMs + fallbackAttempt.elapsedMs,
    tokenRefreshed,
    fallbackReason: v2Reason,
    portionsSent: 0,
    error: `Tuya feed failed. ${v2Reason}; v1_commands: [${fallbackAttempt.json.code ?? fallbackAttempt.httpStatus}] ${fallbackAttempt.json.msg ?? "error"}`
  };
}

/**
 * Dispenses `totalPortions` portions.
 * Device specification for `manual_feed` supports 1..maxPerCommand (default 31) in a single command.
 * Splits into sequential commands only if `totalPortions > maxPerCommand`.
 */
export async function feedPortions(
  totalPortions: number,
  maxPerCommand: number = 31
): Promise<FeedOnceResult> {
  const safeMax = Math.max(1, Math.min(31, maxPerCommand || 31));
  const target = Math.max(1, Math.round(totalPortions));

  if (target <= safeMax) {
    return feedOnce(target);
  }

  let remaining = target;
  let totalTuyaMs = 0;
  let anyTokenRefreshed = false;
  let usedEndpoint: TuyaEndpoint | null = "v2_shadow";
  let fallbackReason: string | null = null;
  let dispensed = 0;

  while (remaining > 0) {
    const chunk = Math.min(remaining, safeMax);
    const step = await feedOnce(chunk);
    if (step.tuyaApiMs !== null) {
      totalTuyaMs += step.tuyaApiMs;
    }
    if (step.tokenRefreshed) anyTokenRefreshed = true;
    if (step.endpoint === "v1_commands") usedEndpoint = "v1_commands";
    if (step.fallbackReason && !fallbackReason) {
      fallbackReason = step.fallbackReason;
    }
    if (!step.success) {
      return {
        success: false,
        endpoint: step.endpoint ?? usedEndpoint,
        tuyaApiMs: totalTuyaMs || null,
        tokenRefreshed: anyTokenRefreshed,
        fallbackReason,
        portionsSent: dispensed,
        error: step.error
      };
    }
    dispensed += chunk;
    remaining -= chunk;
  }

  return {
    success: true,
    endpoint: usedEndpoint,
    tuyaApiMs: totalTuyaMs,
    tokenRefreshed: anyTokenRefreshed,
    fallbackReason,
    portionsSent: dispensed
  };
}

export interface TuyaFullDeviceStatus {
  configured: boolean;
  online: boolean | null;
  lowFood: boolean | null; // DP code "status": "YES" => low food (true), "NO" => sufficient (false)
  rawStatusValue: string | null;
  manualFeedMin: number;
  manualFeedMax: number;
  deviceName: string | null;
  checkedAtIso: string;
  error?: string;
}

/**
 * Read-only query of Tuya device online state, DP `status` ("NO" / "YES" low-food sensor),
 * and `manual_feed` specification range. NEVER sends a feed command.
 */
export async function fetchTuyaDeviceStatusAndSpec(): Promise<TuyaFullDeviceStatus> {
  const checkedAtIso = new Date().toISOString();
  if (!isTuyaConfigured()) {
    return {
      configured: false,
      online: null,
      lowFood: null,
      rawStatusValue: null,
      manualFeedMin: 1,
      manualFeedMax: 31,
      deviceName: null,
      checkedAtIso,
      error: "Tuya credentials are not configured."
    };
  }

  try {
    const { deviceId } = getTuyaConfig();
    let { accessToken } = await getValidAccessToken(false);

    const devPath = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}`;
    let devRes = await issueTuyaGetRequest<{
      online?: boolean;
      name?: string;
    }>(devPath, accessToken);

    if (!devRes.json.success && isTokenInvalidCode(devRes.json.code)) {
      const refreshed = await getValidAccessToken(true);
      accessToken = refreshed.accessToken;
      devRes = await issueTuyaGetRequest(devPath, accessToken);
    }

    const statusPath = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/status`;
    const specPath = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/specification`;

    const [statusRes, specRes] = await Promise.all([
      issueTuyaGetRequest<Array<{ code: string; value: unknown }>>(
        statusPath,
        accessToken
      ),
      issueTuyaGetRequest<{
        functions?: Array<{ code: string; values?: string }>;
      }>(specPath, accessToken)
    ]);

    const online =
      typeof devRes.json.result?.online === "boolean"
        ? devRes.json.result.online
        : null;
    const deviceName = devRes.json.result?.name ?? null;

    let rawStatusValue: string | null = null;
    let lowFood: boolean | null = null;

    if (Array.isArray(statusRes.json.result)) {
      // Device specification uses DP code "status" (Enum: ["NO", "YES"]) for 余粮状态 (food level status)
      const statusItem = statusRes.json.result.find((d) => d.code === "status");
      if (statusItem && statusItem.value !== undefined) {
        rawStatusValue = String(statusItem.value);
        lowFood =
          rawStatusValue === "YES"
            ? true
            : rawStatusValue === "NO"
              ? false
              : null;
      }
    }

    let manualFeedMin = 1;
    let manualFeedMax = 31;
    const funcs = specRes.json.result?.functions;
    if (Array.isArray(funcs)) {
      const mf = funcs.find((f) => f.code === "manual_feed");
      if (mf?.values) {
        try {
          const parsed = JSON.parse(mf.values) as {
            min?: number;
            max?: number;
          };
          if (typeof parsed.min === "number" && parsed.min >= 1) {
            manualFeedMin = parsed.min;
          }
          if (typeof parsed.max === "number" && parsed.max >= manualFeedMin) {
            manualFeedMax = parsed.max;
          }
        } catch {
          // keep defaults 1..31
        }
      }
    }

    if (!devRes.json.success && !statusRes.json.success) {
      return {
        configured: true,
        online: null,
        lowFood: null,
        rawStatusValue: null,
        manualFeedMin,
        manualFeedMax,
        deviceName: null,
        checkedAtIso,
        error: `Tuya error [${devRes.json.code ?? devRes.httpStatus}]: ${devRes.json.msg ?? "Failed to read device"}`
      };
    }

    return {
      configured: true,
      online,
      lowFood,
      rawStatusValue,
      manualFeedMin,
      manualFeedMax,
      deviceName,
      checkedAtIso
    };
  } catch (err) {
    return {
      configured: true,
      online: null,
      lowFood: null,
      rawStatusValue: null,
      manualFeedMin: 1,
      manualFeedMax: 31,
      deviceName: null,
      checkedAtIso,
      error: err instanceof Error ? err.message : "Failed to query Tuya device"
    };
  }
}
