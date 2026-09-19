import React from "react";
import ReactDOM from "react-dom/client";
import NLInterpreter from "./components/NLInterpreter";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <NLInterpreter />
  </React.StrictMode>,
);
