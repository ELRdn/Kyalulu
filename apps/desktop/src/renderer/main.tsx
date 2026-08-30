import React from "react";
import ReactDOM from "react-dom/client";
// 案A: apps/web の App をそのまま再利用（エイリアス @web）
import App from "@web/App";
import "@web/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
