const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// -----------------------------
// DANE KONFIGURACYJNE Z ENV
// -----------------------------
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const CDA_USERNAME = process.env.CDA_USERNAME;
const CDA_PASSWORD = process.env.CDA_PASSWORD;

// -----------------------------
// WSZYSTKIE ŹRÓDŁA
// -----------------------------
const SOURCES = [
  { name: 'AIO', base: 'https://aiostreams.fortheweak.cloud/stremio/3bf791af-d2c5-4d2a-892c-4cbb93106083/' },
  { name: 'TorBox', base: 'https://stremio.torbox.app/538c81f1-543c-4bed-bcb2-51ce204e03be/' },
  { name: 'Peerflix', base: 'https://peerflix.example.com/api/' },
  { name: 'HubCloud', base: 'https://hub.oreao-cdn.buzz/' },
  { name: 'CDA', base: 'https://cda.pl/api/' },
  { name: 'Viren', base: 'https://aiostreams.viren070.com/' }
];

// -----------------------------
// CACHE
// -----------------------------
const catalogCache = {};
const streamCache = {};

// -----------------------------
// HELPERS
// -----------------------------
function uniqueById(arr) {
  const seen = new Set();
  return arr.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function fetchFromSource(src, path) {
  try {
    const res = await fetch(`${src.base}${path}`);
    return await res.json();
  } catch (e) {
    console.error(`Błąd fetchowania z ${src.name}:`, e.message);
    return null;
  }
}

// -----------------------------
// STREAMY (tymczasowo BEZ filtra PL)
// -----------------------------
async function fetchStreams(id) {
  let allStreams = [];

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `stream/${id}.json`);
    if (data && data.streams) allStreams = allStreams.concat(data.streams);
  }

  // Tymczasowo bez filtra PL
  return allStreams;
}

// -----------------------------
// KATALOG (FILMY i SERIALE) — wszystkie dla testu
// -----------------------------
app.get('/catalog/:type/:id.json', async (req, res) => {
  const id = req.params.id; // "m" lub "s"
  if (catalogCache[id]) return res.json({ metas: catalogCache[id] });

  let allMetas = [];

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `catalog/${id}.json`);
    if (data && data.metas) allMetas = allMetas.concat(data.metas);
  }

  const uniqueMetas = uniqueById(allMetas);
  catalogCache[id] = uniqueMetas;
  res.json({ metas: uniqueMetas });
});

// -----------------------------
// STREAMY ENDPOINT
// -----------------------------
app.get('/stream/:type/:id.json', async (req, res) => {
  const id = req.params.id;
  if (streamCache[id]) return res.json({ streams: streamCache[id] });
  const streams = await fetchStreams(id);
  streamCache[id] = streams;
  res.json({ streams });
});

// -----------------------------
// MANIFEST
// -----------------------------
app.get('/manifest.json', (req, res) => {
  res.json({
    "id": "fanfilm.proplus",
    "version": "5.0.0",
    "name": "FanFilm PRO+",
    "resources": ["catalog", "stream"],
    "types": ["movie", "series"],
    "catalogs": [
      { "type": "movie", "id": "m", "name": "Filmy" },
      { "type": "series", "id": "s", "name": "Seriale" }
    ],
    "idPrefixes": ["tmdb:"]
  });
});

// -----------------------------
// START SERVER
// -----------------------------
app.listen(port, () => {
  console.log(`FanFilm PRO+ katalog running on port ${port}`);
});