import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDistanceMatrix,
  fetchRouteSequence,
  haversineKm,
} from "@/lib/road-distance";

export type LatLng = { lat: number; lng: number };
export type RoadPoint = { latitude: number; longitude: number };

type Mode = "step" | "direct";

export type RoadDistancesResult = {
  segments: Array<number | null>;
  cumulative: Array<number | null>;
  source: "road" | "haversine" | "mixed";
  loading: boolean;
  error: string | null;
};

function isValidCoord(p: { latitude: number; longitude: number }): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

function haversineSegments(
  start: LatLng,
  points: ReadonlyArray<RoadPoint>,
  mode: Mode,
): Array<number | null> {
  if (mode === "direct") {
    return points.map((pt) =>
      isValidCoord(pt) ? haversineKm(start.lat, start.lng, pt.latitude, pt.longitude) : null,
    );
  }
  // step: segment from previous valid point (or start) to this point
  const out: Array<number | null> = [];
  let prevLat = start.lat;
  let prevLng = start.lng;
  for (const pt of points) {
    if (!isValidCoord(pt)) {
      out.push(null);
      continue;
    }
    out.push(haversineKm(prevLat, prevLng, pt.latitude, pt.longitude));
    prevLat = pt.latitude;
    prevLng = pt.longitude;
  }
  return out;
}

function buildCumulative(segments: Array<number | null>): Array<number | null> {
  let total = 0;
  return segments.map((seg) => {
    if (seg === null) return null;
    total += seg;
    return total;
  });
}

export function useRoadDistances(
  start: LatLng,
  points: ReadonlyArray<RoadPoint>,
  mode: Mode,
  enabled = true,
): RoadDistancesResult {
  const cacheKey = useMemo(() => {
    const ptStr = points
      .map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`)
      .join("|");
    return `${mode}:${start.lat.toFixed(6)},${start.lng.toFixed(6)}:${ptStr}`;
  }, [start.lat, start.lng, points, mode]);

  const haversineFallback = useMemo(
    () => haversineSegments(start, points, mode),
    [start, points, mode],
  );

  const [roadSegments, setRoadSegments] = useState<Array<number | null> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setRoadSegments(null);
      setLoading(false);
      setError(null);
      return;
    }

    const validIndices: number[] = [];
    points.forEach((pt, i) => {
      if (isValidCoord(pt)) validIndices.push(i);
    });

    if (validIndices.length === 0) {
      setRoadSegments(null);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const result: Array<number | null> = points.map(() => null);

        if (mode === "direct") {
          const dests = validIndices.map(
            (i) => [points[i].longitude, points[i].latitude] as [number, number],
          );
          const data = await fetchDistanceMatrix([start.lng, start.lat], dests);
          validIndices.forEach((origIndex, j) => {
            result[origIndex] = data.distances[j] ?? null;
          });
        } else {
          // step mode: build a sequence of [start, ...validPoints]
          const coords: Array<[number, number]> = [
            [start.lng, start.lat],
            ...validIndices.map(
              (i) => [points[i].longitude, points[i].latitude] as [number, number],
            ),
          ];
          const data = await fetchRouteSequence(coords);
          // segments[k] = distance from coords[k] → coords[k+1]
          // first segment goes to validIndices[0], second to validIndices[1], etc.
          validIndices.forEach((origIndex, j) => {
            result[origIndex] = data.segments[j] ?? null;
          });
        }

        if (requestIdRef.current === reqId) {
          setRoadSegments(result);
          setLoading(false);
        }
      } catch (err) {
        if (requestIdRef.current === reqId) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    })();
  }, [cacheKey, enabled]);

  return useMemo(() => {
    const segments = roadSegments
      ? points.map((_, i) => roadSegments[i] ?? haversineFallback[i] ?? null)
      : haversineFallback;
    const cumulative =
      mode === "step" ? buildCumulative(segments) : segments;
    let source: "road" | "haversine" | "mixed" = "haversine";
    if (roadSegments) {
      const hasRoad = roadSegments.some((s) => s !== null);
      const missing = roadSegments.some((s, i) => s === null && haversineFallback[i] !== null);
      source = hasRoad ? (missing ? "mixed" : "road") : "haversine";
    }
    return { segments, cumulative, source, loading, error };
  }, [roadSegments, haversineFallback, points, mode, loading, error]);
}
