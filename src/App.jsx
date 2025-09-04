import React, { useEffect, useMemo, useState } from "react";
import { textSearchBrowser } from "./googlePlacesBrowser";

function haversineMiles(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function minutesWalk(miles) {
  if (!isFinite(miles)) return null;
  return Math.round(miles * 20); // ~3 mph
}

function nowLocal() {
  return new Date();
}

function minsUntil(hour24) {
  const n = nowLocal();
  const target = new Date(n);
  target.setHours(Math.floor(hour24), Math.round((hour24 % 1) * 60), 0, 0);
  let diff = Math.round((target.getTime() - n.getTime()) / 60000);
  if (diff < 0) diff += 24 * 60; // wrap to next day
  return diff;
}

function openStatus(place) {
  const n = nowLocal();
  const hour = n.getHours() + n.getMinutes() / 60;
  const { open, close } = place.hours;
  let isOpen = false;
  if (open < close) {
    isOpen = hour >= open && hour < close;
  } else {
    // overnight
    isOpen = hour >= open || hour < close;
  }
  if (!isOpen) return { label: "Closed", weight: -2 };
  const mins = minsUntil(close);
  if (mins <= 45) return { label: `Closes in ${mins}m`, weight: -0.5 };
  return { label: "Open", weight: 1 };
}

function priceToSymbol(p) {
  return "$".repeat(p);
}


function mapPlace(p) {
  return {
    id: p.place_id,
    name: p.name,
    neighborhood: (p.vicinity || p.formatted_address || "").split(",")[0] || "",
    lat: p.geometry?.location?.lat,
    lng: p.geometry?.location?.lng,
    category: inferCategory(p),
    vibes: inferVibes(p),
    price: p.price_level ? Math.max(1, Math.min(3, p.price_level)) : 2,
    hours: { open: 0, close: 24 },
    noise: "med",
    open_now: p.opening_hours?.open_now === true
  };
}

function inferCategory(p) {
  const types = p.types || [];
  if (types.includes("cafe") || types.includes("coffee_shop")) return "coffee";
  if (types.includes("restaurant")) return "eat";
  if (types.includes("bar")) return "bar";
  if (types.includes("park")) return "park";
  if (types.includes("museum") || types.includes("art_gallery")) return "gallery";
  return "shop";
}

function inferVibes(p) {
  const name = (p.name || "").toLowerCase();
  const types = (p.types || []).join(" ");
  const text = `${name} ${types}`;
  const vibes = [];
  if (text.match(/gallery|museum|book|vinyl/)) vibes.push("artsy");
  if (text.match(/bar|club|taproom|pub/)) vibes.push("buzzy");
  if (text.match(/cafe|coffee|tea|park|garden/)) vibes.push("cozy");
  if (text.match(/library|museum|park/)) vibes.push("low-stim");
  return vibes.length ? vibes : ["cozy"];
}
// ---- Data
const STARTS = [
  { label: "Boston Common", lat: 42.355, lng: -71.065 },
  { label: "Back Bay", lat: 42.35, lng: -71.081 },
  { label: "Seaport", lat: 42.351, lng: -71.043 },
  { label: "Cambridgeport", lat: 42.356, lng: -71.11 },
];

const PLACES = [];

// ---- Scoring
function inferCategoryFromTypes(types = []) {
  if (types.includes("cafe") || types.includes("coffee_shop")) return "coffee";
  if (types.includes("restaurant")) return "eat";
  if (types.includes("bar")) return "bar";
  if (types.includes("park")) return "park";
  if (types.includes("museum") || types.includes("art_gallery")) return "gallery";
  return "shop";
}

function inferVibesFromNameTypes(p) {
  const name = (p.name || "").toLowerCase();
  const types = (p.types || []).join(" ");
  const text = `${name} ${types}`;
  const vibes = [];
  if (text.match(/gallery|museum|book|vinyl/)) vibes.push("artsy");
  if (text.match(/bar|club|taproom|pub/)) vibes.push("buzzy");
  if (text.match(/cafe|coffee|tea|park|garden/)) vibes.push("cozy");
  if (text.match(/library|museum|park/)) vibes.push("low-stim");
  return vibes.length ? vibes : ["cozy"];
}

function mapPlaceFromJs(p) {
  return {
    id: p.place_id,
    name: p.name,
    neighborhood: (p.vicinity || p.formatted_address || "").split(",")[0] || "",
    lat: p.geometry?.location?.lat?.() ?? p.geometry?.location?.lat ?? null,
    lng: p.geometry?.location?.lng?.() ?? p.geometry?.location?.lng ?? null,
    category: inferCategoryFromTypes(p.types || []),
    vibes: inferVibesFromNameTypes(p),
    price: p.price_level ? Math.max(1, Math.min(3, p.price_level)) : 2,
    hours: { open: 0, close: 24 },
    noise: "med",
    open_now: p.opening_hours?.isOpen?.() ?? p.opening_hours?.open_now ?? undefined
  };
}
function scorePlace(place, prefs) {
  let s = 0;
  const os = openStatus(place);
  s += os.weight; // open boosts, closing soon slight penalty

  // Vibe matching
  const vibeMatches = place.vibes.filter((v) => prefs.vibes.includes(v)).length;
  s += vibeMatches * 3;

  // Price fit
  if (place.price <= prefs.priceCap) s += 1;
  else s -= place.price - prefs.priceCap;

  // Distance
  if (prefs.start) {
    const d = haversineMiles(prefs.start, { lat: place.lat, lng: place.lng });
    if (d <= 0.4) s += 2;
    else if (d <= 0.8) s += 1;
    else if (d > 1.8) s -= 1;
  }

  return { score: s, open: os };
}

// ---- URL state helpers
function encodeState(state) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  } catch {
    return "";
  }
}
function decodeState(q) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(q))));
  } catch {
    return null;
  }
}

