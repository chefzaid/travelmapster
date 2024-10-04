var map = L.map('map').setView([20, 0], 2); // World map center

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> — Map data © OpenStreetMap contributors'
}).addTo(map);



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
