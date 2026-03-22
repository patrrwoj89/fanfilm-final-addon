const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { AddonBuilder, createRouter } = require('@stremio-addon/sdk');
require('dotenv').config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;
const TMDB = process.env.TMDB_API_KEY;
const CDA_LOGIN = process.env.CDA_LOGIN;
const CDA_PASS = process.env.CDA_PASSWORD;

const http = axios.create({ timeout: 4500 });

// =====================
// CACHE PRO (LRU 25)
// =====================
const cache = new Map();
const TTL = 1000 * 60 * 5;

function getC(k) {
    const v = cache.get(k);
    if (!v) return null;
    if (Date.now() - v.t > TTL) {
        cache.delete(k);
        return null;
    }
    return v.v;
}

function setC(k, v) {
    if (cache.size >= 25) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(k, { v, t: Date.now() });
}

// =====================
// CDA
// =====================
let cdaToken = null;
let cdaBlock = 0;

async function cdaLogin() {
    if (Date.now() < cdaBlock) return null;
    if (cdaToken) return cdaToken;

    try {
        const r = await http.post('https://cda.pl/api/user/login', {
            login: CDA_LOGIN,
            password: CDA_PASS
        });
        cdaToken = r.data.token;
        return cdaToken;
    } catch {
        cdaBlock = Date.now() + 1000 * 60 * 15;
        return null;
    }
}

async function cdaStreams(id) {
    try {
        const t = await cdaLogin();
        if (!t) return [];

        const r = await http.get(`https://cda.pl/api/video/${id}/sources`, {
            headers: { Authorization: `Bearer ${t}` }
        });

        return (r.data.streams || []).map(s => ({
            ...s,
            title: `📺 CDA | ${s.title}`
        })).slice(0, 5);
    } catch {
        return [];
    }
}

// =====================
// TMDB → IMDB
// =====================
async function toImdb(id, type) {
    const c = getC("imdb_" + id);
    if (c) return c;

    try {
        const tid = id.split(":")[1];
        const url = type === "movie"
            ? `https://api.themoviedb.org/3/movie/${tid}/external_ids?api_key=${TMDB}`
            : `https://api.themoviedb.org/3/tv/${tid}/external_ids?api_key=${TMDB}`;

        const r = await http.get(url);
        const imdb = r.data.imdb_id;

        setC("imdb_" + id, imdb);
        return imdb;
    } catch {
        return null;
    }
}

// =====================
// SCORING PRO+
// =====================
function score(s) {
    const t = (s.title || "").toLowerCase();
    let val = 0;

    if (t.includes("2160") || t.includes("4k")) val += 50;
    else if (t.includes("1080")) val += 35;
    else if (t.includes("720")) val += 20;
    else if (t.includes("480")) val += 10;

    if (t.includes("dubbing")) val += 30;
    else if (t.includes("lektor")) val += 25;
    else if (t.includes("napisy")) val += 15;

    if (t.includes("realdebrid")) val += 20;

    return val;
}

// =====================
// BUILDER
// =====================
const AIO = "https://aiostreams.fortheweak.cloud";

const builder = new AddonBuilder({
    id: "fanfilm.proplus",
    version: "5.0.0",
    name: "FanFilm PRO+",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "m", name: "Filmy" },
        { type: "series", id: "s", name: "Seriale" }
    ],
    idPrefixes: ["tmdb:"]
});

// =====================
// STREAM PRO+
// =====================
builder.defineStreamHandler(async ({ type, id }) => {
    try {
        let sid = id;

        if (id.startsWith("tmdb:")) {
            const imdb = await toImdb(id, type);
            if (imdb) sid = imdb;
        }

        const cacheKey = "s_" + sid;
        const cached = getC(cacheKey);
        if (cached) return { streams: cached };

        let streams = [];

        // AIO
        try {
            const r = await http.get(`${AIO}/stream/${type}/${sid}.json`);
            streams = r.data.streams || [];
        } catch {}

        // PL FILTER
        const pl = streams.filter(s => {
            const t = (s.title || "").toLowerCase();
            return t.includes("pl") || t.includes("lektor") || t.includes("dubbing") || t.includes("napisy");
        });

        if (pl.length > 0) streams = pl;

        // SORT
        streams.sort((a, b) => score(b) - score(a));

        streams = streams.slice(0, 10);

        // CDA fallback
        if (streams.length < 3) {
            const cda = await cdaStreams(sid);
            streams = [...streams, ...cda];
        }

        setC(cacheKey, streams);
        return { streams };

    } catch {
        return { streams: [] };
    }
});

// =====================
// CATALOG
// =====================
builder.defineCatalogHandler(async ({ type }) => {
    try {
        const key = "list_" + type;
        const c = getC(key);
        if (c) return { metas: c };

        const r = await http.get(`https://api.themoviedb.org/3/${type === "movie" ? "movie" : "tv"}/popular?api_key=${TMDB}`);
        const data = r.data.results.slice(0, 20).map(x => ({
            id: `tmdb:${x.id}`,
            name: x.title || x.name,
            type: type
        }));

        setC(key, data);
        return { metas: data };
    } catch {
        return { metas: [] };
    }
});

// =====================
// ROUTER
// =====================
const router = createRouter(builder.getInterface());

app.use(async (req, res, next) => {
    try {
        const r = await router(new Request(`http://x${req.url}`));
        if (!r) return next();

        res.status(r.status);
        res.send(await r.text());
    } catch {
        next();
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log("🔥 PRO+ działa");
});