export default function PivotPersonalBeta() {
  const [start, setStart] = useState(STARTS[0]);
  const [useGps, setUseGps] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [vibes, setVibes] = useState(["cozy"]);
  const [priceCap, setPriceCap] = useState(2);
  const [plan, setPlan] = useState([]);
  const [alternates, setAlternates] = useState([]);
  const [copied, setCopied] = useState(false);
  const [livePlaces, setLivePlaces] = useState([]);
  const [lastError, setLastError] = useState("");
  const [debugInfo, setDebugInfo] = useState(null);

  // Restore from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stateStr = params.get("s");
    if (stateStr) {
      const st = decodeState(stateStr);
      if (st) {
        if (st.start) setStart(st.start);
        if (st.vibes) setVibes(st.vibes);
        if (typeof st.priceCap === "number") setPriceCap(st.priceCap);
        if (st.plan && Array.isArray(st.plan)) setPlan(st.plan);
      }
    }
  }, []);

  // GPS
  useEffect(() => {
    if (!useGps) return;
    if (!navigator.geolocation) {
      setGpsDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const preset = { label: "My location", lat: pos.coords.latitude, lng: pos.coords.longitude };
        setStart(preset);
        setGpsDenied(false);
      },
      () => setGpsDenied(true),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [useGps]);

  const startPoint = useMemo(() => ({ lat: start.lat, lng: start.lng }), [start]);

  async function buildPlan(exclude = new Set()) {
    const prefs = { vibes, priceCap, start: startPoint };
    setLastError("");

    // Build a simple query from vibes
    const q = vibes.includes("buzzy") ? "bar OR restaurant"
      : vibes.includes("artsy") ? "gallery OR museum OR cafe"
      : "coffee OR cafe OR restaurant";

    // Use current start location
    const loc = { lat: startPoint.lat, lng: startPoint.lng };

    let results = [];
    try {
      results = await textSearchBrowser({ query: q, location: loc, radius: 1800, openNow: true });
      setDebugInfo({ count: Array.isArray(results) ? results.length : 0 });
    } catch (e) {
      console.error("[Pivot] buildPlan JS Places failed:", e);
      setLastError("Google Places request failed. " + (e?.message || ""));
      setPlan([]);
      setAlternates([]);
      return;
    }

    const mapped = results.map(mapPlaceFromJs).filter(p => p.lat && p.lng && !exclude.has(p.id));
    setLivePlaces(mapped);

    if (!mapped.length) {
      setLastError("No results returned. Check billing and that Maps JavaScript API is enabled.");
      setPlan([]);
      setAlternates([]);
      return;
    }

    const ranked = mapped
      .map(p => ({ p, meta: scorePlace(p, prefs) }))
      .sort((a, b) => b.meta.score - a.meta.score);

    const chosen = ranked.slice(0, 3).map(r => r.p.id);
    const alts = ranked.slice(3, 7).map(r => r.p.id);

    setPlan(chosen);
    setAlternates(alts);

    const state = { start, vibes, priceCap, plan: chosen };
    const qs = new URLSearchParams({ s: encodeState(state) }).toString();
    const newUrl = `${window.location.pathname}?${qs}`;
    window.history.replaceState({}, "", newUrl);
  }

  function pivotOnce() {
    const exclude = new Set(plan);
    buildPlan(exclude);
  }

  function toggleVibe(v) {
    setVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  function copyShare() {
    const params = new URLSearchParams(window.location.search);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const sourceList = livePlaces.length ? livePlaces : PLACES;
  const selectedPlaces = plan.map(id => sourceList.find(p => p.id === id)).filter(Boolean);
  const altPlaces = alternates.map(id => sourceList.find(p => p.id === id)).filter(Boolean);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-xl font-semibold">
              Pivot <span className="text-sm align-top">beta for Laura ✨</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">personal build</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
              {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? "API key loaded" : "API key missing"}
            </span>
          </div>
          <button
            onClick={copyShare}
            className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded-xl hover:opacity-90"
          >
            {copied ? "Copied!" : "Share link"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 grid md:grid-cols-3 gap-6">
        {lastError ? (
          <div className="md:col-span-3 mb-2 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm">
            {lastError}
          </div>
        ) : null}
        {(() => {
          const showDebug = new URLSearchParams(window.location.search).get("debug") === "1";
          if (!showDebug || !debugInfo) return null;
          return (
            <div className="md:col-span-3 mb-2 p-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-800 text-xs">
              <div className="font-medium mb-1">Debug</div>
              <div>URL: <span className="break-all">{debugInfo.url}</span></div>
              <div>Status: {debugInfo.status || "n/a"} · Results: {typeof debugInfo.count === "number" ? debugInfo.count : "n/a"}</div>
              {debugInfo.error ? <div>Error: {debugInfo.error}</div> : null}
            </div>
          );
        })()}
        {/* Controls */}
        <section className="md:col-span-1 space-y-6">
          <div className="p-4 bg-white rounded-2xl shadow-sm border">
            <h2 className="font-semibold mb-3">Start</h2>
            <div className="space-y-2">
              <label className="block text-sm text-neutral-600">Pick a preset</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={start.label}
                onChange={(e) => {
                  const s = STARTS.find((x) => x.label === e.target.value);
                  setStart(s);
                  setUseGps(false);
                }}
              >
                {STARTS.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="gps"
                  type="checkbox"
                  checked={useGps}
                  onChange={(e) => setUseGps(e.target.checked)}
                />
                <label htmlFor="gps" className="text-sm">
                  Use my location
                </label>
                {gpsDenied && <span className="text-xs text-rose-600">(permission denied)</span>}
              </div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-sm border">
            <h2 className="font-semibold mb-3">Vibe</h2>
            <div className="flex flex-wrap gap-2">
              {["cozy", "buzzy", "artsy", "low-stim"].map((v) => (
                <button
                  key={v}
                  onClick={() => toggleVibe(v)}
                  className={
                    "px-3 py-1.5 rounded-full border text-sm " +
                    (vibes.includes(v) ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50")
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-sm border">
            <h2 className="font-semibold mb-3">Budget</h2>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((p) => (
                <label
                  key={p}
                  className={`px-3 py-1.5 rounded-xl border text-sm cursor-pointer ${
                    priceCap === p ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="price"
                    className="hidden"
                    checked={priceCap === p}
                    onChange={() => setPriceCap(p)}
                  />
                  {"$".repeat(p)} or less
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => buildPlan()}
              className="flex-1 bg-neutral-900 text-white rounded-2xl px-4 py-3 font-medium hover:opacity-90"
            >
              Build plan
            </button>
            <button
              onClick={pivotOnce}
              className="flex-1 bg-white border rounded-2xl px-4 py-3 font-medium hover:bg-neutral-50"
            >
              Pivot
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            Tip: hit <b>Build plan</b> first, then use <b>Pivot</b> to cycle alternates.
          </p>
        </section>

        {/* Plan */}
        <section className="md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Your plan</h2>
            <div className="text-sm text-neutral-600">
              Start: <span className="font-medium">{start.label}</span>
            </div>
          </div>

          {selectedPlaces.length === 0 && (
            <div className="p-6 border rounded-2xl bg-white text-neutral-600">
              No plan yet. Choose a vibe and budget, then click <span className="font-medium">Build plan</span>.
            </div>
          )}

          <div className="grid gap-3">
            {selectedPlaces.map((p, i) => (
              <PlaceCard key={p.id} place={p} index={i} start={startPoint} />
            ))}
          </div>

          {altPlaces.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Alternates</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {altPlaces.map((p) => (
                  <AltCard key={p.id} place={p} start={startPoint} />
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="py-8 text-center text-xs text-neutral-500">
        Pivot personal beta • No accounts • Fictionalized data • Built for rapid solo testing
      </footer>
    </div>
  );
}

function PlaceCard({ place, index, start }) {
  const dist = haversineMiles(start, { lat: place.lat, lng: place.lng });
  const mins = minutesWalk(dist);
  const os = openStatus(place);
  const reasons = [];
  if (os.label !== "Open") reasons.push(os.label);
  if (place.price === 3) reasons.push("Higher cost");
  if (mins && mins > 25) reasons.push("Far walk");

  return (
    <div className="p-4 bg-white rounded-2xl border shadow-sm flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-neutral-900 text-white flex items-center justify-center font-semibold">
        {index + 1}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="font-semibold">{place.name}</div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100">{place.neighborhood}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100">{place.category}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100">{priceToSymbol(place.price)}</span>
        </div>
        <div className="mt-1 text-sm text-neutral-600 flex flex-wrap gap-3">
          {mins ? <span>~{mins} min walk</span> : <span>distance unknown</span>}
          <span>Noise: {place.noise}</span>
          <span>Status: {place.open_now === true ? "Open" : place.open_now === false ? "Closed" : os.label}</span>
        </div>
        {reasons.length > 0 && (
          <div className="mt-2 text-xs text-neutral-600">Why we picked it: {reasons.join(" · ")}</div>
        )}
        <div className="mt-3">
          <a
            className="text-sm underline"
            href={`https://www.google.com/maps?q=${place.lat},${place.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Maps
          </a>
        </div>
        <div className="mt-3 flex gap-2">
          {place.vibes.map((v) => (
            <span key={v} className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-800">
              {v}
            </span>
          ))}
          {(place.dietary || []).map((d) => (
            <span key={d} className="text-xs px-2 py-1 rounded-full bg-sky-50 text-sky-800">
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AltCard({ place, start }) {
  const dist = haversineMiles(start, { lat: place.lat, lng: place.lng });
  const mins = minutesWalk(dist);
  const os = openStatus(place);
  return (
    <div className="p-3 bg-white rounded-2xl border">
      <div className="font-medium">{place.name}</div>
      <div className="text-xs text-neutral-600 mt-0.5 flex flex-wrap gap-2">
        <span>{place.neighborhood}</span>
        <span>{priceToSymbol(place.price)}</span>
        <span>{os.label}</span>
        {mins ? <span>~{mins}m</span> : null}
      </div>
      <a
        className="text-xs underline mt-2 inline-block"
        href={`https://www.google.com/maps?q=${place.lat},${place.lng}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in Maps
      </a>
    </div>
  );
}