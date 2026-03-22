// index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { AddonBuilder, createRouter } = require('@stremio-addon/sdk');
require('dotenv').config();

const app = express();
app.use(cors());

const TMDB_KEY = process.env.TMDB_API_KEY;
const CDA_LOGIN = process.env.CDA_LOGIN;     
const CDA_PASSWORD = process.env.CDA_PASSWORD;
const PORT = process.env.PORT || 5000;

// =====================
// CACHE
// =====================
const cache = new Map();
const TTL = 1000 * 60 * 30; // 30 minut
function getCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.t > TTL) { cache.delete(key); return null; }
    return entry.v;
}
function setCache(key, value) { cache.set(key, { v: value, t: Date.now() }); }

// =====================
// MANIFEST
// =====================
const manifest = {
    id: "org.fanfilm.final",
    version: "3.0.0",
    name: "FanFilm PRO",
    description: "Stremio addon (TMDB + seriale + anime 480p+ + AIOStreams + CDA fallback)",
    types: ["movie","series"],
    catalogs: [
        { type:"movie", id:"movies", name:"🎬 Popularne filmy" },
        { type:"series", id:"series", name:"📺 Popularne seriale" },
        { type:"series", id:"anime", name:"🍥 Anime (480p+)" }
    ],
    resources:["catalog","meta","stream"],
    idPrefixes:["tmdb:"]
};
const builder = new AddonBuilder(manifest);

// =====================
// CDA PREMIUM LOGIN
// =====================
let cdaToken = null;
let cdaTokenExpiry = 0;
async function loginCDA() {
    if (cdaToken && Date.now() < cdaTokenExpiry) return cdaToken;
    try {
        const res = await axios.post('https://cda.pl/api/user/login', {
            login: CDA_LOGIN,
            password: CDA_PASSWORD
        });
        cdaToken = res.data.token;
        cdaTokenExpiry = Date.now() + 1000 * 60 * 50; // 50 minut
        return cdaToken;
    } catch(e) {
        console.error("CDA login error:", e.message);
        return null;
    }
}

// =====================
// FETCH CDA STREAMS
// =====================
async function fetchCDAStreams(id) {
    try {
        const token = await loginCDA();
        if (!token) return [];
        const res = await axios.get(`https://cda.pl/api/video/${id}/sources`, {
            headers:{ Authorization:`Bearer ${token}` }
        });
        let streams = res.data.streams || [];
        streams = streams.filter(s => {
            const t = (s.title||"").toLowerCase();
            return (t.includes("pl") || t.includes("lektor") || t.includes("dubbing") || t.includes("napisy"))
                && (t.includes("480") || t.includes("720") || t.includes("1080"));
        });
        streams = streams.map(s=>{
            const t=(s.title||"").toLowerCase();
            let tag="";
            if(t.includes("dubbing")) tag="🎙 DUBBING";
            else if(t.includes("lektor")) tag="🇵🇱 LEKTOR";
            else if(t.includes("napisy")) tag="💬 NAPISY";
            return {...s,title:`🔥 FF | ${tag} | ${s.title}`};
        });
        return streams.slice(0,30);
    } catch(e){
        console.error("CDA fetch error:",e.message);
        return [];
    }
}

// =====================
// TMDB → IMDB FULL
// =====================
async function tmdbToImdbFull(id,type){
    try{
        const parts=id.split(":");
        const tmdbId=parts[1];
        let imdbId=null,season=null,episode=null;
        if(parts.length===4){ season=parts[2]; episode=parts[3]; }
        const url = type==="movie"
            ? `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`
            : `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_KEY}`;
        const res=await axios.get(url);
        imdbId=res.data.imdb_id;
        if(!imdbId) return null;
        if(season && episode) return `${imdbId}:${season}:${episode}`;
        return imdbId;
    }catch(e){console.error("TMDB → IMDB FULL error:",e.message); return null;}
}

// =====================
// FETCH POPULAR TMDB
// =====================
async function fetchTMDB(type){
    const key=`tmdb_${type}`;
    const cached=getCache(key);
    if(cached) return cached;
    try{
        const res=await axios.get(`https://api.themoviedb.org/3/${type}/popular?api_key=${TMDB_KEY}&language=pl-PL`);
        const data=res.data.results.map(x=>({
            id:`tmdb:${x.id}`,
            name:x.title||x.name,
            poster:x.poster_path?`https://image.tmdb.org/t/p/w500${x.poster_path}`:"",
            type:type==="movie"?"movie":"series"
        }));
        setCache(key,data);
        return data;
    }catch(e){console.error("TMDB fetch error:",e.message); return [];}
}

