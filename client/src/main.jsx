import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import "./index.css";
import App from "./App";
import { store } from "./redux/store";
import { initializeHttpClient } from "./services/http";

initializeHttpClient(store);

// Hide the HTML splash once React is ready to paint.
function hideSplash() {
  document.body.classList.remove("splash-active");
  document.body.style.overflow = "";
  const el = document.getElementById("cw-splash");
  if (!el) return;
  el.classList.add("is-hidden");
  setTimeout(() => el.remove(), 450);
}

const root = createRoot(document.getElementById("root"));

root.render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App onReady={hideSplash} />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);