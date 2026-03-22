import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Konfiguracja __dirname dla ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware JSON
app.use(express.json());

// ======================
// KONFIGURACJA I ŹRÓDŁA
// ======================
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const CDA_USERNAME = process.env.CDA_USERNAME;
const CDA_PASSWORD = process.env.CDA_PASSWORD;

// Źródła
const SOURCES = [
  { name: "AIO", base: "https://aiostreams.fortheweak.cloud/stremio/3bf791af-d2c5-4d2a-892c-4cbb93106083/" },
  { name: "TorBox", base: "https://stremio.torbox.app/538c81f1-543c-4bed-bcb2-51ce204e03be/" },
  { name: "HubCloud", base: "https://hub.oreao-cdn.buzz/" },
  { name: "Peerflix", base: "https://peerflix.example.com/api/" },
  { name: "Viren", base: "https://aiostreams.viren070.com/" }
];

let cdaToken = null;

// ======================
// CDA LOGIN I FETCH
// ======================
async function loginCDA() {
  if (!CDA_USERNAME || !CDA_PASSWORD) return null;
  try {
    const res = await fetch(`https://cda.pl/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

// ======================
// FETCH Z INNYCH ŹRÓDEŁ
// ======================
async function fetchFromSource(src, path) {
  try {
    const url = src.name === "CDA" ? `stream/${path}` : `${src.base}${path}`;
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    console.error(`Fetch error from ${src.name}:`, e.message);
    return null;
  }
}

// ======================
// FILTROWANIE I UNIKALNE
// ======================
function filterPL(streams) {
  return streams.filter(s => {
    const name = (s.name || "").toLowerCase();
    const desc = (s.description || "").toLowerCase();
    return name.includes("🇵🇱") || desc.includes("🇵🇱") || (desc.includes("jp") && desc.includes("pl"));
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

// ======================
// TMDB METADATA
// ======================
async function fetchTMDBMetadata(tmdbId, type) {
  try {
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=pl-PL`;
    const res = await fetch(url);
    const json = await res.json();
    return {
      id: `tmdb:${tmdbId}`,
      name: json.title || json.name || "Brak tytułu",
      poster: json.poster_path ? `https://image.tmdb.org/t/p/w500${json.poster_path}` : null,
      description: json.overview || "",
      year: (json.release_date || json.first_air_date || "").slice(0, 4),
      type: type
    };
  } catch (e) {
    console.error("TMDB fetch failed:", e.message);
    return null;
  }
}

// ======================
// ENDPOINT STREAM
// ======================
app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  let allStreams = [];

  if (CDA_USERNAME && CDA_PASSWORD) {
    const cdaData = await fetchCDA(`stream/${id}.json`);
    if (cdaData && cdaData.streams) allStreams.push(...cdaData.streams);
  }

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `stream/${id}.json`);
    if (data && data.streams) allStreams.push(...data.streams);
  }

  const filtered = filterPL(allStreams);
  res.json({ streams: filtered });
});

// ======================
// ENDPOINT KATALOG
// ======================
app.get("/catalog/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const type = req.params.type;
  const tmdbId = id.replace("tmdb:", "");
  let metas = [];

  const meta = await fetchTMDBMetadata(tmdbId, type);
  if (meta) metas.push(meta);

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `catalog/${id}.json`);
    if (data && data.metas) metas.push(...data.metas);
  }

  const unique = uniqueById(metas);
  res.json({ metas: unique });
});

// ======================
// MANIFEST
// ======================
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fanfilm.proplus",
    version: "6.1.0",
    name: "FanFilm PRO+",
    description: "Addon do Stremio z polskimi streamami filmów, seriali i anime (PL / JP+PL). Automatyczne postery i opisy z TMDB.",
    resources: ["catalog", "stream"],
    types: ["movie","series"],
    catalogs: [
      { type: "movie", id: "m", name: "Filmy" },
      { type: "series", id: "s", name: "Seriale" }
    ],
    idPrefixes: ["tmdb:"]
  });
});

// ======================
// DASHBOARD / ROOT
// ======================
app.get('/', (req, res) => {
  res.send(`
    <h1>🎬 FanFilm PRO+ działa!</h1>
    <p>Status API: <a href="/api/status">/api/status</a></p>
    <p>Statyczne pliki: <a href="/static/">/static/</a></p>
    <p>Serwis jest utrzymywany online dzięki self-ping co 5 minut.</p>
  `);
});

// ======================
// API STATUS
// ======================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptime: process.uptime().toFixed(0) + 's'
  });
});

// ======================
// STATYCZNE PLIKI
// ======================
app.use('/static', express.static(path.join(__dirname, 'public')));

// ======================
// START SERWERA
// ======================
app.listen(PORT, () => {
  console.log(`🚀 FanFilm PRO+ live na porcie ${PORT}`);
});

// ======================
// SELF-PING CO 5 MINUT
// ======================
const SELF_URL = process.env.SELF_URL || `https://aio-cda.onrender.com`;

setInterval(async () => {
  try {
    await fetch(SELF_URL);
    console.log(`✅ Self-ping wykonany, serwis podtrzymany online`);
  } catch (err) {
    console.error(`❌ Błąd self-pingu:`, err);
  }
}, 5 * 60 * 1000);
