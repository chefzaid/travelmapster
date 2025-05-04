// Initialize the map centered on a reasonable starting point
const map = L.map('map').setView([20, 0], 3);

// Add CartoDB Voyager tiles for a clean, cartoonish look
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

// Store markers in a layer group for easy management
const markersLayer = L.layerGroup().addTo(map);

// Initialize the search provider
const provider = new GeoSearch.OpenStreetMapProvider({
    params: {
        'accept-language': 'en',
        countrycodes: '',
        'location-type': 'city',
        limit: 10
    },
});

// Function to format location name as "City, Country"
function formatLocationName(label) {
    const parts = label.split(',').map(part => part.trim());
    if (parts.length >= 2) {
        const city = parts[0];
        // Find the country (usually the last significant part)
        let country = parts[parts.length - 1];
        // Remove any postal codes or extra information
        country = country.replace(/\d+/g, '').trim();
        return `${city}, ${country}`;
    }
    return parts[0]; // Fallback to just the first part if we can't parse it properly
}

// Function to calculate distance between points in kilometers
function getDistanceInKm(latlng1, latlng2) {
    return latlng1.distanceTo(latlng2) / 1000;
}

// Function to find the nearest city from a clicked point
async function findNearestCity(latlng) {
    try {
        // First, try to find cities very close to the clicked point
        const closeResults = await provider.search({
            query: 'city',
            bounds: [
                [latlng.lat - 0.5, latlng.lng - 0.5],
                [latlng.lat + 0.5, latlng.lng + 0.5]
            ]
        });

        // If we find cities within 50km of the click, use the closest one
        const closeCity = closeResults.find(result => {
            const distance = getDistanceInKm(latlng, L.latLng(result.y, result.x));
            return distance <= 50;
        });

        if (closeCity) {
            return {
                name: formatLocationName(closeCity.label),
                latlng: L.latLng(closeCity.y, closeCity.x)
            };
        }

        // If no close cities found, search in visible map bounds
        const bounds = map.getBounds();
        const results = await provider.search({
            query: `city near ${latlng.lat} ${latlng.lng}`,
            bounds: [
                [bounds.getSouth(), bounds.getWest()],
                [bounds.getNorth(), bounds.getEast()]
            ]
        });

        if (results.length > 0) {
            // Find the nearest result within 100km, otherwise don't place a pin
            const nearest = results.reduce((prev, curr) => {
                const prevDist = getDistanceInKm(latlng, L.latLng(prev.y, prev.x));
                const currDist = getDistanceInKm(latlng, L.latLng(curr.y, curr.x));
                return prevDist < currDist ? prev : curr;
            });

            const distance = getDistanceInKm(latlng, L.latLng(nearest.y, nearest.x));
            if (distance <= 100) {
                return {
                    name: formatLocationName(nearest.label),
                    latlng: L.latLng(nearest.y, nearest.x)
                };
            }
        }
        return null;
    } catch (error) {
        console.error('Error finding nearest city:', error);
        return null;
    }
}

// Function to create a marker
function createMarker(latlng, cityName) {
    // Remove any existing markers within 5km of the new marker
    const existingMarkers = [];
    markersLayer.eachLayer((layer) => {
        if (getDistanceInKm(layer.getLatLng(), latlng) < 5) {
            existingMarkers.push(layer);
        }
    });
    existingMarkers.forEach(marker => markersLayer.removeLayer(marker));

    const marker = L.marker(latlng);
    
    const popupContent = document.createElement('div');
    popupContent.innerHTML = `
        <strong>${cityName}</strong>
        <a class="remove-pin">Remove Pin</a>
    `;
    
    const popup = L.popup().setContent(popupContent);
    marker.bindPopup(popup);
    
    markersLayer.addLayer(marker);
    
    marker.on('popupopen', () => {
        const removeBtn = document.querySelector('.remove-pin');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                markersLayer.removeLayer(marker);
            });
        }
    });

    // Animate the marker drop
    marker.setOpacity(0);
    let opacity = 0;
    const fadeIn = setInterval(() => {
        opacity += 0.1;
        marker.setOpacity(opacity);
        if (opacity >= 1) clearInterval(fadeIn);
    }, 50);
}

