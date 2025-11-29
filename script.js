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
let visitedCountriesSet = new Set(); // To track visited countries names

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
            style: styleCountry, // Use dynamic style function
            onEachFeature: onEachFeature
        }).addTo(map);
        populateCountryDatalist(data);
    })
    .catch(err => console.error("Error loading GeoJSON:", err));

// Style function for GeoJSON
function styleCountry(feature) {
    if (visitedCountriesSet.has(feature.properties.name)) {
        return {
            fillColor: '#3388ff',
            weight: 1,
            opacity: 1,
            color: '#3388ff', // Border color same as fill or distinct
            fillOpacity: 0.4
        };
    }
    return {
        fillColor: 'transparent',
        weight: 1,
        opacity: 0, // Invisible border for non-visited
        fillOpacity: 0
    };
}

function updateMapStyles() {
    if (countriesGeoJSON) {
        countriesGeoJSON.setStyle(styleCountry);
    }
}

function onEachFeature(feature, layer) {
    layer.on('click', (e) => {
        if (!currentUser) return;
        const countryName = feature.properties.name;
        L.DomEvent.stopPropagation(e);
        saveMarker(e.latlng.lat, e.latlng.lng, countryName, 'Country');
    });
}

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
        visitedCountriesSet.clear();
        updateMapStyles();
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
    
    // Store ID on marker for reference
    marker.dbId = data.id;
    marker.addTo(layer);

    // Update visited countries set if applicable
    if (data.type === 'visited' && data.category === 'Country') {
        visitedCountriesSet.add(data.name);
        updateMapStyles();
    }
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
            loadMarkers();
        }
    });
};

function loadMarkers() {
    visitedLayer.clearLayers();
    wishlistLayer.clearLayers();
    visitedCountriesSet.clear();
    fetch('/getMarkers')
        .then(res => res.json())
        .then(markers => {
            markers.forEach(addMarkerToMap);
            // Ensure style is updated after all markers are loaded
            updateMapStyles();
        });
}

// --- Autocomplete & Input Logic ---

function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function populateCountryDatalist(geojson) {
    let datalist = document.getElementById('countries-list');
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'countries-list';
        document.body.appendChild(datalist);
    }

    // Extract names and sort them
    const names = geojson.features.map(f => f.properties.name).sort();

    names.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
    });
    
    document.getElementById('country-input').setAttribute('list', 'countries-list');
}

// City Autocomplete
const cityInput = document.getElementById('city-input');
let cityDatalist = document.getElementById('cities-list');
if (!cityDatalist) {
    cityDatalist = document.createElement('datalist');
    cityDatalist.id = 'cities-list';
    document.body.appendChild(cityDatalist);
    cityInput.setAttribute('list', 'cities-list');
}

let debounceTimer;
cityInput.addEventListener('input', (e) => {
    const query = e.target.value;
    if (query.length < 3) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`)
            .then(res => res.json())
            .then(data => {
                cityDatalist.innerHTML = '';
                data.forEach(item => {
                    const cityName = item.address.city || item.address.town || item.address.village || item.name;
                    const countryName = item.address.country;
                    const displayName = `${cityName}, ${countryName}`;
                    const option = document.createElement('option');
                    option.value = displayName;
                    cityDatalist.appendChild(option);
                });
            })
            .catch(err => console.error("Error fetching city suggestions:", err));
    }, 300);
});

// Enter Key Listeners
document.getElementById('country-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('pin-country-btn').click();
    }
});

document.getElementById('city-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('pin-city-btn').click();
    }
});

// Pin Country by Name
document.getElementById('pin-country-btn').addEventListener('click', () => {
    const name = document.getElementById('country-input').value;
    if (!name) return;
    
    // Geocode
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&polygon_geojson=1`)
        .then(res => res.json())
        .then(data => {
            if (data.length > 0) {
                // Filter for country if possible
                const result = data[0];
                let finalName = name; // Default to input name

                // Try to match with GeoJSON names for consistent coloring
                // This is tricky because Nominatim names might differ from GeoJSON names.
                // However, we populated the datalist from GeoJSON, so if user picked from list, it matches.
                // If they typed manually, we might have a mismatch.
                // We'll trust the user input or the Nominatim display name.
                // Ideally, we check against our `countriesGeoJSON` layers.

                saveMarker(result.lat, result.lon, finalName, 'Country');
                map.setView([result.lat, result.lon], 4);

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
