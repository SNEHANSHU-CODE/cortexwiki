import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import "./index.css";
import App from "./App";
import { store, persistor } from "./redux/store";
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
      {/* BUG FIX #23: Wrap with PersistGate to hydrate persisted state */}
      <PersistGate loading={null} persistor={persistor}>
        <BrowserRouter>
          <App onReady={hideSplash} />
        </BrowserRouter>
      </PersistGate>
    </Provider>
  </StrictMode>,
);