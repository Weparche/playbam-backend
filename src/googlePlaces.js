const PLACES_API_BASE = "https://places.googleapis.com/v1";
const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_CAFE_RADIUS_METERS = 1500;
const MAX_CAFE_RESULTS = 8;

function getApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function metersBetween(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthRadiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePlace(place, origin) {
  const location = place?.location;
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const photo = Array.isArray(place.photos) ? place.photos[0] : null;

  return {
    id: getText(place.id) || getText(place.name).replace(/^places\//, ""),
    placeId: getText(place.id) || getText(place.name).replace(/^places\//, ""),
    resourceName: getText(place.name) || null,
    name: getText(place.displayName?.text) || "Kafić",
    lat,
    lng,
    distanceMeters: metersBetween(origin, { lat, lng }),
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount : null,
    address: getText(place.shortFormattedAddress) || getText(place.formattedAddress) || null,
    googleMapsUri: getText(place.googleMapsUri) || null,
    openNow: typeof place.currentOpeningHours?.openNow === "boolean" ? place.currentOpeningHours.openNow : null,
    businessStatus: getText(place.businessStatus) || null,
    photoName: getText(photo?.name) || null,
    photoAttributions: Array.isArray(photo?.authorAttributions)
      ? photo.authorAttributions.map((attr) => ({
          displayName: getText(attr.displayName) || null,
          uri: getText(attr.uri) || null,
          photoUri: getText(attr.photoUri) || null,
        }))
      : [],
  };
}

export async function searchNearbyCafes({ lat, lng, radiusMeters, maxResultCount, languageCode = "hr" }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = new Error("GOOGLE_PLACES_API_KEY is not configured");
    error.status = 503;
    throw error;
  }

  const center = {
    lat: clampNumber(lat, -90, 90, null),
    lng: clampNumber(lng, -180, 180, null),
  };
  if (center.lat == null || center.lng == null) {
    const error = new Error("Invalid lat/lng");
    error.status = 400;
    throw error;
  }

  const body = {
    includedTypes: ["cafe"],
    maxResultCount: Math.round(clampNumber(maxResultCount, 1, MAX_CAFE_RESULTS, 6)),
    rankPreference: "DISTANCE",
    languageCode: getText(languageCode) || "hr",
    locationRestriction: {
      circle: {
        center: {
          latitude: center.lat,
          longitude: center.lng,
        },
        radius: clampNumber(radiusMeters, 50, 3000, DEFAULT_CAFE_RADIUS_METERS),
      },
    },
  };

  const response = await fetchWithTimeout(`${PLACES_API_BASE}/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.name",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.shortFormattedAddress",
        "places.googleMapsUri",
        "places.rating",
        "places.userRatingCount",
        "places.currentOpeningHours.openNow",
        "places.businessStatus",
        "places.photos",
      ].join(","),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Google Places nearby search failed");
    error.status = response.status;
    throw error;
  }

  const cafes = Array.isArray(payload.places)
    ? payload.places
        .map((place) => normalizePlace(place, center))
        .filter(Boolean)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
    : [];

  return { cafes, source: "google_places" };
}

export async function getPlacePhotoUri({ name, maxWidthPx, maxHeightPx }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = new Error("GOOGLE_PLACES_API_KEY is not configured");
    error.status = 503;
    throw error;
  }

  const photoName = getText(name);
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    const error = new Error("Invalid photo name");
    error.status = 400;
    throw error;
  }

  const url = new URL(`${PLACES_API_BASE}/${photoName}/media`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("skipHttpRedirect", "true");
  url.searchParams.set("maxWidthPx", String(Math.round(clampNumber(maxWidthPx, 1, 1600, 960))));
  url.searchParams.set("maxHeightPx", String(Math.round(clampNumber(maxHeightPx, 1, 1600, 720))));

  const response = await fetchWithTimeout(url.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Google Places photo lookup failed");
    error.status = response.status;
    throw error;
  }

  return {
    name: getText(payload.name) || null,
    photoUri: getText(payload.photoUri) || null,
    source: "google_places",
  };
}
