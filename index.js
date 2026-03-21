const express = require('express');
const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');

const app = express();
const PORT = process.env.PORT || 7000;

// =====================
// CONFIG
// =====================
const TMDB_KEY = "02951f2ed7350a9bda520334ca76b647";

// =====================
// CACHE
// =====================
const cache = new Map();
const TTL = 1000 * 60 * 30;

const getCache = k => {
  const d = cache.get(k);
  if (!d) return null;
  if (Date.now() - d.t > TTL) {
    cache.delete(k);
    return null;
  }
  return d.v;
};

const setCache = (k, v) => cache.set(k, { v, t: Date.now() });

// =====================
// MANIFEST
// =====================
const manifest = {
  id: "org.fanfilm.clean",
  version: "7.0.0",
  name: "FanFilm CLEAN",
  description: "Stabilny addon Stremio (TMDB + struktura)",
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "movies", name: "Popularne filmy" },
    { type: "series", id: "series", name: "Popularne seriale" }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["tmdb:"]
};

const builder = new addonBuilder(manifest);

// =====================
// TMDB
// =====================
async function fetchTMDB(type) {
  const key = "tmdb_" + type;
  const cached = getCache(key);
  if (cached) return cached;

  const res = await axios.get(
    `https://api.themoviedb.org/3/${type}/popular?api_key=${TMDB_KEY}&language=pl-PL`
  );

  const data = res.data.results.map(x => ({
    id: "tmdb:" + x.id,
    name: x.title || x.name,
    poster: x.poster_path
      ? `https://image.tmdb.org/t/p/w500${x.poster_path}`
      : "",
    type: type === "movie" ? "movie" : "series"
  }));

  setCache(key, data);
  return data;
}

// =====================
// META (seriale)
// =====================
builder.defineMetaHandler(async ({ id, type }) => {
  if (type !== "series") return { meta: {} };

  const tmdbId = id.replace("tmdb:", "");
  const res = await axios.get(
    `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=pl-PL`
  );

  const videos = [];

  res.data.seasons.forEach(s => {
    for (let i = 1; i <= s.episode_count; i++) {
      videos.push({
        id: `${id}:${s.season_number}:${i}`,
        title: `S${s.season_number}E${i}`,
        season: s.season_number,
        episode: i
      });
    }
  });

  return {
    meta: {
      id,
      type: "series",
      name: res.data.name,
      videos
    }
  };
});

// =====================
// STREAM (DEMO SAFE)
// =====================
builder.defineStreamHandler(async ({ id }) => {
  return {
    streams: [
      {
        title: "Demo stream",
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
      }
    ]
  };
});

// =====================
// CATALOG
// =====================
builder.defineCatalogHandler(async ({ type }) => {
  if (type === "movie") return { metas: await fetchTMDB("movie") };
  if (type === "series") return { metas: await fetchTMDB("tv") };
  return { metas: [] };
});

// =====================
app.use('/manifest.json', (req, res) => res.json(manifest));
app.use('/', builder.getInterface());

app.listen(PORT, () =>
  console.log("🔥 FanFilm CLEAN działa na porcie " + PORT)
);