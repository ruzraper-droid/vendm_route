const ENDPOINT = `${import.meta.env.BASE_URL}api/road-distance`.replace(/\/+/g, "/");

const STORAGE_PREFIX = "ddata.roadDist.v1.";
const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const memCache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function round6(n: number): string {
  return n.toFixed(6);
}

function coordKey(coords: ReadonlyArray<readonly [number, number]>): string {
  return coords.map(([lng, lat]) => `${round6(lng)},${round6(lat)}`).join(";");
}

type Stored<T> = { value: T; expiresAt: number };

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    const payload: Stored<T> = { value, expiresAt: Date.now() + STORAGE_TTL_MS };
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(payload));
  } catch {
    /* ignore quota errors */
  }
}

async function postJson<T>(body: unknown, cacheKey: string): Promise<T> {
  if (memCache.has(cacheKey)) return memCache.get(cacheKey) as T;
  const stored = readStorage<T>(cacheKey);
  if (stored) {
    memCache.set(cacheKey, stored);
    return stored;
  }
  const existing = inflight.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`road-distance failed (${res.status})`);
    }
    const data = (await res.json()) as T;
    memCache.set(cacheKey, data);
    writeStorage(cacheKey, data);
    return data;
  })();

  inflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(cacheKey);
  }
}

export type SequenceResult = {
  mode: "sequence";
  segments: number[];
  totalKm: number;
  totalMin: number;
};

export type MatrixResult = {
  mode: "matrix";
  distances: Array<number | null>;
  durations: Array<number | null>;
};

export function fetchRouteSequence(
  coordinates: ReadonlyArray<readonly [number, number]>,
): Promise<SequenceResult> {
  const key = `seq:${coordKey(coordinates)}`;
  return postJson<SequenceResult>(
    { coordinates: coordinates.map(([lng, lat]) => [lng, lat]) },
    key,
  );
}

export function fetchDistanceMatrix(
  source: readonly [number, number],
  destinations: ReadonlyArray<readonly [number, number]>,
): Promise<MatrixResult> {
  const key = `tab:${coordKey([source, ...destinations])}`;
  return postJson<MatrixResult>(
    {
      source: [source[0], source[1]],
      destinations: destinations.map(([lng, lat]) => [lng, lat]),
    },
    key,
  );
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} Km`;
}
