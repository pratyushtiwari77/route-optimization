import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import L from 'leaflet';

const API_BASE_URL = "https://route-optimization-backend-i19f.onrender.com"; 

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Line colours for Delhi Metro
const LINE_COLORS = {
  Red: '#E53935', Yellow: '#F9A825', Blue: '#1E88E5', Green: '#43A047',
  Violet: '#8E24AA', Magenta: '#D81B60', Pink: '#EC407A',
  Aqua: '#00ACC1', 'Airport Express': '#FF6F00'
};

function ChangeView({ center }) {
  const map = useMap();
  useEffect(() => { map.setView(center, 12); }, [center]);
  return null;
}

function MapClickHandler({ pickingMode, onMapClick }) {
  useMapEvents({
    click: (e) => {
      if (!pickingMode) return;
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

// ── 1. SearchBox Component ──────────────────────────────────────────────
const SearchBox = ({ label, onSelect, displayValue }) => {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => { if (displayValue) setQuery(displayValue); }, [displayValue]);

  const handleSearch = async (val) => {
    setQuery(val);
    if (val.length > 2) {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/search?query=${val}`);
        setResults(res.data);
      } catch { setResults([]); }
    } else {
      setResults([]);
    }
  };

  return (
    <div style={{ position: 'relative', width: '300px', display: 'inline-block', margin: '10px' }}>
      <label><strong>{label}</strong></label><br />
      <input
        type="text" value={query}
        onChange={e => handleSearch(e.target.value)}
        placeholder="Search or pick on map..."
        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
      />
      {results.length > 0 && (
        <ul style={{
          position: 'absolute', background: 'white', border: '1px solid #ccc',
          width: '100%', zIndex: 2000, padding: 0, listStyle: 'none',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)', borderRadius: '4px',
          maxHeight: '200px', overflowY: 'auto'
        }}>
          {results.map((item, i) => (
            <li key={i}
              onClick={() => { setQuery(item.name); setResults([]); onSelect(item); }}
              style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
            >
              {item.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── 2. RouteCard Component (For Metro Routes) ───────────────────────────
const RouteCard = ({ route, isSelected, onClick }) => {
  const rankColor = ['#f59e0b', '#94a3b8', '#cd7f32'][route.rank - 1] || '#607d8b';
  return (
    <div
      onClick={onClick}
      style={{
        border: isSelected ? '2px solid #007bff' : '1px solid #ddd',
        borderRadius: '8px', padding: '12px', marginBottom: '8px',
        cursor: 'pointer', background: isSelected ? '#f0f7ff' : '#fff',
        boxShadow: isSelected ? '0 2px 8px rgba(0,123,255,0.2)' : 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <span style={{
          width: '26px', height: '26px', borderRadius: '50%', background: rankColor,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'bold', fontSize: '12px', color: '#fff'
        }}>#{route.rank}</span>
        <strong style={{ fontSize: '16px' }}>🕐 {route.totalTimeMin} min</strong>
        <span style={{ color: '#666', fontSize: '13px' }}>📏 {route.totalKm} km</span>
      </div>

      <div style={{ marginBottom: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {route.legs.metro.lines.map(line => (
          <span key={line} style={{
            background: LINE_COLORS[line] || '#607d8b', color: '#fff',
            fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px'
          }}>{line}</span>
        ))}
        {route.legs.metro.interchanges.length > 0 && (
          <span style={{ background: '#eee', color: '#555', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>
            🔄 {route.legs.metro.interchanges.length} change
          </span>
        )}
      </div>

      {isSelected && (
        <div style={{ fontSize: '12px', color: '#444', borderTop: '1px solid #eee', paddingTop: '8px' }}>
          <div style={{ padding: '4px 0' }}>🚗 Drive to <strong>{route.legs.roadTo.to}</strong> — {route.legs.roadTo.timeMin} min</div>
          <div style={{ padding: '4px 0', color: '#1E88E5' }}>
            🚇 Metro: <strong>{route.legs.metro.boardStation}</strong> → <strong>{route.legs.metro.alightStation}</strong> — {route.legs.metro.timeMin} min
          </div>
          {route.legs.metro.interchanges.length > 0 && (
            <div style={{ padding: '2px 0 4px 20px', color: '#f59e0b', fontSize: '11px' }}>
              Change at: {route.legs.metro.interchanges.join(', ')}
            </div>
          )}
          <div style={{ padding: '4px 0' }}>🚗 Drive to destination — {route.legs.roadFrom.timeMin} min</div>
        </div>
      )}
    </div>
  );
};

// ── 3. Main App ─────────────────────────────────────────────────────────────
function App() {
  const [startLabel, setStartLabel] = useState('');
  const [endLabel,   setEndLabel]   = useState('');
  const [startCoords, setStartCoords] = useState(null); 
  const [endCoords,   setEndCoords]   = useState(null);

  const [roadRoutes,  setRoadRoutes]  = useState([]);
  const [metroRoutes, setMetroRoutes] = useState([]);
  const [selectedMetroIdx, setSelectedMetroIdx] = useState(0);

  const [mode,        setMode]        = useState('road');   // 'road' or 'metro'
  const [pickingMode, setPickingMode] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  // Handle map click reverse geocoding
  const handleMapClick = async (lat, lng) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/reverse-geocode?lat=${lat}&lon=${lng}`);
      const addressName = res.data.address;
      if (pickingMode === 'start') {
        setStartLabel(addressName);
        setStartCoords({ lat, lon: lng });
      } else {
        setEndLabel(addressName);
        setEndCoords({ lat, lon: lng });
      }
    } catch {
      const coordsStr = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if (pickingMode === 'start') { setStartLabel(coordsStr); setStartCoords({ lat, lon: lng }); }
      else                         { setEndLabel(coordsStr);   setEndCoords({ lat, lon: lng }); }
    }
    setPickingMode(null);
  };

  // Original TomTom Road Route
  const getRoadRoute = async () => {
    if (!startCoords || !endCoords) return alert('Please select both locations');
    setLoading(true); setError(''); setMetroRoutes([]);
    try {
      const start = `${startCoords.lat},${startCoords.lon}`;
      const end = `${endCoords.lat},${endCoords.lon}`;
      const response = await axios.get(`${API_BASE_URL}/api/route`, { params: { start, end } });
      setRoadRoutes(response.data);
      setMode('road');
    } catch { setError('Error fetching road routes.'); }
    setLoading(false);
  };

  // NEW: Hybrid Metro Route
  const getMetroRoute = async () => {
    if (!startCoords || !endCoords) return alert('Please select both locations');
    setLoading(true); setError(''); setRoadRoutes([]);
    try {
     const response = await axios.get(`${API_BASE_URL}/api/metro-route`, { 
    params: {
      startLat: startCoords.lat, 
      startLon: startCoords.lon,
      endLat:   endCoords.lat,   
      endLon:   endCoords.lon
    } 
});
      setMetroRoutes(response.data.routes);
      setSelectedMetroIdx(0);
      setMode('metro');
    } catch (err) { setError('Error fetching metro routes.'); }
    setLoading(false);
  };

  const activeRoute = mode === 'metro' ? metroRoutes[selectedMetroIdx] : null;
  const mapCenter   = roadRoutes[0]?.path[0] || (activeRoute ? activeRoute.legs.roadTo.polyline[0] : [28.61, 77.22]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '4px' }}>🚇 Delhi Multi-Modal Explorer</h2>
      <p style={{ color: '#666', marginBottom: '16px', fontSize: '13px' }}>Compare Road vs. Hybrid Metro routing</p>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
        <SearchBox
          label="Start Point"
          onSelect={item => { setStartLabel(item.name); setStartCoords({ lat: item.lat, lon: item.lon }); }}
          displayValue={startLabel}
        />
        <button onClick={() => setPickingMode('start')} style={{ padding: '8px', cursor: 'pointer', background: pickingMode === 'start' ? 'orange' : '#eee', border: '1px solid #ccc', borderRadius: '4px', height: '40px', marginBottom: '10px' }}>📍 Pick Start</button>

        <SearchBox
          label="Destination"
          onSelect={item => { setEndLabel(item.name); setEndCoords({ lat: item.lat, lon: item.lon }); }}
          displayValue={endLabel}
        />
        <button onClick={() => setPickingMode('end')} style={{ padding: '8px', cursor: 'pointer', background: pickingMode === 'end' ? 'orange' : '#eee', border: '1px solid #ccc', borderRadius: '4px', height: '40px', marginBottom: '10px' }}>🏁 Pick End</button>

        <button onClick={getRoadRoute} disabled={loading} style={{ padding: '10px 16px', cursor: 'pointer', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', height: '40px', marginBottom: '10px', opacity: loading ? 0.6 : 1 }}>🚗 Road Only</button>
        <button onClick={getMetroRoute} disabled={loading} style={{ padding: '10px 16px', cursor: 'pointer', backgroundColor: '#8E24AA', color: 'white', border: 'none', borderRadius: '4px', height: '40px', marginBottom: '10px', opacity: loading ? 0.6 : 1 }}>🚇 Metro + Road</button>
      </div>

      {pickingMode && <div style={{ color: 'orange', fontWeight: 'bold', marginBottom: '10px' }}>Click on the map to set your {pickingMode === 'start' ? 'Start Point' : 'Destination'}</div>}
      {loading && <div style={{ color: '#007bff', marginBottom: '10px' }}>⏳ Calculating routes…</div>}
      {error   && <div style={{ color: 'red',     marginBottom: '10px' }}>⚠️ {error}</div>}

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        {/* Sidebar */}
        {(roadRoutes.length > 0 || metroRoutes.length > 0) && (
          <div style={{ width: '340px', flexShrink: 0 }}>
            {mode === 'road' && roadRoutes.length > 0 && (
              <div style={{ background: '#f0f4f8', borderRadius: '8px', padding: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0' }}>🚗 Road Routes</h4>
                {roadRoutes.map((r, i) => (
                  <div key={i} style={{ marginBottom: '6px', color: r.isBest ? '#007bff' : '#666', fontWeight: r.isBest ? 'bold' : 'normal', borderLeft: `4px solid ${r.isBest ? '#007bff' : '#ccc'}`, paddingLeft: '10px' }}>
                    Route {i + 1}: {(r.distance / 1000).toFixed(2)} km | {Math.round(r.time / 60)} mins {r.isBest && '✨ Best'}
                  </div>
                ))}
              </div>
            )}

            {mode === 'metro' && metroRoutes.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 10px 0' }}>🚇 Metro + Road Routes</h4>
                {metroRoutes.map((r, i) => (
                  <RouteCard key={r.rank} route={r} isSelected={i === selectedMetroIdx} onClick={() => setSelectedMetroIdx(i)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Map */}
        <div style={{ flex: 1, border: pickingMode ? '3px solid orange' : '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', cursor: pickingMode ? 'crosshair' : 'grab' }}>
          <MapContainer center={[28.61, 77.22]} zoom={11} style={{ height: '60vh', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapClickHandler pickingMode={pickingMode} onMapClick={handleMapClick} />

            {/* Road Polylines */}
            {mode === 'road' && roadRoutes.map((route, i) => (
              <Polyline key={i} positions={route.path} color={route.isBest ? '#007bff' : '#99aab5'} weight={route.isBest ? 7 : 4} opacity={route.isBest ? 1 : 0.6} />
            ))}

            {/* Metro Hybrid Polylines */}
            {mode === 'metro' && activeRoute && (
              <>
                <Polyline positions={activeRoute.legs.roadTo.polyline}   color="#FF6B35" weight={5} dashArray="8 6" />
                <Polyline positions={activeRoute.legs.metro.polyline}    color="#1E88E5" weight={6} />
                <Polyline positions={activeRoute.legs.roadFrom.polyline} color="#43A047" weight={5} dashArray="8 6" />
              </>
            )}

            {/* Start/End Markers */}
            {roadRoutes.length > 0 && mode === 'road' && (
              <>
                <ChangeView center={roadRoutes[0].path[0]} />
                <Marker position={roadRoutes[0].path[0]} />
                <Marker position={roadRoutes[0].path[roadRoutes[0].path.length - 1]} />
              </>
            )}
            {mode === 'metro' && activeRoute?.legs.roadTo.polyline[0] && (
              <>
                <ChangeView center={activeRoute.legs.roadTo.polyline[0]} />
                <Marker position={activeRoute.legs.roadTo.polyline[0]}><Popup>📍 Start</Popup></Marker>
                <Marker position={activeRoute.legs.roadFrom.polyline[activeRoute.legs.roadFrom.polyline.length - 1]}><Popup>🏁 Destination</Popup></Marker>
              </>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

export default App;
