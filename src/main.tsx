import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // ok to keep/remove
import { supabase } from "./lib/supabase";
(void supabase); // ensure the module runs


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
