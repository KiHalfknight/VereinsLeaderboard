// index.js (Version 5 - Mit Statistik-Berechnung)

const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// ----------------------------------------------------
// 1. DATENBESCHAFFUNG (MIT PAGINATION)
// ----------------------------------------------------
async function fetchAllFlights() {
  console.log("Starte Abruf ALLER Flüge (Pagination)...");
  
  const clubId = "526";
  const baseUrl = "https://api.weglide.org";
  const limit = 100; // Wie viele Flüge pro API-Aufruf (max. 100 laut Doku)
  let skip = 0;       // Start bei 0
  let allFlights = [];
  let keepFetching = true;

  while (keepFetching) {
    const targetUrl = `${baseUrl}/v1/flight?club_id_in=${clubId}&limit=${limit}&skip=${skip}`;
    
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        console.error(`API-Fehler: ${response.statusText}`);
        keepFetching = false; // Stopp bei Fehler
        break; // Verlasse die Schleife
      }
      
      const flightPage = await response.json();
      
      if (flightPage.length > 0) {
        // Füge die Flüge dieser "Seite" zur Gesamtliste hinzu
        allFlights = allFlights.concat(flightPage);
        skip += limit; // Setze 'skip' für die nächste Seite hoch
        console.log(`  ... ${allFlights.length} Flüge geladen`);
      } else {
        // Die API hat eine leere Liste zurückgegeben -> wir sind fertig
        keepFetching = false;
      }
      
    } catch (error) {
      console.error("Netzwerkfehler beim Holen der Seiten:", error.message);
      keepFetching = false;
    }
  }
  
  console.log(`Abruf beendet. Gesamt: ${allFlights.length} Flüge.`);
  return allFlights;
}

// ----------------------------------------------------
// 2. STATISTIK-BERECHNUNG
// ----------------------------------------------------
function calculateStatistics(allFlights) {
  let totalDistanceAllTime = 0;
  let totalDistanceCurrentYear = 0;
  
  // Das aktuelle Jahr holen (z.B. 2025)
  const currentYear = new Date().getFullYear(); 

  allFlights.forEach(flight => {
    // Prüfen, ob der Flug überhaupt eine 'contest' Eigenschaft hat
    if (flight.contest && flight.contest.distance) {
      const distance = flight.contest.distance;
      
      // 1. All-Time Summe
      totalDistanceAllTime += distance;
      
      // 2. Jahres-Summe
      // Vergleiche das Jahr des Flugs (z.B. "2020-07-12") mit dem aktuellen Jahr
      const flightYear = parseInt(flight.scoring_date.substring(0, 4));
      if (flightYear === currentYear) {
        totalDistanceCurrentYear += distance;
      }
    }
  });

  // Runde die Zahlen und gib sie als Objekt zurück
  return {
    allTime: Math.round(totalDistanceAllTime),
    currentYear: Math.round(totalDistanceCurrentYear),
    totalFlights: allFlights.length
  };
}


// ----------------------------------------------------
// 3. SERVER-ROUTEN
// ----------------------------------------------------

// Ein "Cache", damit wir WeGlide nicht bei JEDEM Seitenaufruf neu abfragen
// (Das ist eine fortgeschrittene, aber wichtige Technik)
let appDataCache = {
  leaderboard: [],
  stats: {},
  lastFetched: null // Zeitstempel
};

// Diese Funktion füllt unseren Cache
async function updateCache() {
  console.log("Aktualisiere Cache...");
  const allFlights = await fetchAllFlights();
  
  // A) Leaderboard-Daten berechnen
  // Sortiere alle Flüge (Kopie) nach Distanz, nimm die Top 20
  appDataCache.leaderboard = [...allFlights] // Erstelle eine Kopie
    .sort((a, b) => (b.contest?.distance || 0) - (a.contest?.distance || 0))
    .slice(0, 20); // Nimm die ersten 20

  // B) Statistik-Daten berechnen
  appDataCache.stats = calculateStatistics(allFlights);
  
  appDataCache.lastFetched = Date.now();
  console.log("Cache ist aktuell.");
}

// HILFS-FUNKTION: Stellt sicher, dass die Daten aktuell sind (z.B. nicht älter als 1 Stunde)
async function getFreshData() {
  const oneHour = 60 * 60 * 1000; // 1 Stunde in Millisekunden
  if (!appDataCache.lastFetched || (Date.now() - appDataCache.lastFetched > oneHour)) {
    await updateCache();
  }
  return appDataCache;
}


// ROUTE 1: Die Hauptseite ("/")
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ROUTE 2: Der Leaderboard-Daten-Endpunkt
app.get('/api/leaderboard', async (req, res) => {
  console.log("Daten-Anfrage für /api/leaderboard empfangen...");
  const data = await getFreshData();
  res.json(data.leaderboard);
});

// NEUE ROUTE 3: Der Statistik-Daten-Endpunkt
app.get('/api/stats', async (req, res) => {
  console.log("Daten-Anfrage für /api/stats empfangen...");
  const data = await getFreshData();
  res.json(data.stats);
});


// ----------------------------------------------------
// 4. SERVER START
// ----------------------------------------------------
app.listen(port, () => {
  console.log(`Server läuft! Öffne http://localhost:${port} in deinem Browser.`);
  
  // Optional: Fülle den Cache direkt beim Start, 
  // damit der erste Aufruf der Seite sofort schnell ist.
  updateCache();
});