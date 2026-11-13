export interface Esp32TelemetryReading {
  x: number;
  y: number;
  z: number;
  dynamicG: number;
  rawTotalG: number;
  thresholdG: number;
  sequence: number;
  sensorErrors: number;
  espIp: string;
  rssi: number;
  autoTrigger: boolean;
  runLabel: string;
  lastTriggerStatus: string;
  lastTriggerRttMs: number | null;
  receivedAtMs: number;
}

export interface Esp32TelemetryHistoryPoint {
  t: string;
  receivedAtMs: number;
  dynamicG: number;
  x: number;
  y: number;
  z: number;
}

interface Esp32TelemetryStore {
  latest: Esp32TelemetryReading | null;
  history: Esp32TelemetryHistoryPoint[];
}

const globalForEsp32 = globalThis as unknown as {
  __esp32TelemetryStore?: Esp32TelemetryStore;
};

function getStore(): Esp32TelemetryStore {
  if (!globalForEsp32.__esp32TelemetryStore) {
    globalForEsp32.__esp32TelemetryStore = {
      latest: null,
      history: []
    };
  }
  return globalForEsp32.__esp32TelemetryStore;
}

export function recordEsp32Telemetry(
  reading: Omit<Esp32TelemetryReading, "receivedAtMs">
): Esp32TelemetryReading {
  const store = getStore();
  const now = Date.now();
  const full: Esp32TelemetryReading = {
    ...reading,
    receivedAtMs: now
  };
  store.latest = full;
  store.history.push({
    t: new Date(now).toLocaleTimeString(),
    receivedAtMs: now,
    dynamicG: full.dynamicG,
    x: full.x,
    y: full.y,
    z: full.z
  });
  if (store.history.length > 60) {
    store.history = store.history.slice(store.history.length - 60);
  }
  return full;
}

export function getEsp32TelemetryState(): {
  online: boolean;
  latest: Esp32TelemetryReading | null;
  history: Esp32TelemetryHistoryPoint[];
} {
  const store = getStore();
  const latest = store.latest;
  const online = Boolean(latest && Date.now() - latest.receivedAtMs < 10000);
  return {
    online,
    latest,
    history: store.history
  };
}

