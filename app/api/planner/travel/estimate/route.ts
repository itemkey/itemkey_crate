import { NextRequest } from "next/server";

import { assertPlannerCsrf, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import type { PlannerTravelEstimateInput, PlannerTravelMode } from "@/lib/planner/commitments";
import { getRequestUser } from "@/lib/request-user";

type PhotonFeature = {
  geometry?: { coordinates?: unknown[] };
  properties?: Record<string, unknown>;
};

type PhotonResponse = { features?: PhotonFeature[] };
type ValhallaResponse = {
  trip?: {
    summary?: { time?: number; length?: number };
  };
  error?: string;
  error_code?: number;
};

const GEOCODER_URL = process.env.PLANNER_GEOCODER_URL || "https://photon.komoot.io/api/";
const ROUTER_URL = process.env.PLANNER_ROUTER_URL || "https://valhalla1.openstreetmap.de/route";

function inputText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length < 4) throw new Error(`Укажите ${field}.`);
  return value.trim().slice(0, 240);
}

function travelMode(value: unknown): PlannerTravelMode {
  if (value === "walk" || value === "transit" || value === "car") return value;
  throw new Error("Выберите способ передвижения.");
}

function photonLabel(feature: PhotonFeature, fallback: string): string {
  const properties = feature.properties ?? {};
  const street = [properties.street, properties.housenumber].filter((value) => typeof value === "string" && value).join(" ");
  const parts = [properties.name, street, properties.city, properties.state, properties.country]
    .filter((value, index, all) => typeof value === "string" && value && all.indexOf(value) === index);
  return parts.join(", ").slice(0, 240) || fallback;
}

async function geocode(address: string): Promise<{ lat: number; lon: number; label: string }> {
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "ru");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "ItemKeyPlanner/0.1" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Сервис поиска адресов временно недоступен.");
  const payload = await response.json() as PhotonResponse;
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  const lon = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  if (!feature || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Не удалось найти адрес «${address}». Уточните город, улицу и дом.`);
  return { lat, lon, label: photonLabel(feature, address) };
}

async function calculateRoute(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  mode: PlannerTravelMode
): Promise<{ seconds: number; distanceKm: number }> {
  const costing = mode === "walk" ? "pedestrian" : mode === "car" ? "auto" : "multimodal";
  const url = new URL(ROUTER_URL);
  url.searchParams.set("json", JSON.stringify({
    locations: [origin, destination],
    costing,
    units: "kilometers",
    ...(mode === "transit" ? { date_time: { type: 0 } } : {}),
    directions_options: { units: "kilometers", language: "ru-RU" },
  }));
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "ItemKeyPlanner/0.1" },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({})) as ValhallaResponse;
  const seconds = Number(payload.trip?.summary?.time);
  const distanceKm = Number(payload.trip?.summary?.length);
  if (!response.ok || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(distanceKm)) {
    if (mode === "transit") throw new Error("Для этих адресов навигатор не нашёл маршрут на общественном транспорте.");
    throw new Error(payload.error || "Навигатор не смог построить маршрут между этими адресами.");
  }
  return { seconds, distanceKm };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = await request.json() as Partial<PlannerTravelEstimateInput>;
    const originAddress = inputText(body.origin, "адрес отправления");
    const destinationAddress = inputText(body.destination, "адрес назначения");
    const mode = travelMode(body.mode);
    const [origin, destination] = await Promise.all([geocode(originAddress), geocode(destinationAddress)]);
    const route = await calculateRoute(origin, destination, mode);
    return Response.json({ data: {
      minutes: Math.max(1, Math.ceil(route.seconds / 300) * 5),
      distanceKm: Math.round(route.distanceKm * 10) / 10,
      originLabel: origin.label,
      destinationLabel: destination.label,
      provider: "OpenStreetMap",
    } });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось рассчитать дорогу. Укажите время в пути вручную.");
  }
}
