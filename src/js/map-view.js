import L from "leaflet";
import { findNearby } from "./dealers.js";

// Fix für Leaflet Icon Problem
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

let map = null;
let userMarker = null;
let dealerMarkers = [];

export function initMap(containerId, bike) {
  // Get user location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        createMap(containerId, userLat, userLng, bike);
      },
      (error) => {
        console.log("GPS nicht verfügbar, nutze default Location");
        // Default location (Köln, Deutschland)
        createMap(containerId, 50.9365, 6.9589, bike);
      },
    );
  } else {
    createMap(containerId, 50.9365, 6.9589, bike);
  }
}

function createMap(containerId, userLat, userLng, bike) {
  // Create map
  map = L.map(containerId).setView([userLat, userLng], 10);

  // Add tile layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  // Add user marker
  userMarker = L.circleMarker([userLat, userLng], {
    radius: 10,
    fillColor: "#ff4444",
    color: "#ff0000",
    weight: 2,
    opacity: 1,
    fillOpacity: 0.8,
  }).addTo(map);

  userMarker.bindPopup("<b>Dein Standort</b>");

  // Find nearby dealers
  const nearbyDealers = findNearby(userLat, userLng, 100);

  // Add dealer markers
  nearbyDealers.forEach((dealer) => {
    const icon =
      dealer.type === "Werkstatt"
        ? L.icon({
            iconUrl:
              "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIGZpbGw9IiMwMDAwMDAiIHJ4PSI0Ii8+PHRleHQgeD0iNiIgeT0iMTgiIGZvbnQtc2l6ZT0iMTYiPvipk7vii5k8L3RleHQ+PC9zdmc+",
            iconSize: [32, 32],
            popupAnchor: [0, -16],
          })
        : L.icon({
            iconUrl:
              "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIGZpbGw9IiMwMDAwMDAiIHJ4PSI0Ii8+PHRleHQgeD0iNiIgeT0iMTgiIGZvbnQtc2l6ZT0iMTYiPkPimIPiiqk8L3RleHQ+PC9zdmc+",
            iconSize: [32, 32],
            popupAnchor: [0, -16],
          });

    const marker = L.marker([dealer.lat, dealer.lng], { icon }).addTo(map);

    const distance = calculateDistance(
      userLat,
      userLng,
      dealer.lat,
      dealer.lng,
    ).toFixed(1);

    marker.bindPopup(`
      <div style="min-width: 200px;">
        <h4 style="margin: 5px 0;">${dealer.name}</h4>
        <p style="margin: 5px 0; color: #666; font-size: 12px;">
          ${dealer.type === "Werkstatt" ? "🔧 Werkstatt" : "📚 Fahrschule"}
        </p>
        <p style="margin: 5px 0; font-size: 12px;">
          <b>${distance}km entfernt</b>
        </p>
        <p style="margin: 5px 0; font-size: 12px;">
          📍 ${dealer.city}
        </p>
        ${
          dealer.phone
            ? `<p style="margin: 5px 0; font-size: 12px;">
          📞 ${dealer.phone}
        </p>`
            : ""
        }
      </div>
    `);

    dealerMarkers.push(marker);
  });

  // Fit bounds
  if (dealerMarkers.length > 0) {
    const group = new L.featureGroup([userMarker, ...dealerMarkers]);
    map.fitBounds(group.getBounds(), { padding: [50, 50] });
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
