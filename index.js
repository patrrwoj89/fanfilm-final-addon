const express = require('express');
const axios = require('axios');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

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
const TTL = 1000 * 60 * 30; // 30 minut

const getCache = (key) => {
  const data = cache.get(key);
  if (!data) return null;
  if (Date.now() - data.t > TTL) {
    cache.delete(key);
    return null;
  }
  return data.v;
};

const setCache = (key, value) => cache.set(key, { v: value, t: Date.now() });

// =====================
// MANIFEST
// =====================
const manifest = {
  id: "org.fanfilm.final",
  version: "8.0.0",
  name: "FanFilm FINAL",
  description: "Stremio addon (TMDB + katalog + seriale)",
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "movies", name: "🎬 Popularne filmy" },
    { type: "series", id: "series", name: "📺 Popularne seriale" }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["tmdb:"]
};

const builder = new addonBuilder(manifest);

// =====================
// TMDB FETCH
// =====================
async function fetchTMDB(type) {
  const key = "tmdb_" + type;
  const cached = getCache(key);
  if (cached) return cached;

  const urlType = type === "series" ? "tv" : "movie";
  const res = await axios.get(
    `https://api.themoviedb.org/3/${urlType}/popular?api_key=${TMDB_KEY}&language=pl-PL`
  );

  const data = res.data.results.map(x => ({
    id: "tmdb:" + x.id,
    name: x.title || x.name,
    poster: x.poster_path ? `https://image.tmdb.org/t/p/w500${x.poster_path}` : "",
    type: type === "movie" ? "movie" : "series"
  }));

  setCache(key, data);
  return data;
}

// =====================
// META HANDLER
// =====================
builder.defineMetaHandler(async ({ id, type }) => {
  if (type !== "series") return { meta: {} };

  const tmdbId = id.replace("tmdb:", "");
  const res = await axios.get(
    `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=pl-PL`
  );

  const videos = [];
  res.data.seasons.forEach(season => {
    for (let i = 1; i <= season.episode_count; i++) {
      videos.push({
        id: `${id}:${season.season_number}:${i}`,
        title: `S${season.season_number}E${i}`,
        season: season.season_number,
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
// STREAM HANDLER (demo)
// =====================
builder.defineStreamHandler(async () => ({
  streams: [
    {
      title: "Demo stream",
      url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
    }
  ]
}));

// =====================
// CATALOG HANDLER
// =====================
builder.defineCatalogHandler(async ({ type }) => {
  if (type === "movie") return { metas: await fetchTMDB("movie") };
  if (type === "series") return { metas: await fetchTMDB("series") };
  return { metas: [] };
});

// =====================
// EXPRESS + STREMIO
// =====================
(async () => {
  const stremioMiddleware = await serveHTTP(builder.getInterface());

  // manifest.json dla Stremio
  app.get('/manifest.json', (req, res) => res.json(manifest));

  // Stremio addon middleware
  app.use('/', stremioMiddleware);

  // start serwera
  app.listen(PORT, () => {
    console.log(`🔥 FanFilm FINAL działa na porcie ${PORT}`);
  });
})();