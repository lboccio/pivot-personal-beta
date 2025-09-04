export function loadMaps(key) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve(window.google.maps);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps JS"));
    script.onload = () => resolve(window.google.maps);
    document.head.appendChild(script);
  });
}