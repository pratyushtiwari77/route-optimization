const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: "https://route-optimization-five.vercel.app" 
}));
app.use(express.json());

const API_KEY = process.env.TOMTOM_API_KEY;
// Load the Metro Data
const STATIONS = require('./stations.json');
// =========================================================================
// PHASE 2: METRO GRAPH & ROUTING ALGORITHMS
// =========================================================================

const METRO_SPEED_KMH  = 35;
const INTERCHANGE_MIN  = 5;   // 5-minute penalty for changing metro lines
const LINE_MAX_KM = { Pink: 25, Violet: 10, 'Airport Express': 12, Aqua: 20, Green: 7, Blue: 6, Red: 7 };

// 1. Haversine Formula (Calculates straight-line distance between two GPS points)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const toRad = d => d * Math.PI / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 2. Build the Adjacency Graph
const stationMap = {};
const adjacency  = {};
STATIONS.forEach(s => { stationMap[s.id] = s; adjacency[s.id] = []; });

const lineMap = {};
STATIONS.forEach(s => {
  Object.entries(s.lines).forEach(([line, seq]) => {
    if (!lineMap[line]) lineMap[line] = [];
    lineMap[line].push({ station: s, seq });
  });
});

Object.entries(lineMap).forEach(([line, entries]) => {
  const maxKm  = LINE_MAX_KM[line] || 3.5;
  const sorted = entries.sort((a, b) => a.seq - b.seq).map(e => e.station);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const dist = haversine(a.lat, a.lon, b.lat, b.lon);
    if (dist <= maxKm) {
      const tmin = (dist / METRO_SPEED_KMH) * 60;
      adjacency[a.id].push({ toId: b.id, dist, tmin, line });
      adjacency[b.id].push({ toId: a.id, dist, tmin, line });
    }
  }
});

console.log(`Metro graph ready: ${STATIONS.length} stations connected!`);

// 3. Dijkstra's Algorithm (Finds the fastest path through the graph)
function dijkstra(fromId, toId) {
  if (!stationMap[fromId] || !stationMap[toId]) return null;
  if (fromId === toId) return { stations: [stationMap[fromId]], distKm: 0, timeMin: 0, interchanges: [], lines: [] };

  const dist = {}, prev = {}, visited = new Set(), queue = [];
  STATIONS.forEach(s => { dist[s.id] = Infinity; });
  dist[fromId] = 0;
  queue.push({ id: fromId, cost: 0, currentLine: null });

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost); // Priority queue simulation
    const { id, cost, currentLine } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === toId) break;

    for (const edge of adjacency[id]) {
      if (visited.has(edge.toId)) continue;
      // Add a time penalty if they have to switch lines
      const penalty = (currentLine && currentLine !== edge.line) ? INTERCHANGE_MIN : 0;
      const nc = cost + edge.tmin + penalty;
      if (nc < dist[edge.toId]) {
        dist[edge.toId] = nc;
        prev[edge.toId] = { fromId: id, line: edge.line, dist: edge.dist };
        queue.push({ id: edge.toId, cost: nc, currentLine: edge.line });
      }
    }
  }

  if (dist[toId] === Infinity) return null;

  const pathIds = [];
  let cur = toId;
  while (cur) { pathIds.unshift(cur); cur = prev[cur]?.fromId ?? null; }

  const stations = pathIds.map(id => stationMap[id]);
  let totalDist = 0;
  const interchanges = [], linesUsed = new Set();
  let prevLine = null;

  for (let i = 1; i < pathIds.length; i++) {
    const seg = prev[pathIds[i]];
    totalDist += seg.dist;
    linesUsed.add(seg.line);
    if (prevLine && seg.line !== prevLine) interchanges.push(stationMap[pathIds[i]].name);
    prevLine = seg.line;
  }

  return {
    stations,
    distKm: parseFloat(totalDist.toFixed(2)),
    timeMin: parseFloat(dist[toId].toFixed(1)),
    interchanges,
    lines: [...linesUsed]
  };
}