// Handle map clicks
map.on('click', async function(e) {
    const nearestCity = await findNearestCity(e.latlng);
    if (nearestCity) {
        // Only move to the city if it's reasonably close
        createMarker(nearestCity.latlng, nearestCity.name);
    }
});

// Search box functionality
const searchInput = document.getElementById('citySearch');
const suggestionsDiv = document.getElementById('suggestions');
let debounceTimer;

async function updateSuggestions(searchText) {
    if (!searchText) {
        suggestionsDiv.style.display = 'none';
        return;
    }

    const bounds = map.getBounds();
    const results = await provider.search({
        query: searchText,
        bounds: [
            [bounds.getSouth(), bounds.getWest()],
            [bounds.getNorth(), bounds.getEast()]
        ]
    });

    suggestionsDiv.innerHTML = '';
    
    if (results.length > 0) {
        // Create a Map to store unique cities
        const uniqueCities = new Map();
        
        results.forEach(result => {
            const formattedName = formatLocationName(result.label);
            if (!uniqueCities.has(formattedName)) {
                uniqueCities.set(formattedName, result);
            }
        });

        Array.from(uniqueCities.entries())
            .slice(0, 5)
            .forEach(([formattedName, result]) => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = formattedName;
                div.addEventListener('click', () => {
                    const latlng = L.latLng(result.y, result.x);
                    createMarker(latlng, formattedName);
                    map.setView(latlng, 10);
                    searchInput.value = '';
                    suggestionsDiv.style.display = 'none';
                });
                suggestionsDiv.appendChild(div);
            });
        suggestionsDiv.style.display = 'block';
    } else {
        suggestionsDiv.style.display = 'none';
    }
}

searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        updateSuggestions(e.target.value);
    }, 300);
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.controls')) {
        suggestionsDiv.style.display = 'none';
    }
});

map.on('moveend', () => {
    if (searchInput.value) {
        updateSuggestions(searchInput.value);
    }
});

// Array to store visited locations
let visitedLocations = [];

// Add click event to the map
map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    // Create a marker at the clicked location
    const marker = L.marker([lat, lng]).addTo(map);
    
    // Reverse geocoding to get city name using Nominatim
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
        .then(response => response.json())
        .then(data => {
            const cityName = data.address.city || data.address.town || data.address.village || 'Unknown location';
            
            // Add popup with city name
            marker.bindPopup(cityName).openPopup();
            
            // Store the location
            visitedLocations.push({
                cityName: cityName,
                latitude: lat,
                longitude: lng
            });
            
            // Optional: Log the visited locations
            console.log('Visited locations:', visitedLocations);
        })
        .catch(error => {
            console.error('Error getting location name:', error);
            marker.bindPopup('Location added').openPopup();
        });
});

// Layer groups for visited and wishlist countries
var visitedLayer = L.layerGroup().addTo(map);
var wishlistLayer = L.layerGroup().addTo(map);

// Function to handle clicks and add markers
function onMapClick(e) {
    var marker = L.marker(e.latlng).addTo(visitedLayer)
        .bindPopup("Visited: " + e.latlng.toString());
}

// Click event to mark cities as visited
map.on('click', onMapClick);

// You can later add functions to distinguish between "Visited" and "Wishlist"
document.getElementById('mode').addEventListener('change', function(e) {
    var mode = e.target.value;
    map.off('click');
    map.on('click', function(e) {
        var layer = mode === 'visited' ? visitedLayer : wishlistLayer;
        var marker = L.marker(e.latlng).addTo(layer)
            .bindPopup(mode.charAt(0).toUpperCase() + mode.slice(1) + ": " + e.latlng.toString());
    });
});
