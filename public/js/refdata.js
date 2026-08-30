// Admin hierarchy + hazard taxonomy, and name → id resolution.
//
// An agent passes "Rasuwa" or "बाढी", not id 28 or hazard 11. Everything that
// turns human words into BIPAD ids lives here.

let db = null;

export async function loadRefdata() {
  if (db) return db;
  const r = await fetch("./data/refdata.json");
  if (!r.ok) throw new Error("refdata.json missing — run: node scripts/build-refdata.mjs");
  const raw = await r.json();

  const provinces = new Map(raw.provinces.map(([id, en, ne]) => [id, { id, en, ne }]));
  const districts = new Map(
    raw.districts.map(([id, en, ne, province, centroid]) => [
      id, { id, en, ne, province, centroid: flip(centroid) },
    ])
  );
  const municipalities = new Map(
    raw.municipalities.map(([id, en, ne, district, type, centroid]) => [
      id, { id, en, ne, district, type, centroid: flip(centroid) },
    ])
  );
  const hazards = new Map(
    raw.hazards.map(([id, en, ne, color, type]) => [id, { id, en, ne, color, type }])
  );

  db = {
    generatedOn: raw.generatedOn,
    provinces, districts, municipalities, hazards,
    wardToMunicipality: raw.wardToMunicipality,
  };
  return db;
}

function flip(coords) {
  return Array.isArray(coords) ? [coords[1], coords[0]] : null;
}

export function ref() {
  if (!db) throw new Error("loadRefdata() must run first");
  return db;
}

/** ward id → { municipality, district, province } */
export function wardContext(wardId) {
  const mId = db.wardToMunicipality[wardId];
  const m = mId ? db.municipalities.get(mId) : null;
  const d = m ? db.districts.get(m.district) : null;
  return { ward: wardId, municipality: m ?? null, district: d ?? null, province: d?.province ?? null };
}

/** An incident's district, resolved through its first ward. */
export function incidentDistrict(incident) {
  const w = incident?.wards?.[0];
  return w ? wardContext(w).district : null;
}

export function incidentMunicipality(incident) {
  const w = incident?.wards?.[0];
  return w ? wardContext(w).municipality : null;
}

const norm = (s) =>
  String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

function matchByName(map, name) {
  const q = norm(name);
  if (!q) return null;
  let prefix = null, contains = null;
  for (const item of map.values()) {
    const en = norm(item.en), ne = norm(item.ne);
    if (en === q || ne === q) return item;
    if (!prefix && (en.startsWith(q) || (ne && ne.startsWith(q)))) prefix = item;
    if (!contains && (en.includes(q) || (ne && ne.includes(q)))) contains = item;
  }
  return prefix ?? contains;
}

export const findDistrict = (name) =>
  typeof name === "number" ? db.districts.get(name) ?? null : matchByName(db.districts, name);

export const findMunicipality = (name) =>
  typeof name === "number" ? db.municipalities.get(name) ?? null : matchByName(db.municipalities, name);

export const findProvince = (name) =>
  typeof name === "number" ? db.provinces.get(name) ?? null : matchByName(db.provinces, name);

/** Hazard names people actually type, mapped onto BIPAD's taxonomy. */
const HAZARD_ALIASES = {
  flood: "flood", flooding: "flood", बाढी: "flood",
  landslide: "landslide", landslip: "landslide", पहिरो: "landslide",
  earthquake: "earthquake", quake: "earthquake", भूकम्प: "earthquake",
  fire: "fire", wildfire: "forest fire", आगलागी: "fire",
  lightning: "thunderbolt", thunderbolt: "thunderbolt", चट्याङ: "thunderbolt",
  storm: "heavy rainfall", "heavy rain": "heavy rainfall", rainfall: "heavy rainfall",
  avalanche: "avalanche", drought: "drought", epidemic: "epidemic",
  "animal attack": "animal incident", snakebite: "snake bite",
};

export function findHazard(name) {
  if (typeof name === "number") return db.hazards.get(name) ?? null;
  const key = String(name ?? "").trim().toLowerCase();
  return matchByName(db.hazards, HAZARD_ALIASES[key] ?? key);
}

export function hazardName(id) {
  return db.hazards.get(id)?.en ?? `Hazard ${id}`;
}

/** Nearest district to a point, by centroid — for "drop a pin" lookups. */
export function nearestDistrict(latlon, distanceKm) {
  let best = null, bestD = Infinity;
  for (const d of db.districts.values()) {
    if (!d.centroid) continue;
    const dist = distanceKm(latlon, d.centroid);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best ? { district: best, km: bestD } : null;
}
