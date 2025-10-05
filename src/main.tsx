import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // ok to keep/remove
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';                        // registers draw controls
import 'leaflet-draw/dist/leaflet.draw.css';  // styles for draw UI




ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
