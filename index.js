const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Twój AIO link (bez /manifest.json)
const AIO = "https://aiostreams.fortheweak.cloud/stremio/3bf791af-d2c5-4d2a-892c-4cbb93106083/eyJpIjoiY0cxS05VV0dmVFR3b2hjSGY4UT09IiwiZSI6ImJCTFRTd3RuMGFpdkJLSzdmdThaMEtkdVlZcUNmK1Y3OWsvb0djbDFhcGM9IiwidCI6ImEifQ";

// -----------------------------
// KATALOG — dynamiczny fetch
// -----------------------------
app.get('/catalog/:type/:id.json', async (req, res) => {
  const id = req.params.id; // "m" lub "s"

  try {
    // Pobieramy katalog z AIO
    const response = await fetch(`${AIO}/catalog/${id}.json`);
    const data = await response.json();

    // Nie fetchujemy streamów dla każdego meta, katalog pokazuje wszystkie
    res.json({ metas: data.metas });
  } catch (error) {
    console.error("Błąd pobierania katalogu:", error);
    res.json({ metas: [] });
  }
});

// -----------------------------
// STREAMS — filtr PL / JP+PL dla anime
// -----------------------------
app.get('/stream/:type/:id.json', async (req, res) => {
  const id = req.params.id;

  try {
    const response = await fetch(`${AIO}/stream/${id}.json`);
    const data = await response.json();

    // Filtrujemy tylko:
    // - 🇵🇱 dla filmów i seriali
    // - 🇯🇵 z PL napisami dla anime
    const plStreams = data.streams.filter(s =>
      s.name.includes('🇵🇱') ||
      (s.description && s.description.includes('🇵🇱')) ||
      (s.description && s.description.includes('🇯🇵') && s.description.includes('PL'))
    );

    res.json({ streams: plStreams });
  } catch (error) {
    console.error("Błąd pobierania streamów:", error);
    res.json({ streams: [] });
  }
});

// -----------------------------
// START SERVER
// -----------------------------
app.listen(port, () => console.log(`FanFilm PRO+ PL dynamic running on port ${port}`));