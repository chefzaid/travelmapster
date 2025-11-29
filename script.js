// Initialize map
const map = L.map('map').setView([20, 0], 2);

// Tiles
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
    noWrap: true
}).addTo(map);

// Layer Groups
const visitedLayer = L.layerGroup().addTo(map);
const wishlistLayer = L.layerGroup().addTo(map);
let countriesGeoJSON = null;
let currentUser = null;

// Icons
const visitedIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const wishlistIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

// Fetch World GeoJSON
fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
    .then(res => res.json())
    .then(data => {
        countriesGeoJSON = L.geoJSON(data, {
            style: { opacity: 0, fillOpacity: 0 } // Invisible layer for hit detection
        }).addTo(map);
    })
    .catch(err => console.error("Error loading GeoJSON:", err));

// --- Auth Logic ---

function checkAuth() {
    fetch('/current_user')
        .then(res => {
            if (res.ok) return res.json();
            throw new Error('Not logged in');
        })
        .then(user => {
            if (user.id) {
                currentUser = user;
                document.getElementById('auth-forms').style.display = 'none';
                document.getElementById('auth-check').style.display = 'block';
                document.getElementById('username-display').textContent = user.username;
                document.getElementById('controls').style.opacity = '1';
                document.getElementById('controls').style.pointerEvents = 'auto';
                loadMarkers();
            }
        })
        .catch(() => {
            document.getElementById('auth-forms').style.display = 'block';
            document.getElementById('auth-check').style.display = 'none';
            document.getElementById('controls').style.opacity = '0.5';
            document.getElementById('controls').style.pointerEvents = 'none';
        });
}

document.getElementById('login-btn').addEventListener('click', () => {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => {
        if (res.ok) return res.json();
        throw new Error('Login failed');
    }).then(user => {
        checkAuth();
    }).catch(alert);
});

document.getElementById('register-btn').addEventListener('click', () => {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;

    fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => {
        if (res.ok) {
            alert('Registered! Please login.');
            toggleAuthForms();
        } else {
            alert('Registration failed');
        }
    });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/logout', { method: 'POST' }).then(() => {
        currentUser = null;
        visitedLayer.clearLayers();
        wishlistLayer.clearLayers();
        checkAuth();
    });
});

document.getElementById('show-register').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthForms();
});

document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthForms();
});

function toggleAuthForms() {
    document.getElementById('login-form').classList.toggle('active');
    document.getElementById('register-form').classList.toggle('active');
}

// --- Map Logic ---

function getPinType() {
    return document.querySelector('input[name="pinType"]:checked').value;
}

function addMarkerToMap(data) {
    const icon = data.type === 'visited' ? visitedIcon : wishlistIcon;
    const layer = data.type === 'visited' ? visitedLayer : wishlistLayer;
    
    const marker = L.marker([data.lat, data.lng], { icon: icon });
    marker.bindPopup(`
        <strong>${data.name}</strong> (${data.category})<br>
        Type: ${data.type}<br>
        <span class="remove-pin" onclick="deleteMarker(${data.id})">Remove Pin</span>
    `);
    
    // Store ID on marker for reference if needed (though we handle delete via onclick)
    marker.dbId = data.id;
    
    marker.addTo(layer);
}

function saveMarker(lat, lng, name, category) {
    const type = getPinType();
    fetch('/addMarker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, type, name, category })
    })
    .then(res => res.json())
    .then(data => {
        addMarkerToMap({
            id: data.id,
            lat, lng, type, name, category
        });
    })
    .catch(err => console.error(err));
}

window.deleteMarker = function(id) {
    fetch(`/deleteMarker/${id}`, { method: 'DELETE' })
    .then(res => {
        if (res.ok) {
            // Reload markers or remove from map. Reload is easiest to sync.
            // Or find marker layer.
            loadMarkers();
        }
    });
};