// =====================
// META HANDLER
// =====================
builder.defineMetaHandler(async({id,type})=>{
    if(type!=="series") return {meta:{}};
    const tmdbId=id.replace("tmdb:","");
    try{
        const res=await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=pl-PL`);
        const videos=[];
        res.data.seasons.forEach(season=>{
            for(let i=1;i<=season.episode_count;i++){
                videos.push({id:`${id}:${season.season_number}:${i}`,title:`S${season.season_number}E${i}`,season:season.season_number,episode:i});
            }
        });
        return {meta:{
            id,type:"series",name:res.data.name,
            poster:res.data.poster_path?`https://image.tmdb.org/t/p/w500${res.data.poster_path}`:"",
            backdrop:res.data.backdrop_path?`https://image.tmdb.org/t/p/w1280${res.data.backdrop_path}`:"",
            summary:res.data.overview,
            genres:res.data.genres.map(g=>g.name),
            year:res.data.first_air_date?.split('-')[0],
            videos
        }};
    }catch(e){console.error("Meta fetch error:",e.message); return {meta:{}};}
});

// =====================
// STREAM HANDLER PRO + ANIME + CDA
// =====================
const AIO_URL="https://aiostreams.fortheweak.cloud/stremio/dab60b7c-f7c9-4e67-9ed6-4cbb04a1294f/eyJpIjoiaHp0UUZIM3RIeFM3YUtZeE51S24yZz09IiwiZSI6IllVMnNrY0I1b2Ztd0FMdEV1SS9ObnVSaElwY3ljZjZVVEgzcmxtbGFMMlE9IiwidCI6ImEifQ";

builder.defineStreamHandler(async({type,id})=>{
    try{
        let streamId=id;
        if(id.startsWith("tmdb:")){
            const conv=await tmdbToImdbFull(id,type);
            if(conv) streamId=conv;
        }
        const cacheKey=`streams_${streamId}`;
        const cached=getCache(cacheKey);
        if(cached) return {streams:cached};
        const url=`${AIO_URL}/stream/${type}/${streamId}.json`;
        const res=await axios.get(url);
        let streams=res.data.streams||[];
        const isAnime=streams.some(s=>{
            const t=(s.title||"").toLowerCase();
            return t.includes("anime")||t.includes("dual audio")||t.includes("japanese");
        });
        let pl=streams.filter(s=>{
            const t=(s.title||"").toLowerCase();
            return t.includes("pl")||t.includes("lektor")||t.includes("dubbing")||t.includes("napisy");
        });
        if(pl.length>0) streams=pl;
        streams=streams.filter(s=>{
            const t=(s.title||"").toLowerCase();
            if(isAnime) return t.includes("480")||t.includes("720")||t.includes("1080");
            return t.includes("480")||t.includes("720")||t.includes("1080")||t.includes("2160")||t.includes("4k");
        });
        streams.sort((a,b)=>{
            const score=s=>{
                let val=0; const t=(s.title||"").toLowerCase();
                if(t.includes("2160")||t.includes("4k")) val+=50;
                if(t.includes("1080")) val+=isAnime?20:30;
                if(t.includes("720")) val+=isAnime?25:15;
                if(t.includes("480")) val+=5;
                if(t.includes("realdebrid")) val+=40;
                if(t.includes("hdr")) val+=10;
                if(t.includes("dubbing")) val+=25;
                else if(t.includes("lektor")) val+=20;
                else if(t.includes("napisy")) val+=10;
                return val;
            };
            return score(b)-score(a);
        });
        streams=streams.map(s=>{
            const t=(s.title||"").toLowerCase();
            let tag="";
            if(t.includes("dubbing")) tag="🎙 DUBBING";
            else if(t.includes("lektor")) tag="🇵🇱 LEKTOR";
            else if(t.includes("napisy")) tag="💬 NAPISY";
            return {...s,title:`🔥 FF | ${tag} | ${s.title}`};
        });
        // CDA fallback
        if(streams.length===0){
            const cdaStreams=await fetchCDAStreams(streamId);
            if(cdaStreams.length>0) streams=cdaStreams;
        }
        streams=streams.slice(0,30);
        setCache(cacheKey,streams);
        return {streams};
    }catch(e){console.error("Stream error:",e.message); return {streams:[]};}
});

// =====================
// CATALOG HANDLER
// =====================
builder.defineCatalogHandler(async({type,id})=>{
    if(id==="anime"){
        const metas=await fetchTMDB("tv");
        return {metas:metas.filter(m=>m.name.toLowerCase().includes("anime"))};
    }
    if(type==="movie") return {metas:await fetchTMDB("movie")};
    if(type==="series") return {metas:await fetchTMDB("tv")};
    return {metas:[]};
});

// =====================
// EXPRESS + STREMIO
// =====================
const addonInterface=builder.getInterface();
const router=createRouter(addonInterface);

app.use(async(req,res,next)=>{
    try{
        const url=`http://localhost${req.url}`;
        const webReq=new Request(url,{method:req.method,headers:req.headers});
        const webRes=await router(webReq);
        if(webRes===null) return next();
        res.status(webRes.status);
        webRes.headers.forEach((value,key)=>res.setHeader(key,value));
        const body=await webRes.text();
        res.send(body);
    }catch(err){next(err);}
});

app.listen(PORT,'0.0.0.0',()=>{
    console.log(`🔥 FanFilm PRO działa na porcie ${PORT}`);
    console.log(`📡 Manifest: http://localhost:${PORT}/manifest.json`);
});