// 4. Find N nearest stations to a given GPS coordinate (First/Last Mile calculation)
function nearestStations(lat, lon, n = 3) {
  return STATIONS
    .map(s => ({ ...s, walkKm: haversine(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.walkKm - b.walkKm)
    .slice(0, n);
}
// =========================================================================


// 1. Search (Forward Geocoding: Text to Coordinates)
app.get('/api/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.json([]);

        const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json`;
        
        const response = await axios.get(url, {
            params: {
                key: API_KEY,
                language: 'en-GB',
                limit: 15,
                typeahead: true,
                countrySet: 'IN',
                lat: 28.6015,
                lon: 77.0358,
                radius: 10000
            }
        });
        
        const suggestions = response.data.results.map(result => ({
            name: result.address.freeformAddress,
            lat: result.position.lat,
            lon: result.position.lon
        }));

        res.json(suggestions);
    } catch (error) {
        res.status(500).json({ error: "Search failed" });
    }
});

// 2. NEW: Reverse Geocoding (Coordinates to Text for Map Clicks)
app.get('/api/reverse-geocode', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const url = `https://api.tomtom.com/search/2/reverseGeocode/${lat},${lon}.json`;
        
        const response = await axios.get(url, {
            params: { key: API_KEY }
        });

        // Extract the best matching address name, fallback to coordinates if no road is nearby
        const address = response.data.addresses[0]?.address?.freeformAddress || `${lat.slice(0,7)}, ${lon.slice(0,7)}`;
        
        res.json({ address });
    } catch (error) {
        console.error("Reverse Geocode Error:", error.message);
        res.status(500).json({ error: "Reverse Geocode failed" });
    }
});

// 3. Routing Engine
app.get('/api/route', async (req, res) => {
    try {
        const { start, end } = req.query;
        console.log(`Routing from: ${start} to ${end}`);
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${start}:${end}/json`;
        
        const response = await axios.get(url, {
            params: {
                key: API_KEY,
                routeType: 'fastest',
                traffic: true,
                maxAlternatives: 2,
                travelMode: 'car'
            }
        });

        const routes = response.data.routes.map((route, index) => ({
            id: index,
            distance: route.summary.lengthInMeters,
            time: route.summary.travelTimeInSeconds,
            path: route.legs[0].points.map(p => [p.latitude, p.longitude]),
            isBest: index === 0
        }));

        res.json(routes);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch routes" });
    }
});

// NEW ENDPOINT: Get all metro stations (Used for map display and debugging)
app.get('/api/stations', (req, res) => {
    // We map it to make sure we don't send unnecessary backend data to the frontend
    res.json(STATIONS.map(s => ({
        id:   s.id,
        name: s.name,
        lat:  s.lat,
        lon:  s.lon,
        lines: Object.keys(s.lines),
        interchange: s.interchange
    })));
});
// =========================================================================
// PHASE 3: THE HYBRID ROUTING ENDPOINT (Metro + Road)
// =========================================================================

app.get('/api/metro-route', async (req, res) => {
  try {
    const { startLat, startLon, endLat, endLon } = req.query;
    const sLat = parseFloat(startLat), sLon = parseFloat(startLon);
    const eLat = parseFloat(endLat),   eLon = parseFloat(endLon);

    if ([sLat, sLon, eLat, eLon].some(isNaN)) {
      return res.status(400).json({ error: 'startLat, startLon, endLat, endLon are required' });
    }

    // Step 1: find 3 nearest metro stations from source and destination
    const srcStations  = nearestStations(sLat, sLon, 3);
    const destStations = nearestStations(eLat, eLon, 3);

    // Step 2: find best metro path for all 3×3 station combinations
    const metroCandidates = [];
    for (const src of srcStations) {
      for (const dest of destStations) {
        const result = dijkstra(src.id, dest.id);
        if (result) metroCandidates.push({ boardStation: src, alightStation: dest, ...result });
      }
    }
    
    // Sort by fastest metro time and take the top 3 options
    metroCandidates.sort((a, b) => a.timeMin - b.timeMin);
    const topCandidates = metroCandidates.slice(0, 3);

    if (!topCandidates.length) {
      return res.status(404).json({ error: 'No metro route found between these locations' });
    }

    // Step 3: Fetch road legs from TomTom for each candidate (Runs simultaneously for speed!)
    const roadFetches = topCandidates.flatMap(c => [
      // leg A: source → board station (driving)
      axios.get(
        `https://api.tomtom.com/routing/1/calculateRoute/${sLat},${sLon}:${c.boardStation.lat},${c.boardStation.lon}/json`,
        { params: { key: API_KEY, routeType: 'fastest', traffic: true, travelMode: 'car' } }
      ).catch(() => null),
      // leg B: alight station → destination (driving)
      axios.get(
        `https://api.tomtom.com/routing/1/calculateRoute/${c.alightStation.lat},${c.alightStation.lon}:${eLat},${eLon}/json`,
        { params: { key: API_KEY, routeType: 'fastest', traffic: true, travelMode: 'car' } }
      ).catch(() => null)
    ]);

    const roadResults = await Promise.all(roadFetches);

    // Step 4: Assemble and score each composite route
    const WALK_SPEED_KMH = 5;
    const compositeRoutes = topCandidates.map((candidate, i) => {
      const legA = roadResults[i * 2];
      const legB = roadResults[i * 2 + 1];

      // Road leg data (fallback to an estimated walk time if the TomTom call failed)
      const roadToMin   = legA ? legA.data.routes[0].summary.travelTimeInSeconds / 60 : (candidate.boardStation.walkKm / WALK_SPEED_KMH * 60);
      const roadFromMin = legB ? legB.data.routes[0].summary.travelTimeInSeconds / 60 : (candidate.alightStation.walkKm / WALK_SPEED_KMH * 60);
      const roadToKm    = legA ? legA.data.routes[0].summary.lengthInMeters / 1000 : candidate.boardStation.walkKm;
      const roadFromKm  = legB ? legB.data.routes[0].summary.lengthInMeters / 1000 : candidate.alightStation.walkKm;

      // Polylines for map drawing in React
      const polylineRoadTo   = legA ? legA.data.routes[0].legs[0].points.map(p => [p.latitude, p.longitude]) : [];
      const polylineMetro    = candidate.stations.map(s => [s.lat, s.lon]);
      const polylineRoadFrom = legB ? legB.data.routes[0].legs[0].points.map(p => [p.latitude, p.longitude]) : [];

      const totalTimeMin = parseFloat((roadToMin + candidate.timeMin + roadFromMin).toFixed(1));
      const totalKm      = parseFloat((roadToKm + candidate.distKm + roadFromKm).toFixed(2));

      return {
        rank: i + 1,
        totalTimeMin,
        totalKm,
        legs: {
          roadTo: {
            from: 'Source',
            to: candidate.boardStation.name,
            timeMin: parseFloat(roadToMin.toFixed(1)),
            km: parseFloat(roadToKm.toFixed(2)),
            polyline: polylineRoadTo
          },
          metro: {
            boardStation: candidate.boardStation.name,
            alightStation: candidate.alightStation.name,
            lines: candidate.lines,
            interchanges: candidate.interchanges,
            stations: candidate.stations.map(s => s.name),
            timeMin: candidate.timeMin,
            km: candidate.distKm,
            polyline: polylineMetro
          },
          roadFrom: {
            from: candidate.alightStation.name,
            to: 'Destination',
            timeMin: parseFloat(roadFromMin.toFixed(1)),
            km: parseFloat(roadFromKm.toFixed(2)),
            polyline: polylineRoadFrom
          }
        }
      };
    });

    res.json({ success: true, routes: compositeRoutes });
  } catch (error) {
    console.error('Metro route error:', error.message);
    res.status(500).json({ error: 'Failed to calculate metro route' });
  }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
