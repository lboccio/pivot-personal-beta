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
      if (status !== maps.places.PlacesServiceStatus.OK) {
        reject(new Error(`Places JS status: ${status}`));
      } else {
        resolve(results || []);
      }
    });
  });
}