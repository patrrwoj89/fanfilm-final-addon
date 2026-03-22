const express = require('express');
const fetch = require('node-fetch');
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
// STREAMY z FILTREM PL / JP+PL
// -----------------------------
async function fetchStreams(id) {
  let allStreams = [];

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `stream/${id}.json`);
    if (data && data.streams) allStreams = allStreams.concat(data.streams);
  }

  // Filtr PL i JP+PL dla anime
  const plStreams = allStreams.filter(s =>
    s.name.includes('🇵🇱') ||
    (s.description && s.description.includes('🇵🇱')) ||
    (s.description && s.description.includes('🇯🇵') && s.description.includes('PL'))
  );

  // Sortowanie po jakości
  return plStreams.sort((a,b) => {
    const qa = (a.name.match(/\d+p/) || ['0'])[0].replace('p','')*1;
    const qb = (b.name.match(/\d+p/) || ['0'])[0].replace('p','')*1;
    return qb - qa;
  });
}

// -----------------------------
// KATALOG (FILMY i SERIALE) — tylko PL
// -----------------------------
app.get('/catalog/:type/:id.json', async (req, res) => {
  const id = req.params.id; // "m" lub "s"
  if (catalogCache[id]) return res.json({ metas: catalogCache[id] });

  let allMetas = [];

  for (const src of SOURCES) {
    const data = await fetchFromSource(src, `catalog/${id}.json`);
    if (data && data.metas) allMetas = allMetas.concat(data.metas);
  }

  // Sprawdzenie, które mają PL streamy
  const metasWithPL = [];
  for (const meta of allMetas) {
    const streams = await fetchStreams(meta.id);
    if (streams.length > 0) {
      // opcjonalnie TMDB dane
      try {
        const tmdbId = meta.id.replace('tmdb:', '');
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/${req.params.type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=pl-PL`);
        const tmdbData = await tmdbRes.json();
        meta.poster = tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null;
        meta.overview = tmdbData.overview || meta.overview;
      } catch {}
      metasWithPL.push(meta);
    }
  }

  const uniqueMetas = uniqueById(metasWithPL);
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
// START SERVER
// -----------------------------
app.listen(port, () => {
  console.log(`FanFilm PRO+ PL-only katalog running on port ${port}`);
});