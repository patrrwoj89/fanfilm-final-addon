const express = require("express");
const fetch = (...args) => import("node-fetch").then(({default: f}) => f(...args));
const app = express();
const port = process.env.PORT || 3000;

// -----------------------------
// ENVIRONMENT VARIABLES
// -----------------------------
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const CDA_USERNAME = process.env.CDA_USERNAME;
const CDA_PASSWORD = process.env.CDA_PASSWORD;

// -----------------------------
// ŹRÓDŁA
// -----------------------------
const SOURCES = [
  { name: "AIO", base: "https://aiostreams.fortheweak.cloud/stremio/3bf791af-d2c5-4d2a-892c-4cbb93106083/" },
  { name: "TorBox", base: "https://stremio.torbox.app/538c81f1-543c-4bed-bcb2-51ce204e03be/" },
  { name: "HubCloud", base: "https://hub.oreao-cdn.buzz/" },
  { name: "Peerflix", base: "https://peerflix.example.com/api/" },
  { name: "Viren", base: "https://aiostreams.viren070.com/" }
];

// -----------------------------
// CDA AUTH
// -----------------------------
let cdaToken = null;
async function loginCDA() {
  if (!CDA_USERNAME || !CDA_PASSWORD) return null;
  try {
    const res = await fetch(`https://cda.pl/api/auth/login`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ login: CDA_USERNAME, password: CDA_PASSWORD })
    });
    const json = await res.json();
    cdaToken = json.token || null;
    return cdaToken;
  } catch (e) {
    console.error("CDA login failed:", e.message);
    return null;
  }
}

async function fetchCDA(path) {
  if (!cdaToken) await loginCDA();
  if (!cdaToken) return null;
  try {
    const res = await fetch(`https://cda.pl/api/${path}`, {
      headers: { Authorization: `Bearer ${cdaToken}` }
    });
    return await res.json();
  } catch (e) {
    console.error("CDA fetch failed:", e.message);
    return null;
  }
}

// -----------------------------
// HELPERS
// -----------------------------
async function fetchFromSource(src, path) {
  try {
    const url = src.name === "CDA"
      ? `stream/${path}`  // CDA handled separately
      : `${src.base}${path}`;
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    console.error(`Fetch err from ${src.name}:`, e.message);
    return null;
  }
}

function filterPL(streams) {
  return streams.filter(s => {
    const name = (s.name || "").toLowerCase();
    const desc = (s.description || "").toLowerCase();
    // polski lektor / dubbing / napisy
    return name.includes("🇵🇱") ||
           desc.includes("🇵🇱") ||
           (desc.includes("jp") && desc.includes("pl"));
  });
}

function uniqueById(arr) {
  const s = new Set();
  return arr.filter(item => {
    if (s.has(item.id)) return false;
    s.add(item.id);
    return true;
  });
}

// -----------------------------
// STREAMY
// -----------------------------
app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  let allStreams = [];

  // CDA
  if (CDA_USERNAME && CDA_PASSWORD) {
    const cdaData = await fetchCDA(`stream/${id}.json`);
    if (cdaData && cdaData.streams) allStreams.push(...cdaData.streams);
  }

  // pozostałe źródła
  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `stream/${id}.json`);
    if (data && data.streams) allStreams.push(...data.streams);
  }

  const filtered = filterPL(allStreams);
  res.json({ streams: filtered });
});

// -----------------------------
// KATALOG
// -----------------------------
app.get("/catalog/:type/:id.json", async (req, res) => {
  let metas = [];

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `catalog/${id}.json`);
    if (data && data.metas) metas.push(...data.metas);
  }

  const unique = uniqueById(metas);
  res.json({ metas: unique });
});

// -----------------------------
// MANIFEST
// -----------------------------
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fanfilm.proplus",
    version: "6.0.0",
    name: "FanFilm PRO+",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: "m", name: "Filmy" },
      { type: "series", id: "s", name: "Seriale" }
    ],
    idPrefixes: ["tmdb:"]
  });
});

// -----------------------------
// START
// -----------------------------
app.listen(port, () => {
  console.log(`FanFilm PRO+ live on port ${port}`);
});