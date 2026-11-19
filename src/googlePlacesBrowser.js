import { loadMaps } from "./mapsLoader";

export async function textSearchBrowser({ query, location, radius = 1800, openNow = true }) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY");

  const maps = await loadMaps(key);

  return new Promise((resolve, reject) => {
    const service = new maps.places.PlacesService(document.createElement("div"));
    const req = {
      query,
      location: new maps.LatLng(location.lat, location.lng),
      radius,
      openNow,
    };
    service.textSearch(req, (results, status) => {
      if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([]);
      } else if (status !== maps.places.PlacesServiceStatus.OK) {
        reject(new Error(`Places JS status: ${status}`));
      } else {
        resolve(results || []);
      }
    });
  });
}

export async function geocodeText(query) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY");
  const maps = await loadMaps(key);
  const geocoder = new maps.Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address: query }, (results, status) => {
      if (status !== "OK" || !results) {
        reject(new Error(`Geocode status: ${status}`));
        return;
      }
      const mapped = results.map(r => {
        const loc = r.geometry?.location;
        return {
          label: r.formatted_address || r.name || query,
          lat: typeof loc?.lat === "function" ? loc.lat() : loc?.lat,
          lng: typeof loc?.lng === "function" ? loc.lng() : loc?.lng,
        };
      }).filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
      resolve(mapped);
    });
  });
}

export async function autocompletePredictions(query) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY");
  const maps = await loadMaps(key);
  const svc = new maps.places.AutocompleteService();
  return new Promise((resolve, reject) => {
    svc.getPlacePredictions({ input: query }, (preds, status) => {
      if (status !== maps.places.PlacesServiceStatus.OK) {
        resolve([]); // not fatal, just no suggestions
        return;
      }
      resolve(
        (preds || []).map((p) => ({
          description: p.description,
          place_id: p.place_id,
          types: p.types || [],
        }))
      );
    });
  });
}

export async function placeDetails(placeId) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY");
  const maps = await loadMaps(key);
  return new Promise((resolve, reject) => {
    const svc = new maps.places.PlacesService(document.createElement("div"));
    svc.getDetails({ placeId, fields: ["geometry", "name", "formatted_address"] }, (res, status) => {
      if (status !== maps.places.PlacesServiceStatus.OK || !res?.geometry?.location) {
        reject(new Error(`Place details status: ${status}`));
        return;
      }
      const loc = res.geometry.location;
      resolve({
        label: res.formatted_address || res.name || "Selected location",
        lat: typeof loc.lat === "function" ? loc.lat() : loc?.lat,
        lng: typeof loc.lng === "function" ? loc.lng() : loc?.lng,
      });
    });
  });
}


// Rich details for the hover preview. Cached per place for the session.
const previewCache = new Map();
const PREVIEW_FIELDS = [
  "name", "formatted_address", "rating", "user_ratings_total", "price_level",
  "photos", "website", "url", "formatted_phone_number", "opening_hours", "reviews", "types",
];

function getDetailsRaw(maps, placeId, fields) {
  return new Promise((resolve, reject) => {
    const svc = new maps.places.PlacesService(document.createElement("div"));
    svc.getDetails({ placeId, fields }, (res, status) => {
      if (status !== maps.places.PlacesServiceStatus.OK || !res) {
        reject(new Error(`Place details status: ${status}`));
      } else {
        resolve(res);
      }
    });
  });
}

export function placePreview(placeId) {
  if (!placeId) return Promise.reject(new Error("No place id"));
  if (previewCache.has(placeId)) return previewCache.get(placeId);
  const job = (async () => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY");
    const maps = await loadMaps(key);
    let res;
    try {
      res = await getDetailsRaw(maps, placeId, [...PREVIEW_FIELDS, "editorial_summary"]);
    } catch {
      // Older API surfaces may reject editorial_summary; retry without it.
      res = await getDetailsRaw(maps, placeId, PREVIEW_FIELDS);
    }
    const review = (res.reviews || []).find((r) => r.text && r.text.length > 40) || null;
    const hoursToday = (() => {
      const lines = res.opening_hours?.weekday_text;
      if (!Array.isArray(lines) || lines.length !== 7) return "";
      return lines[(new Date().getDay() + 6) % 7] || "";
    })();
    let openNow;
    try { openNow = res.opening_hours?.isOpen?.(); } catch { openNow = undefined; }
    return {
      name: res.name || "",
      summary: res.editorial_summary?.overview || "",
      review: review ? { text: review.text, author: review.author_name || "", rating: review.rating } : null,
      address: res.formatted_address || "",
      rating: typeof res.rating === "number" ? res.rating : null,
      ratings: res.user_ratings_total || 0,
      price: res.price_level ?? null,
      photo: res.photos?.[0]?.getUrl?.({ maxWidth: 640 }) || "",
      website: res.website || "",
      mapsUrl: res.url || "",
      phone: res.formatted_phone_number || "",
      hoursToday,
      openNow,
    };
  })();
  previewCache.set(placeId, job);
  job.catch(() => previewCache.delete(placeId));
  return job;
}
