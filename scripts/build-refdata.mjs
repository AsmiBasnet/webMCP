// Precompute the admin hierarchy into one small file.
//
// Incidents carry `wards: [id]` but no district, and BIPAD has no aggregation
// endpoint — so any "deaths by district" answer needs ward → municipality →
// district resolved client-side. Fetching ~6,700 wards at runtime is slow and
// fragile; baking the lookup at build time makes it instant and offline-safe.
//
//   node scripts/build-refdata.mjs

import { writeFile, mkdir } from "node:fs/promises";

const BIPAD = "https://bipadportal.gov.np/api/v1";

async function all(path, limit = 1000) {
  const out = [];
  for (let offset = 0; ; offset += limit) {
    const r = await fetch(`${BIPAD}/${path}/?limit=${limit}&offset=${offset}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    const rows = (await r.json()).results ?? [];
    out.push(...rows);
    process.stdout.write(`\r  ${path}: ${out.length}`);
    if (rows.length < limit) break;
  }
  process.stdout.write("\n");
  return out;
}

const [provinces, districts, municipalities, wards, hazards] = [
  await all("province"),
  await all("district"),
  await all("municipality"),
  await all("ward"),
  await all("hazard"),
];

const refdata = {
  generatedOn: new Date().toISOString(),
  source: "BIPAD Portal, NDRRMA, Government of Nepal — bipadportal.gov.np",
  provinces: provinces.map((p) => [p.id, p.title_en ?? p.title, p.title_ne ?? null]),
  districts: districts.map((d) => [
    d.id, d.title_en ?? d.title, d.title_ne ?? null, d.province,
    round(d.centroid?.coordinates),
  ]),
  municipalities: municipalities.map((m) => [
    m.id, m.title_en ?? m.title, m.title_ne ?? null, m.district, m.type ?? null,
    round(m.centroid?.coordinates),
  ]),
  // ward id -> municipality id, the join incidents actually need
  wardToMunicipality: Object.fromEntries(wards.map((w) => [w.id, w.municipality])),
  hazards: hazards.map((h) => [h.id, h.titleEn ?? h.title, h.titleNe ?? null, h.color ?? null, h.type ?? null]),
};

function round(coords) {
  return Array.isArray(coords) ? coords.map((n) => Number(n.toFixed(4))) : null;
}

await mkdir("public/data", { recursive: true });
await writeFile("public/data/refdata.json", JSON.stringify(refdata));
console.log(
  `refdata.json — ${refdata.provinces.length} provinces, ${refdata.districts.length} districts, ` +
  `${refdata.municipalities.length} municipalities, ${Object.keys(refdata.wardToMunicipality).length} wards, ` +
  `${refdata.hazards.length} hazards`
);