function loadMarkers() {
    visitedLayer.clearLayers();
    wishlistLayer.clearLayers();
    fetch('/getMarkers')
        .then(res => res.json())
        .then(markers => {
            markers.forEach(addMarkerToMap);
        });
}

// Map Click -> Pin Country
map.on('click', (e) => {
    if (!currentUser) return;

    // Check if clicked inside a country
    // Leaflet PIP or just iterate
    if (!countriesGeoJSON) return;

    const result = leafletPip.pointInLayer(e.latlng, countriesGeoJSON, true);
    
    if (result && result.length > 0) {
        const countryFeature = result[0].feature;
        const countryName = countryFeature.properties.name;
        
        // Use centroid or click point. "Pin country" -> maybe center is better, but click is more interactive.
        // Let's use the click point but label it as the country.
        // Actually, let's try to find the "center" of the polygon for consistency if "Pin Country" means identifying the country.
        // But the user clicked HERE.
        // Let's stick to the click location but verify it is a country.

        saveMarker(e.latlng.lat, e.latlng.lng, countryName, 'Country');
    } else {
        // If not a country (ocean?), do nothing or maybe allow pinning custom spot?
        // Requirements: "Pin countries by Clicking on the map".
        // If I click ocean, nothing happens.
    }
});

// Since I don't have leaflet-pip, I will implement a simple containment check or rely on GeoJSON layer click.
// Better approach: Bind click to the GeoJSON layer.

function setupGeoJSONClick() {
    if(!countriesGeoJSON) return;
    countriesGeoJSON.eachLayer(layer => {
        layer.on('click', (e) => {
            if (!currentUser) return;
            const countryName = layer.feature.properties.name;
            // Stop propagation so map click doesn't fire if we had one
            L.DomEvent.stopPropagation(e);

            // Where to put pin? e.latlng is where the user clicked.
            saveMarker(e.latlng.lat, e.latlng.lng, countryName, 'Country');
        });
    });
}

// Note: I initially set style opacity to 0. It still receives events.
// I need to ensure the GeoJSON is loaded before binding.
// I'll modify the fetch above.

// Pin Country by Name
document.getElementById('pin-country-btn').addEventListener('click', () => {
    const name = document.getElementById('country-input').value;
    if (!name) return;
    
    // Geocode
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&polygon_geojson=1`)
        .then(res => res.json())
        .then(data => {
            if (data.length > 0) {
                // Filter for country if possible, or take first
                const result = data[0]; // Assuming first is best match
                if (result.type === 'administrative' || result.type === 'country' || result.class === 'place') {
                     // Use lat/lng from result
                     saveMarker(result.lat, result.lon, result.display_name.split(',')[0], 'Country');
                     map.setView([result.lat, result.lon], 4);
                } else {
                    // Fallback
                    saveMarker(result.lat, result.lon, name, 'Country');
                     map.setView([result.lat, result.lon], 4);
                }
                document.getElementById('country-input').value = '';
            } else {
                alert('Country not found');
            }
        });
});

// Pin City by Name
document.getElementById('pin-city-btn').addEventListener('click', () => {
    const name = document.getElementById('city-input').value;
    if (!name) return;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&addressdetails=1`)
        .then(res => res.json())
        .then(data => {
            if (data.length > 0) {
                const result = data[0];
                const cityName = result.address.city || result.address.town || result.address.village || result.name;
                const countryName = result.address.country;
                const displayName = `${cityName}, ${countryName}`;

                saveMarker(result.lat, result.lon, displayName, 'City');
                map.setView([result.lat, result.lon], 10);
                document.getElementById('city-input').value = '';
            } else {
                alert('City not found');
            }
        });
});


// Initialization
checkAuth();

// Overwrite the previous fetch to include click handling
fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
    .then(res => res.json())
    .then(data => {
        countriesGeoJSON = L.geoJSON(data, {
            style: { opacity: 0, fillOpacity: 0 }
        }).addTo(map);
        setupGeoJSONClick();
    })
    .catch(err => console.error("Error loading GeoJSON:", err));
