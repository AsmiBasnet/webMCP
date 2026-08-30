// Leaflet map. Every layer is fed from a tool result, so what the agent
// reported and what the map draws can never drift apart.
//
// Coordinate order is handled once, in api.js `latlng()`. Nothing here flips
// anything — if points land in China, the bug is upstream of this file.

import { NEPAL, LIVE_EVENT } from "./config.js";

const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const STATUS_COLOR = {
  danger: "#d03b3b",
  warning: "#ec835a",
  approaching: "#fab219",
  normal: "#0ca30c",
  unknown: "#737a81",
  CLOSED: "#d03b3b",
  PARTIAL_OPEN: "#fab219",
  OPEN: "#0ca30c",
};

let map = null;
const layers = {};

export function initMap(containerId = "map") {
  if (map) return map;

  // Esri, not CARTO. CARTO's keyless basemap endpoint now stamps "API KEY
  // REQUIRED" across every tile; Esri's Canvas services still serve without a
  // key, and their label layer ships separately so place names stay crisp over
  // a dark ground. All three services below carry the same attribution.
  //
  // Note the {z}/{y}/{x} order — y before x. Esri is the exception.
  const esri = (service) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
  const ESRI_ATTR = "Tiles &copy; Esri";

  const labels = () =>
    L.tileLayer(esri("Canvas/World_Dark_Gray_Reference"), { maxZoom: 16, pane: "shadowPane" });

  const dark = L.layerGroup([
    L.tileLayer(esri("Canvas/World_Dark_Gray_Base"), {
      maxZoom: 16, attribution: `${ESRI_ATTR} &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors`,
    }),
    labels(),
  ]);

  const light = L.layerGroup([
    L.tileLayer(esri("Canvas/World_Light_Gray_Base"), {
      maxZoom: 16, attribution: `${ESRI_ATTR} &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors`,
    }),
    L.tileLayer(esri("Canvas/World_Light_Gray_Reference"), { maxZoom: 16, pane: "shadowPane" }),
  ]);

  const satellite = L.tileLayer(esri("World_Imagery"), {
    maxZoom: 19,
    attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  });

  map = L.map(containerId, { layers: [dark], zoomControl: true, worldCopyJump: false });
  map.setView(NEPAL.center, NEPAL.zoom);
  map.setMaxBounds(NEPAL.maxBounds);

  L.control.layers({ Dark: dark, Light: light, Satellite: satellite }, {}, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

  return map;
}

function clear(name) {
  if (layers[name]) {
    map.removeLayer(layers[name]);
    delete layers[name];
  }
}

// The data layers are mutually exclusive. One answer, one map — otherwise the
// gauges from three questions ago sit on top of the roadblocks you just asked
// about and the map stops meaning anything. The GDACS footprint is context, not
// an answer, so it persists underneath.
const DATA_LAYERS = ["incidents", "stations", "roads", "resources", "gaps"];

function showOnly(name) {
  for (const other of DATA_LAYERS) if (other !== name) clear(other);
  clear(name);
}

/** Drop every answer layer, keeping the GDACS footprint. */
export function clearData() {
  for (const name of DATA_LAYERS) clear(name);
}

export function clearAll() {
  for (const name of Object.keys(layers)) clear(name);
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const asOf = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Incidents — clustered, because a monsoon year puts thousands on screen. */
export function showIncidents(incidents) {
  showOnly("incidents");
  const pts = incidents.filter((i) => i.point);
  if (!pts.length) return;

  const group = L.markerClusterGroup({
    maxClusterRadius: 45,
    showCoverageOnHover: false,
    iconCreateFunction(cluster) {
      const n = cluster.getChildCount();
      const size = n > 200 ? 42 : n > 40 ? 34 : 28;
      return L.divIcon({
        html:
          `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
          `background:rgba(57,135,229,.22);border:1.5px solid #3987e5;color:#e8e6e1;` +
          `display:flex;align-items:center;justify-content:center;` +
          `font:500 ${size > 34 ? 12 : 11}px 'IBM Plex Mono',monospace">${n}</div>`,
        className: "",
        iconSize: [size, size],
      });
    },
  });

  for (const i of pts) {
    const deaths = i.loss?.deaths ?? 0;
    const marker = L.circleMarker(i.point, {
      radius: deaths > 0 ? Math.min(5 + deaths * 1.5, 14) : 5,
      color: deaths > 0 ? "#d03b3b" : "#3987e5",
      weight: 1.5,
      fillOpacity: 0.4,
    });
    marker.bindPopup(
      `<b>${esc(i.title)}</b>` +
      (i.titleNe ? `<br><span class="meta">${esc(i.titleNe)}</span>` : "") +
      `<br><span class="meta">${esc(i.hazard)} · ${esc(i.district ?? "—")} · ${asOf(i.incidentOn)}</span>` +
      (i.loss
        ? `<br>${i.loss.deaths} dead · ${i.loss.missing} missing · ${i.loss.injured} injured` +
          `<br><span class="meta">${i.loss.familiesAffected} families affected</span>`
        : "") +
      `<br><span class="meta">${i.verified ? "verified" : "UNVERIFIED"} · source: ${esc(i.dataSource ?? "—")}</span>`
    );
    group.addLayer(marker);
  }

  layers.incidents = group.addTo(map);
  fit(pts.map((i) => i.point));
}

/** Gauges — radius carries how little headroom is left, colour carries status. */
export function showStations(stations) {
  showOnly("stations");
  const pts = stations.filter((s) => s.point);
  if (!pts.length) return;

  const group = L.layerGroup();
  for (const s of pts) {
    const head = s.metresBelowWarning;
    const urgent = head != null && head <= 0.5;
    const marker = L.circleMarker(s.point, {
      radius: urgent ? 9 : 6,
      color: STATUS_COLOR[s.severity] ?? STATUS_COLOR.unknown,
      weight: urgent ? 2.5 : 1.5,
      fillOpacity: 0.35,
    });
    marker.bindPopup(
      `<b>${esc(s.title)}</b>` +
      `<br><span class="meta">${esc(s.basin ?? "—")} basin · ${esc(s.trend ?? "—")}</span>` +
      `<br>${s.waterLevel} m` +
      (s.warningLevel != null ? ` · warning ${s.warningLevel} m` : " · no warning level published") +
      (s.dangerLevel != null ? ` · danger ${s.dangerLevel} m` : "") +
      (head != null ? `<br><b>${head > 0 ? `${head} m below warning` : `${Math.abs(head)} m ABOVE warning`}</b>` : "") +
      `<br><span class="meta">observed ${asOf(s.observedAt)} · ${esc(s.dataSource ?? "DHM")}</span>`
    );
    group.addLayer(marker);
  }
  layers.stations = group.addTo(map);
  fit(pts.map((s) => s.point));
}

/** Roadblocks — square markers, so they never read as gauges. */
export function showRoads(roads) {
  showOnly("roads");
  const pts = roads.filter((r) => r.point);
  if (!pts.length) return;

  const group = L.layerGroup();
  for (const r of pts) {
    const color = STATUS_COLOR[r.status] ?? STATUS_COLOR.unknown;
    const marker = L.marker(r.point, {
      icon: L.divIcon({
        className: "",
        iconSize: [12, 12],
        html: `<div style="width:12px;height:12px;background:${color}33;border:1.5px solid ${color}"></div>`,
      }),
    });
    marker.bindPopup(
      `<b>${esc(r.road ?? "")} ${esc(r.title)}</b>` +
      `<br><span class="meta">${esc(r.location ?? "")} · ${esc(r.status)}</span>` +
      (r.closureReason ? `<br>${esc(r.closureReason)}` : "") +
      (r.householdsCutOff ? `<br><b>${r.householdsCutOff.toLocaleString()} households cut off</b>` : "") +
      (r.efforts ? `<br><span class="meta">${esc(r.efforts)}</span>` : "") +
      (r.repairEta ? `<br><span class="meta">estimated ${esc(r.repairEta)}` +
        (r.actualRepairTime ? ` · actually took ${esc(r.actualRepairTime)}` : "") + `</span>` : "") +
      (r.contactPerson ? `<br><span class="meta">contact: ${esc(r.contactPerson)} (Department of Roads)</span>` : "")
    );
    group.addLayer(marker);
  }
  layers.roads = group.addTo(map);
  fit(pts.map((r) => r.point));
}

/** Facilities — the places a person can actually go. */
export function showResources(resources) {
  showOnly("resources");
  const pts = resources.filter((r) => r.point);
  if (!pts.length) return;

  const group = L.layerGroup();
  for (const r of pts) {
    group.addLayer(
      L.marker(r.point, {
        icon: L.divIcon({
          className: "",
          iconSize: [14, 14],
          html:
            `<div style="width:14px;height:14px;border:1.5px solid #199e70;background:#199e7033;` +
            `transform:rotate(45deg)"></div>`,
        }),
      }).bindPopup(
        `<b>${esc(r.title)}</b>` +
        (r.titleNe ? `<br><span class="meta">${esc(r.titleNe)}</span>` : "") +
        `<br><span class="meta">${esc(r.label ?? r.type)} · ${r.km} km away</span>`
      )
    );
  }
  layers.resources = group.addTo(map);
  fit(pts.map((r) => r.point));
}

/** Coverage gaps — hollow rings. Absence should look like absence. */
export function showGaps(gaps) {
  showOnly("gaps");
  const pts = gaps.filter((g) => g.point);
  if (!pts.length) return;

  const group = L.layerGroup();
  for (const g of pts) {
    group.addLayer(
      L.circleMarker(g.point, {
        radius: Math.min(5 + g.incidents * 0.4, 11),
        color: "#fab219",
        weight: 1.5,
        opacity: 0.75,
        fill: false,
        dashArray: "2 3",
      }).bindPopup(
        `<b>${esc(g.municipality)}</b>` +
        (g.municipalityNe ? `<br><span class="meta">${esc(g.municipalityNe)}</span>` : "") +
        `<br><span class="meta">${esc(g.district ?? "")}</span>` +
        `<br>${g.incidents} incidents · ${g.deaths} deaths` +
        `<br><b>No registered facility of this type</b>` +
        `<br><span class="meta">last incident ${asOf(g.lastIncident)}</span>`
      )
    );
  }
  layers.gaps = group.addTo(map);
  fit(pts.map((g) => g.point));
}

/** GDACS alert footprint — underneath everything, low opacity. */
export function showAlertGeometry(geojson) {
  clear("alert");
  try {
    // Outline only. GDACS flood footprints span most of the country, and a
    // filled polygon that size tints the entire basemap red — which reads as
    // "everywhere is in danger" rather than as the alert boundary it is.
    layers.alert = L.geoJSON(geojson, {
      style: { color: "#d03b3b", weight: 1, opacity: 0.45, fill: false, dashArray: "5 5" },
      interactive: false,
    }).addTo(map);
    layers.alert.bringToBack();
  } catch {
    /* geometry is optional context; never let it break the view */
  }
}

export function focusLiveEvent() {
  map?.setView(LIVE_EVENT.center, 10);
}

export function focusPoint(latlon, zoom = 12) {
  if (latlon) map?.setView(latlon, zoom);
}

function fit(points) {
  const valid = points.filter(Boolean);
  if (!valid.length) return;
  if (valid.length === 1) return map.setView(valid[0], 11);
  map.fitBounds(L.latLngBounds(valid).pad(0.15), { maxZoom: 12 });
}
