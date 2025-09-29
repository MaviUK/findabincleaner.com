import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { supabase } from "./lib/supabase";
(void supabase); // ensure module runs (for window.sb)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
