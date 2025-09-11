import React, { useEffect, useMemo, useState } from "react";
import { textSearchBrowser, geocodeText, autocompletePredictions, placeDetails } from "./googlePlacesBrowser";

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
  // Boston
  { label: "Boston Common", lat: 42.355, lng: -71.065 },
  { label: "Back Bay", lat: 42.35, lng: -71.081 },
  { label: "Seaport", lat: 42.351, lng: -71.043 },
  { label: "Cambridgeport", lat: 42.356, lng: -71.11 },
  { label: "North End", lat: 42.365, lng: -71.055 }, // zip 02113 approx

  // NYC
  { label: "Central Park", lat: 40.7829, lng: -73.9654 },
  { label: "Times Square", lat: 40.758, lng: -73.9855 },
  { label: "Brooklyn Bridge", lat: 40.7061, lng: -73.9969 },
  { label: "Williamsburg", lat: 40.7081, lng: -73.9571 },
  { label: "LaGuardia Airport", lat: 40.7769, lng: -73.8740 },
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

function slugify(str = "") {
  return (str || "")
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function titleFromSlug(slug = "") {
  const s = (slug || "").replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PivotPersonalBeta() {
  const [start, setStart] = useState(STARTS[0]);
  const [useGps, setUseGps] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [vibes, setVibes] = useState(["cozy"]);
  const [priceCap, setPriceCap] = useState(2);
  const [plan, setPlan] = useState([]);
  const [alternates, setAlternates] = useState([]);
  const [locked, setLocked] = useState([]); // place ids the user kept
  const [todos, setTodos] = useState([]); // [{id,text,done}]
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);
  const [livePlaces, setLivePlaces] = useState([]);
  const [lastError, setLastError] = useState("");
  const [debugInfo, setDebugInfo] = useState(null);
  const [startSearch, setStartSearch] = useState("");
  const [startMatches, setStartMatches] = useState([]);
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState("");

  // --- Event meta and external links
  const [event, setEvent] = useState({ user: "", slug: "", name: "" });
  const [links, setLinks] = useState({ driveFolder: "", doc: "", calendar: "", sheet: "", notes: "" });

  function eventKey(e = event) {
    if (!e?.user || !e?.slug) return "";
    return `event:${e.user}/${e.slug}`;
  }

  // Persist event-related state locally (per unique URL path)
  useEffect(() => {
    const key = eventKey();
    if (!key) return;
    const payload = {
      event,
      links,
      start,
      vibes,
      priceCap,
      plan,
      alternates,
      _savedAt: Date.now()
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {}
  }, [event, links, start, vibes, priceCap, plan, alternates]);

  // Persist to backend (debounced) when event is defined
  useEffect(() => {
    if (!event.user || !event.slug) return;
    const payload = { event, links, start, vibes, priceCap, plan, alternates, locked, todos, notes, _v: 1 };
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/events/${event.user}/${event.slug}`,
        { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal }
      ).catch(() => {});
    }, 800);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [event, links, start, vibes, priceCap, plan, alternates]);

  // --- Theme (light/dark)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  // Restore from URL (supports /:user/:slug and/or ?s=...)
  useEffect(() => {
    // Ensure no stray kept state on first load unless explicitly restored
    setLocked([]);
    const params = new URLSearchParams(window.location.search);
    const stateStr = params.get("s");

    // Parse path /:user/:slug
    const parts = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length >= 2) {
      const [u, sl] = parts;
      setEvent((prev) => ({ user: u || prev.user, slug: sl || prev.slug, name: prev.name || titleFromSlug(sl || "") }));

      // Try backend/local restore only if no snapshot (?s=) provided
      if (!stateStr) {
        (async () => {
          try {
            const res = await fetch(`/api/events/${u}/${sl}`, { method: 'GET' });
            if (res.ok) {
              const saved = await res.json();
              if (saved?.event) setEvent((e) => ({ ...e, ...saved.event }));
              if (saved?.links) setLinks((l) => ({ ...l, ...saved.links }));
              if (saved?.start) setStart(saved.start);
              if (saved?.vibes) setVibes(saved.vibes);
              if (typeof saved?.priceCap === "number") setPriceCap(saved.priceCap);
              if (Array.isArray(saved?.plan)) setPlan(saved.plan);
              if (Array.isArray(saved?.alternates)) setAlternates(saved.alternates);
              if (Array.isArray(saved?.locked)) setLocked(saved.locked);
              if (Array.isArray(saved?.todos)) setTodos(saved.todos);
              if (typeof saved?.notes === 'string') setNotes(saved.notes);
              return; // success, skip local fallback
            }
          } catch {}
          // Local fallback by event key
          const key = `event:${u}/${sl}`;
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const saved = JSON.parse(raw);
              if (saved?.start) setStart(saved.start);
              if (saved?.vibes) setVibes(saved.vibes);
              if (typeof saved?.priceCap === "number") setPriceCap(saved.priceCap);
              if (Array.isArray(saved?.plan)) setPlan(saved.plan);
              if (Array.isArray(saved?.alternates)) setAlternates(saved.alternates);
              if (Array.isArray(saved?.locked)) setLocked(saved.locked);
              if (Array.isArray(saved?.todos)) setTodos(saved.todos);
              if (typeof saved?.notes === 'string') setNotes(saved.notes);
              if (saved?.links) setLinks((l) => ({ ...l, ...saved.links }));
              if (saved?.event?.name) setEvent((e) => ({ ...e, name: saved.event.name }));
            }
          } catch {}
        })();
      }
    }

    // If share string present, prefer it (can override local)
    if (stateStr) {
      const st = decodeState(stateStr);
      if (st) {
        if (st.event) setEvent((e) => ({ ...e, ...st.event }));
        if (st.links) setLinks((l) => ({ ...l, ...st.links }));
        if (st.start) setStart(st.start);
        if (st.vibes) setVibes(st.vibes);
        if (typeof st.priceCap === "number") setPriceCap(st.priceCap);
        if (st.plan && Array.isArray(st.plan)) setPlan(st.plan);
        if (Array.isArray(st.locked)) setLocked(st.locked);
        if (Array.isArray(st.todos)) setTodos(st.todos);
        if (typeof st.notes === 'string') setNotes(st.notes);
        if (Array.isArray(st.savedPlaces)) setLivePlaces(st.savedPlaces);
      }
    }
  }, []);

  // Debounce start search suggestions
  useEffect(() => {
    if (!startSearch || startSearch.trim().length < 3) { setStartMatches([]); setStartError(""); return; }
    const t = setTimeout(() => { findStart(); }, 250);
    return () => clearTimeout(t);
  }, [startSearch]);

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

  async function findStart(force = false) {
    const q = (startSearch || "").trim();
    if (!q) { setStartMatches([]); return; }
    if (!force && q.length < 3) return;
    setStartLoading(true);
    setStartError("");
    try {
      // Prefer autocomplete for UX
      const preds = await autocompletePredictions(q);
      if (preds.length) {
        setStartMatches(preds.slice(0, 5).map(p => ({ label: p.description, place_id: p.place_id })));
        setStartLoading(false);
        return;
      }
      // Fallback to geocode
      const res = await geocodeText(q);
      setStartMatches(res.slice(0, 5));
    } catch (e) {
      setStartMatches([]);
      setStartError("Could not find that location");
    } finally {
      setStartLoading(false);
    }
  }

  async function useStartMatch(match) {
    try {
      if (match.place_id) {
        const det = await placeDetails(match.place_id);
        setStart({ label: det.label, lat: det.lat, lng: det.lng });
        setStartSearch(det.label || "");
      } else {
        setStart({ label: match.label, lat: match.lat, lng: match.lng });
        setStartSearch(match.label || "");
      }
      setUseGps(false);
      setStartMatches([]);
    } catch (e) {
      setStartError("Could not select that place");
    }
  }

  async function buildPlan(exclude = new Set(), keep = new Set()) {
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

    let mapped = results.map(mapPlaceFromJs).filter(p => p.lat && p.lng && !exclude.has(p.id));
    // Ensure kept items exist in mapped by merging from known livePlaces
    if (keep && keep.size) {
      const byId = new Map(mapped.map(p => [p.id, p]));
      for (const id of keep) {
        if (!byId.has(id)) {
          const known = (livePlaces || []).find(p => p.id === id);
          if (known) {
            mapped.push(known);
            byId.set(id, known);
          }
        }
      }
    }
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

    // Keep any existing kept places first (preserve current order if possible)
    const keepIds = Array.from(keep).filter(id => mapped.some(m => m.id === id));
    // Fill remaining slots with best ranked not in keep or exclude
    const fill = [];
    for (const r of ranked) {
      const id = r.p.id;
      if (keep.has(id) || exclude.has(id)) continue;
      if (!keepIds.includes(id) && !fill.includes(id)) fill.push(id);
      if (keepIds.length + fill.length >= 3) break;
    }
    const chosen = [...keepIds, ...fill].slice(0, 3);

    const remainingForAlts = ranked.map(r => r.p.id).filter(id => !new Set(chosen).has(id) && !keep.has(id));
    const alts = remainingForAlts.slice(0, 4);

    setPlan(chosen);
    setAlternates(alts);

    const state = { event, links, start, vibes, priceCap, plan: chosen, locked: Array.from(keep), todos, notes };
    const useCleanPath = event.user && event.slug;
    const newUrl = useCleanPath
      ? `${window.location.pathname}`
      : `${window.location.pathname}?${new URLSearchParams({ s: encodeState(state) }).toString()}`;
    window.history.replaceState({}, "", newUrl);
  }

  function pivotOnce() {
    const keepSet = new Set(locked);
    const exclude = new Set(plan.filter(id => !keepSet.has(id)));
    buildPlan(exclude, keepSet);
  }

  function toggleVibe(v) {
    setVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  function copyShare() {
    // Build a fresh share string so it reflects current state
    const state = { event, links, start, vibes, priceCap, plan, locked, todos, notes };
    const useCleanPath = event.user && event.slug;
    const url = useCleanPath
      ? `${window.location.origin}${window.location.pathname}`
      : `${window.location.origin}${window.location.pathname}?${new URLSearchParams({ s: encodeState(state) }).toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  function copyShareSnapshot() {
    // Always embed the current state in the URL for a portable snapshot
    // Include known place details so kept items render without refetch
    const known = [...selectedPlaces, ...altPlaces].filter(Boolean);
    const seen = new Set();
    const savedPlaces = known.filter(p => {
      if (!p || !p.id) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    }).map(p => ({
      id: p.id,
      name: p.name,
      neighborhood: p.neighborhood,
      lat: p.lat,
      lng: p.lng,
      category: p.category,
      vibes: p.vibes,
      price: p.price,
      hours: p.hours,
      noise: p.noise,
      open_now: p.open_now
    }));
    const state = { event, links, start, vibes, priceCap, plan, locked, todos, notes, savedPlaces };
    const qs = new URLSearchParams({ s: encodeState(state) }).toString();
    const url = `${window.location.origin}${window.location.pathname}?${qs}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  async function newEvent() {
    const uIn = prompt("Username for URL (e.g., lauraboccio)", event.user || "");
    if (!uIn) return;
    const eIn = prompt("Event name (e.g., bach2025)", event.slug || event.name || "");
    if (!eIn) return;
    const u = slugify(uIn);
    const sl = slugify(eIn);
    const name = eIn.trim();
    const next = { user: u, slug: sl, name };

    // Check availability on backend (best-effort, avoid false positives from SPA fallbacks)
    try {
      const r = await fetch(`/api/events/${u}/${sl}`, { headers: { accept: 'application/json' } });
      let exists = false;
      if (r.status === 200) {
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          try {
            const data = await r.json();
            exists = !!(data && (data.event || data.plan || data.links));
          } catch {
            exists = false;
          }
        }
      }
      if (exists) {
        const useExisting = confirm("This event already exists. Open it?");
        if (!useExisting) return;
      }
    } catch {}

    setEvent(next);
    setPlan([]);
    setAlternates([]);
    setLocked([]);
    // push new path; drop any old query
    const newPath = `/${u}/${sl}`;
    window.history.pushState({}, "", newPath);
    // persist a minimal shell so it exists for next visits
    try {
      localStorage.setItem(`event:${u}/${sl}`, JSON.stringify({ event: next, links, start, vibes, priceCap, plan: [], alternates: [] }));
    } catch {}
  }

  const sourceList = livePlaces.length ? livePlaces : PLACES;
  const selectedPlaces = plan.map(id => sourceList.find(p => p.id === id)).filter(Boolean);
  const altPlaces = alternates.map(id => sourceList.find(p => p.id === id)).filter(Boolean);
  const lockedSet = useMemo(() => new Set(locked), [locked]);
  const viewOnly = useMemo(() => new URLSearchParams(window.location.search).get('view') === '1', []);

  function toggleKeep(id) {
    setLocked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }
  const [replacePick, setReplacePick] = useState(null); // { altId }

  function doReplace(targetIndex, altId) {
    const altPlace = sourceList.find(p => p.id === altId) || altPlaces.find(p => p.id === altId);
    if (!altPlace) { setReplacePick(null); return; }
    if (lockedSet.has(plan[targetIndex])) return; // safety
    if (plan.includes(altPlace.id)) { setReplacePick(null); return; }
    const oldId = plan[targetIndex];
    const nextPlan = [...plan];
    nextPlan[targetIndex] = altPlace.id;
    const nextAlts = [oldId, ...alternates.filter((id) => id !== altPlace.id && id !== oldId)];
    setPlan(nextPlan);
    setAlternates(nextAlts);
    setReplacePick(null);
  }

  function startReplaceWithAlternate(altPlace) {
    // Determine which plan indices are not kept
    const openSlots = plan
      .map((id, i) => (lockedSet.has(id) ? null : i))
      .filter((i) => i !== null);
    if (openSlots.length === 0) {
      alert("All current items are kept. Unkeep or Clear kept first.");
      return;
    }
    if (plan.includes(altPlace.id)) {
      alert("That place is already in the plan.");
      return;
    }
    if (openSlots.length === 1) {
      doReplace(openSlots[0], altPlace.id);
      return;
    }
    setReplacePick({ altId: altPlace.id });
  }

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b dark:bg-neutral-800/70 dark:border-neutral-700">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-xl font-semibold">
              Pivot <span className="text-sm align-top">beta practice run ✨</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">personal build</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? "API key loaded" : "API key missing"}
            </span>
          </div>
          <div className="flex items-center">
            <button
              onClick={toggleTheme}
              className="text-sm border rounded-xl px-3 py-1.5 mr-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 dark:border-neutral-700"
              aria-label="Toggle dark mode"
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button
              onClick={newEvent}
              className="text-sm border rounded-xl px-3 py-1.5 mr-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 dark:border-neutral-700"
            >
              New event
            </button>
            <button
              onClick={copyShare}
              className="text-sm border rounded-xl px-3 py-1.5 mr-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 dark:border-neutral-700"
              title="Copy clean event link (loads from backend)"
            >
              Clean link
            </button>
            <button
              onClick={copyShareSnapshot}
              className="text-sm px-3 py-1.5 rounded-xl font-semibold text-white bg-neutral-900 border border-neutral-900 shadow-sm hover:shadow-md hover:opacity-95 active:opacity-90 active:translate-y-px transition dark:bg-neutral-700 dark:border-neutral-500"
            >
              {copied ? "Copied!" : "Share snapshot"}
            </button>
          </div>
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
          {(event.user && event.slug) ? (
            <div className="p-4 bg-white rounded-2xl shadow-sm border dark:bg-neutral-900 dark:border-neutral-800">
              <h2 className="font-semibold mb-2">Event</h2>
              <div className="text-sm text-neutral-600 dark:text-neutral-300 mb-2">
                URL path: <span className="font-medium">/{event.user}/{event.slug}</span>
              </div>
              <label className="block text-sm text-neutral-600 dark:text-neutral-300 mb-1">Display name</label>
              <input
                className="w-full rounded-xl border px-3 py-2 mb-3 dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                value={event.name || ""}
                onChange={(e) => setEvent((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Bach 2025 Weekend"
                disabled={viewOnly}
              />

              <h3 className="font-medium mb-2">Links</h3>
              <div className="space-y-2">
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  placeholder="Google Drive folder URL"
                  value={links.driveFolder}
                  onChange={(e) => setLinks((l) => ({ ...l, driveFolder: e.target.value }))}
                  disabled={viewOnly}
                />
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  placeholder="Main Google Doc URL"
                  value={links.doc}
                  onChange={(e) => setLinks((l) => ({ ...l, doc: e.target.value }))}
                  disabled={viewOnly}
                />
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  placeholder="Google Calendar URL"
                  value={links.calendar}
                  onChange={(e) => setLinks((l) => ({ ...l, calendar: e.target.value }))}
                  disabled={viewOnly}
                />
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  placeholder="Google Sheet URL"
                  value={links.sheet}
                  onChange={(e) => setLinks((l) => ({ ...l, sheet: e.target.value }))}
                  disabled={viewOnly}
                />
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  placeholder="Notes/Log URL"
                  value={links.notes}
                  onChange={(e) => setLinks((l) => ({ ...l, notes: e.target.value }))}
                  disabled={viewOnly}
                />
              </div>
              <div className="mt-4">
                <h3 className="font-medium mb-2">Checklist</h3>
                <TodoList todos={todos} setTodos={setTodos} disabled={viewOnly} />
              </div>
              <div className="mt-4">
                <h3 className="font-medium mb-2">Notes</h3>
                <textarea
                  className="w-full rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  rows={4}
                  placeholder="Quick notes for this event..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={viewOnly}
                />
              </div>
              <div className="mt-3 flex gap-2">
                {event.user && event.slug ? (
                  <button
                    onClick={() => {
                      const base = `${window.location.origin}${window.location.pathname}`;
                      navigator.clipboard.writeText(`${base}?view=1`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
                    }}
                    className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700"
                  >
                    Copy view-only link
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2 mt-3">
                {links.driveFolder ? (
                  <a className="text-xs underline" href={links.driveFolder} target="_blank" rel="noreferrer">Open Drive</a>
                ) : null}
                {links.doc ? (
                  <a className="text-xs underline" href={links.doc} target="_blank" rel="noreferrer">Open Doc</a>
                ) : null}
                {links.calendar ? (
                  <a className="text-xs underline" href={links.calendar} target="_blank" rel="noreferrer">Open Calendar</a>
                ) : null}
              </div>
              <p className="text-xs text-neutral-500 mt-3">
                Tip: event links live only on unique URLs.
              </p>
            </div>
          ) : null}
          <div className="p-4 bg-white rounded-2xl shadow-sm border dark:bg-neutral-900 dark:border-neutral-800">
            <h2 className="font-semibold mb-3">Start</h2>
            <div className="space-y-2">
              <label className="block text-sm text-neutral-600 dark:text-neutral-300">Pick a preset</label>
              <select
                className="w-full rounded-xl border px-3 py-2 dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                value={start.label}
                onChange={(e) => {
                  const s = STARTS.find((x) => x.label === e.target.value);
                  setStart(s);
                  setUseGps(false);
                  setStartSearch(s?.label || "");
                }}
              >
                {STARTS.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label className="block text-sm text-neutral-600 dark:text-neutral-300 pt-2">Or search a location</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
                  placeholder="Address or place (e.g., 200 Park Ave, NYC)"
                  value={startSearch}
                  onChange={(e) => { setStartSearch(e.target.value); /* debounce via effect */ }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { if (startMatches.length && startMatches[0]) { useStartMatch(startMatches[0]); } else { findStart(true); } } }}
                />
                <button
                  onClick={findStart}
                  className="text-sm px-3 py-2 rounded-xl border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700"
                >
                  Search
                </button>
              </div>
              {startLoading ? (
                <div className="text-xs text-neutral-500 mt-1">Searching…</div>
              ) : null}
              {startError ? (
                <div className="text-xs text-rose-600 mt-1">{startError}</div>
              ) : null}
              {startMatches.length > 0 && (
                <div className="mt-2 space-y-1">
                  {startMatches.map((m, idx) => (
                    <div key={`${m.lat},${m.lng},${idx}`} className="flex items-center gap-2 text-sm">
                      <div className="flex-1 truncate" title={m.label || m.description}>{m.label || m.description}</div>
                      <button
                        className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700"
                        onClick={() => useStartMatch(m)}
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              )}
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

          <div className="p-4 bg-white rounded-2xl shadow-sm border dark:bg-neutral-900 dark:border-neutral-800">
            <h2 className="font-semibold mb-3">Vibe</h2>
            <div className="flex flex-wrap gap-2">
              {["cozy", "buzzy", "artsy", "low-stim"].map((v) => (
                <button
                  key={v}
                  onClick={() => toggleVibe(v)}
                  className={
                    "px-3 py-1.5 rounded-full border text-sm dark:border-neutral-700 " +
                    (vibes.includes(v)
                      ? "bg-neutral-900 text-white dark:bg-neutral-700 dark:text-neutral-100 dark:border-neutral-500"
                      : "bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700")
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-sm border dark:bg-neutral-900 dark:border-neutral-800">
            <h2 className="font-semibold mb-3">Budget</h2>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((p) => (
                <label
                  key={p}
                  className={`px-3 py-1.5 rounded-xl border text-sm cursor-pointer ${
                    priceCap === p
                      ? "bg-neutral-900 text-white dark:bg-neutral-700 dark:text-neutral-100 dark:border-neutral-500"
                      : "bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
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
              disabled={viewOnly}
              onClick={() => buildPlan(new Set(), new Set(locked))}
              className="flex-1 rounded-2xl px-4 py-3 font-semibold text-white bg-neutral-900 border border-neutral-900 shadow-sm hover:shadow-md hover:opacity-95 active:opacity-90 active:translate-y-px transition dark:bg-neutral-700 dark:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Build plan
            </button>
            <button
              disabled={viewOnly}
              onClick={pivotOnce}
              className="flex-1 bg-white border rounded-2xl px-4 py-3 font-medium hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Pivot
            </button>
            <button
              disabled={viewOnly}
              onClick={() => setLocked([])}
              className="px-3 py-3 text-sm text-neutral-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear all kept items"
            >
              Clear kept
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
            <div className="p-6 border rounded-2xl bg-white text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 dark:border-neutral-800">
              No plan yet. Choose a vibe and budget, then click <span className="font-medium">Build plan</span>.
            </div>
          )}

          <div className="grid gap-3">
            {selectedPlaces.map((p, i) => (
              <PlaceCard key={p.id} place={p} index={i} start={startPoint} lockedSet={lockedSet} onToggleKeep={viewOnly ? null : toggleKeep} />
            ))}
          </div>

          {altPlaces.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Alternates</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {altPlaces.map((p) => (
                  <AltCard key={p.id} place={p} start={startPoint} onPick={viewOnly ? null : (() => startReplaceWithAlternate(p))} />
                ))}
              </div>
              {replacePick ? (() => {
                const alt = altPlaces.find(a => a.id === replacePick.altId) || sourceList.find(a => a.id === replacePick.altId);
                if (!alt) return null;
                const openSlots = plan
                  .map((id, i) => (lockedSet.has(id) ? null : i))
                  .filter((i) => i !== null);
                if (openSlots.length <= 1) return null; // handled above
                return (
                  <div className="mt-3 p-3 border rounded-xl bg-white dark:bg-neutral-900 dark:border-neutral-800">
                    <div className="text-sm mb-2">Replace with <span className="font-medium">{alt.name}</span>. Choose a slot:</div>
                    <div className="flex flex-wrap gap-2">
                      {openSlots.map((idx) => (
                        <button
                          key={idx}
                          onClick={() => doReplace(idx, replacePick.altId)}
                          className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700"
                          title={`Replace slot ${idx + 1}`}
                        >
                          {idx + 1}. {selectedPlaces[idx] ? selectedPlaces[idx].name : 'Empty'}
                        </button>
                      ))}
                      <button
                        onClick={() => setReplacePick(null)}
                        className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })() : null}
            </div>
          )}
        </section>
      </main>

      <footer className="py-8 text-center text-xs text-neutral-500">
        Pivot personal beta • No accounts • Fictionalized data • Built for rapid solo testing
      </footer>
      </div>
    </div>
  );
}

function TodoList({ todos, setTodos, disabled }) {
  function addTodo(text) {
    const t = (text || "").trim();
    if (!t) return;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    setTodos(prev => [...prev, { id, text: t, done: false }]);
  }
  function toggle(id) {
    setTodos(prev => prev.map(it => it.id === id ? { ...it, done: !it.done } : it));
  }
  function remove(id) {
    setTodos(prev => prev.filter(it => it.id !== id));
  }
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 rounded-xl border px-3 py-2 text-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700"
          placeholder="Add a task..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled) { addTodo(e.currentTarget.value); e.currentTarget.value = ''; }
          }}
          disabled={disabled}
        />
        <button
          onClick={() => {
            const el = document.activeElement;
            if (el && 'value' in el) { const v = el.value; addTodo(v); el.value = ''; }
          }}
          disabled={disabled}
          className="text-xs px-3 py-2 rounded-xl border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      <div className="space-y-1">
        {todos.map((it) => (
          <div key={it.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={it.done} onChange={() => toggle(it.id)} disabled={disabled} />
            <span className={it.done ? 'line-through text-neutral-500' : ''}>{it.text}</span>
            {!disabled ? (
              <button onClick={() => remove(it.id)} className="ml-auto text-xs text-neutral-500 hover:underline">Remove</button>
            ) : null}
          </div>
        ))}
        {todos.length === 0 ? <div className="text-xs text-neutral-500">No tasks yet.</div> : null}
      </div>
    </div>
  );
}

function PlaceCard({ place, index, start, lockedSet, onToggleKeep }) {
  const dist = haversineMiles(start, { lat: place.lat, lng: place.lng });
  const mins = minutesWalk(dist);
  const os = openStatus(place);
  const reasons = [];
  if (os.label !== "Open") reasons.push(os.label);
  if (place.price === 3) reasons.push("Higher cost");
  if (mins && mins > 25) reasons.push("Far walk");
  const isKept = lockedSet ? lockedSet.has(place.id) : false;

  return (
    <div className="p-4 bg-white rounded-2xl border shadow-sm flex items-start gap-4 dark:bg-neutral-900 dark:border-neutral-800">
      <div className="w-8 h-8 rounded-full bg-neutral-900 text-white flex items-center justify-center font-semibold">
        {index + 1}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="font-semibold">{place.name}</div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200">{place.neighborhood}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200">{place.category}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200">{priceToSymbol(place.price)}</span>
          {onToggleKeep ? (
            <button
              onClick={() => onToggleKeep(place.id)}
              className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${isKept ? 'bg-neutral-900 text-white dark:bg-neutral-700 dark:border-neutral-500' : 'bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700'}`}
              title={isKept ? 'Kept in plan' : 'Keep this spot'}
            >
              {isKept ? 'Kept' : 'Keep'}
            </button>
          ) : null}
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300 flex flex-wrap gap-3">
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
            <span key={v} className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              {v}
            </span>
          ))}
          {(place.dietary || []).map((d) => (
            <span key={d} className="text-xs px-2 py-1 rounded-full bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AltCard({ place, start, onPick }) {
  const dist = haversineMiles(start, { lat: place.lat, lng: place.lng });
  const mins = minutesWalk(dist);
  const os = openStatus(place);
  return (
    <div className="p-3 bg-white rounded-2xl border dark:bg-neutral-900 dark:border-neutral-800">
      <div className="font-medium">{place.name}</div>
      <div className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5 flex flex-wrap gap-2">
        <span>{place.neighborhood}</span>
        <span>{priceToSymbol(place.price)}</span>
        <span>{os.label}</span>
        {mins ? <span>~{mins}m</span> : null}
      </div>
      <div className="mt-2 flex gap-3 items-center">
        <a
          className="text-xs underline inline-block"
          href={`https://www.google.com/maps?q=${place.lat},${place.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in Maps
        </a>
        {onPick ? (
          <button
            className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:border-neutral-700"
            onClick={onPick}
            title="Replace a slot with this option"
          >
            Use
          </button>
        ) : null}
      </div>
    </div>
  );
}
