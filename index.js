const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { addonBuilder, serveHTTP } = require('@stremio-addon/sdk/lib/index'); // Poprawiony import
require('dotenv').config();

const app = express();
app.use(cors()); // Obsługa CORS

const TMDB_KEY = process.env.TMDB_API_KEY;
const PORT = process.env.PORT || 7000;

// =====================
// PROSTA PAMIĘĆ CACHE
// =====================
const cache = new Map();
const TTL = 1000 * 60 * 30; // 30 minut

function getCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.t > TTL) {
        cache.delete(key);
        return null;
    }
    return entry.v;
}

function setCache(key, value) {
    cache.set(key, { v: value, t: Date.now() });
}

// =====================
// MANIFEST
// =====================
const manifest = {
    id: "org.fanfilm.final",
    version: "1.0.0",
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
// POBIERANIE POPULARNYCH
// =====================
async function fetchTMDB(type) {
    const key = `tmdb_${type}`;
    const cached = getCache(key);
    if (cached) return cached;

    try {
        const res = await axios.get(
            `https://api.themoviedb.org/3/${type}/popular?api_key=${TMDB_KEY}&language=pl-PL`
        );

        const data = res.data.results.map(x => ({
            id: `tmdb:${x.id}`,
            name: x.title || x.name,
            poster: x.poster_path ? `https://image.tmdb.org/t/p/w500${x.poster_path}` : "",
            type: type === "movie" ? "movie" : "series"
        }));

        setCache(key, data);
        return data;
    } catch (error) {
        console.error("Błąd pobierania danych TMDB:", error.message);
        return [];
    }
}

// =====================
// META DLA SERI
// =====================
builder.defineMetaHandler(async ({ id, type }) => {
    if (type !== "series") return { meta: {} };

    const tmdbId = id.replace("tmdb:", "");
    try {
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
                poster: res.data.poster_path ? `https://image.tmdb.org/t/p/w500${res.data.poster_path}` : "",
                backdrop: res.data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${res.data.backdrop_path}` : "",
                summary: res.data.overview,
                genres: res.data.genres.map(g => g.name),
                year: res.data.first_air_date?.split('-')[0],
                videos
            }
        };
    } catch (error) {
        console.error("Błąd pobierania metadanych serialu:", error.message);
        return { meta: {} };
    }
});

// =====================
// STREAM DEMO
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
// KATALOG
// =====================
builder.defineCatalogHandler(async ({ type }) => {
    if (type === "movie") return { metas: await fetchTMDB("movie") };
    if (type === "series") return { metas: await fetchTMDB("tv") };
    return { metas: [] };
});

// =====================
// EXPRESS + STREMIO
// =====================
app.get('/manifest.json', (req, res) => res.json(manifest));

(async () => {
    const stremioAddon = await serveHTTP(builder.getInterface(), { app });
    app.use('/', stremioAddon.middleware);

    app.listen(PORT, () => {
        console.log(`🔥 FanFilm FINAL działa na porcie ${PORT}`);
    });
})();
