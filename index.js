// app.js
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import LRUCache from 'lru-cache';
import dotenv from 'dotenv';

dotenv.config(); // ładowanie zmiennych środowiskowych
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
  console.error("🚨 Brak TMDB_API_KEY w .env!");
  process.exit(1);
}

// =====================
// CACHE LRU
// =====================
const cache = new LRUCache({
  max: 100,         // maksymalna liczba elementów
  ttl: 60 * 60 * 1000 // TTL 1h
});

// =====================
// MANIFEST
// =====================
const addon = addonBuilder({
  id: 'org.stremio.fanfilm',
  version: '1.0.0',
  name: 'FanFilm Modern',
  description: 'Nowoczesny Stremio Addon (TMDB + katalog + seriale)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'moviecatalog', name: '🎬 Popularne filmy' },
    { type: 'series', id: 'seriescatalog', name: '📺 Popularne seriale' }
  ],
  idPrefixes: ['tt']
});

// =====================
// HANDLER KATALOGU
// =====================
addon.defineCatalogHandler(async ({ type, id }) => {
  try {
    const cacheKey = `catalog-${type}-${id}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let url;
    if (type === 'movie') url = `${TMDB_BASE_URL}/movie/popular`;
    else if (type === 'series') url = `${TMDB_BASE_URL}/tv/popular`;
    else return { metas: [] };

    const response = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'pl-PL' } });
    const metas = response.data.results.map(item => ({
      id: `tt${item.id}`,
      type,
      name: item.title || item.name,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined
    }));

    cache.set(cacheKey, { metas });
    return { metas };
  } catch (error) {
    console.error('Błąd pobierania katalogu:', error.message);
    return { metas: [] };
  }
});

// =====================
// HANDLER META
// =====================
addon.defineMetaHandler(async ({ id, type }) => {
  if (!id.startsWith('tt')) return null;
  try {
    const cacheKey = `meta-${type}-${id}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const tmdbId = id.substring(2);
    const url = type === 'movie' ? `${TMDB_BASE_URL}/movie/${tmdbId}` : `${TMDB_BASE_URL}/tv/${tmdbId}`;
    const response = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'pl-PL' } });
    const data = response.data;

    const meta = {
      id,
      type,
      name: data.title || data.name,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
      description: data.overview
    };

    cache.set(cacheKey, meta);
    return meta;
  } catch (error) {
    console.error(`Błąd pobierania metadanych dla ${id}:`, error.message);
    return null;
  }
});

// =====================
// HANDLER STREAM
// =====================
addon.defineStreamHandler(async ({ id, type }) => {
  if (!id.startsWith('tt')) return null;
  try {
    const cacheKey = `stream-${type}-${id}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const tmdbId = id.substring(2);
    const url = type === 'movie' ? `${TMDB_BASE_URL}/movie/${tmdbId}/videos` : `${TMDB_BASE_URL}/tv/${tmdbId}/videos`;
    const response = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'pl-PL' } });
    const videos = response.data.results;

    if (!videos.length) return null;

    const streams = videos.map(video => ({
      url: `https://www.youtube.com/watch?v=${video.key}`,
      title: video.name
    }));

    cache.set(cacheKey, { streams });
    return { streams };
  } catch (error) {
    console.error(`Błąd pobierania strumieni dla ${id}:`, error.message);
    return null;
  }
});

// =====================
// EXPRESS + CORS
// =====================
const app = express();
app.use(cors());
serveHTTP(addon.getInterface(), { port: 7000, app });

console.log('🔥 FanFilm Modern działa na porcie 7000');