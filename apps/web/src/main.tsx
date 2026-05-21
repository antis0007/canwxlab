import "./patch-luma";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootNode = document.getElementById("root")!;
const app = import.meta.env.DEV ? <App /> : <React.StrictMode><App /></React.StrictMode>;
ReactDOM.createRoot(rootNode).render(app);
