import { configureStore } from "@reduxjs/toolkit";
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import createWebStorage from "redux-persist/es/storage/createWebStorage";
import authReducer   from "./slices/authSlice";
import chatReducer   from "./slices/chatSlice";
import graphReducer  from "./slices/graphSlice";
import ingestReducer from "./slices/ingestSlice";
import wikiReducer   from "./slices/wikiSlice";

const createNoopStorage = () => ({
  getItem: () => Promise.resolve(null),
  setItem: (_key, value) => Promise.resolve(value),
  removeItem: () => Promise.resolve(),
});

const storage =
  typeof window !== "undefined" ? createWebStorage("local") : createNoopStorage();

// BUG FIX #12: Persist chat state so users don't lose chat history on refresh
// Also persist wiki state for graph exploration continuity
const persistConfig = {
  key: "cortexwiki",
  storage,
  whitelist: ["auth", "chat", "wiki"],  // Persist auth (sessions), chat (history), wiki (metadata)
  // Note: graph state is too large for localStorage (can be ~1-5MB with large graphs)
  // Users can reload it from backend if needed
};

const persistedAuthReducer = persistReducer(persistConfig, authReducer);

export const store = configureStore({
  reducer: {
    auth:   persistedAuthReducer,
    chat:   chatReducer,
    graph:  graphReducer,
    ingest: ingestReducer,
    wiki:   wikiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
        ignoredPaths: ["auth.accessTokenExpiresAt"],
      },
    }),
});

export const persistor = persistStore(store);
