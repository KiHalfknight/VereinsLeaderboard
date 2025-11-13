// index.js (Version 9 - Mit Gäste-Filter/Saupurzel)

const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// ----------------------------------------------------
// 1. KONFIGURATION
// ----------------------------------------------------
const CLUB_ID = "526";      // LSC Karlstadt
const AIRPORT_ID = "152581"; // Karlstadt-Saupurzel
const CLUB_AIRCRAFT = ["ASK 21", "LS 4", "Duo Discus", "DG 300"];

// ----------------------------------------------------
// 2. DATENBESCHAFFUNG (GENERIC)
// ----------------------------------------------------
// Diese Funktion ist jetzt schlau genug, um Verein ODER Flugplatz zu laden
async function fetchFlightsFromWeGlide(queryParam) {
  const baseUrl = "https://api.weglide.org";
  const limit = 100;
  let skip = 0;
  let collectedFlights = [];
  let keepFetching = true;

  console.log(`Starte Abruf für Parameter: ${queryParam}...`);

  while (keepFetching) {
    // Wir bauen die URL dynamisch basierend auf dem Parameter (club_id_in oder airport_id_in)
    const targetUrl = `${baseUrl}/v1/flight?${queryParam}&limit=${limit}&skip=${skip}`;
    
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        console.error(`API-Fehler bei ${queryParam}: ${response.statusText}`);
        keepFetching = false;
        break;
      }
      
      const flightPage = await response.json();
      
      if (flightPage.length > 0) {
        collectedFlights = collectedFlights.concat(flightPage);
        skip += limit;
        // Kleines Log, damit man sieht, dass was passiert
        if (collectedFlights.length % 500 === 0) console.log(`  ... ${collectedFlights.length} geladen`);
      } else {
        keepFetching = false;
      }
      
    } catch (error) {
      console.error("Netzwerkfehler:", error.message);
      keepFetching = false;
    }
  }
  
  console.log(`Abruf für ${queryParam} beendet. ${collectedFlights.length} Flüge.`);
  return collectedFlights;
}

// ----------------------------------------------------
// 3. HAUPT-LOGIK (ZUSAMMENFÜHREN & FILTERN)
// ----------------------------------------------------
function processFlightData(cache, filters) {
  
  // SCHRITT 1: BASIS-DATEN WÄHLEN
  // Wir benutzen eine Map, um Duplikate automatisch zu verhindern (Key = Flight ID)
  const flightsMap = new Map();

  // A) Immer die Vereinsflüge hinzufügen
  cache.clubFlights.forEach(flight => flightsMap.set(flight.id, flight));

  // B) Wenn "Gäste" (Saupurzel) gewünscht sind, diese AUCH hinzufügen
  // filters.guests kommt als String 'true' oder 'false' vom Frontend
  if (filters.guests === 'true') {
    cache.airportFlights.forEach(flight => flightsMap.set(flight.id, flight));
  }

  // Jetzt haben wir eine saubere Liste ohne Doppelte
  let filteredFlights = Array.from(flightsMap.values());

  
  // SCHRITT 2: FILTER ANWENDEN

  // A) Jahres-Filter
  if (filters.year && filters.year !== 'all') {
    const yearToFilter = parseInt(filters.year);
    filteredFlights = filteredFlights.filter(flight => {
      const flightYear = parseInt(flight.scoring_date.substring(0, 4));
      return flightYear === yearToFilter;
    });
  }

  // B) Vereinsmaschinen-Filter
  // ACHTUNG: Das filtert jetzt auch die Gäste! 
  // Wenn ein Gast mit einer "LS 4" kommt, wird er angezeigt. 
  // Wenn er mit einer "Ventus 3" kommt, fliegt er raus. Das ist logisch korrekt für den Filter.
  if (filters.aircraft === 'club') {
    filteredFlights = filteredFlights.filter(flight => {
      const aircraftName = flight.aircraft ? flight.aircraft.name : "";
      return CLUB_AIRCRAFT.includes(aircraftName);
    });
  }
  
  // ----- BERECHNUNGEN (wie gehabt) -----
  
  let totalDistance = 0;
  filteredFlights.forEach(flight => {
    if (flight.contest && flight.contest.distance) {
      totalDistance += flight.contest.distance;
    }
  });
  
  const stats = {
    totalDistance: Math.round(totalDistance),
    totalFlights: filteredFlights.length
  };
  
  // Leaderboard 1: Top Flüge
  const leaderboardTopFlights = [...filteredFlights]
    .sort((a, b) => (b.contest?.distance || 0) - (a.contest?.distance || 0))
    .slice(0, 20);

  // Leaderboard 2: Bester pro Pilot
  const pilotBestFlight = new Map();
  filteredFlights.forEach(flight => {
    const pilotId = flight.user.id;
    const currentDistance = flight.contest?.distance || 0;
    if (!pilotBestFlight.has(pilotId) || currentDistance > (pilotBestFlight.get(pilotId).contest?.distance || 0)) {
      pilotBestFlight.set(pilotId, flight);
    }
  });
  
  const leaderboardUniquePilots = Array.from(pilotBestFlight.values())
    .sort((a, b) => (b.contest?.distance || 0) - (a.contest?.distance || 0))
    .slice(0, 20);
  
  return {
    stats,
    leaderboardTopFlights,
    leaderboardUniquePilots
  };
}

// ----------------------------------------------------
// 4. CACHE & ROUTEN
// ----------------------------------------------------

let appDataCache = {
  clubFlights: [],    // Liste 1: Verein
  airportFlights: [], // Liste 2: Saupurzel (Gäste + Verein)
  availableYears: [],
  lastFetched: null
};

async function updateCache() {
  console.log("Aktualisiere Cache (Das kann kurz dauern)...");
  
  // Wir holen beide Listen parallel (Promise.all beschleunigt das)
  const [clubData, airportData] = await Promise.all([
    fetchFlightsFromWeGlide(`club_id_in=${CLUB_ID}`),
    fetchFlightsFromWeGlide(`airport_id_in=${AIRPORT_ID}`)
  ]);
  
  appDataCache.clubFlights = clubData;
  appDataCache.airportFlights = airportData;
  
  // Jahre berechnen (wir nehmen Jahre aus BEIDEN Listen, um sicher zu sein)
  const years = new Set();
  [...clubData, ...airportData].forEach(flight => {
    years.add(flight.scoring_date.substring(0, 4));
  });
  
  appDataCache.availableYears = Array.from(years).sort((a, b) => b - a);
  appDataCache.lastFetched = Date.now();
  console.log(`Cache aktuell. Jahre: ${appDataCache.availableYears.join(', ')}`);
}

async function getFreshData() {
  const oneHour = 60 * 60 * 1000;
  if (!appDataCache.lastFetched || (Date.now() - appDataCache.lastFetched > oneHour)) {
    await updateCache();
  }
  return appDataCache;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/data', async (req, res) => {
  // Wir loggen jetzt auch den guests-Filter
  console.log(`Anfrage: year=${req.query.year}, aircraft=${req.query.aircraft}, guests=${req.query.guests}`);
  
  const cache = await getFreshData();
  const processedData = processFlightData(cache, req.query);
  
  res.json({
    data: processedData,
    availableYears: cache.availableYears
  });
});

app.listen(port, () => {
  console.log(`Server läuft! Öffne http://localhost:${port}`);
  // Initialer Cache-Aufruf
  updateCache();
});