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
const authPersistConfig = {
  key: "auth",
  storage,
  blacklist: ["initialized", "status", "error"],
};

const chatPersistConfig = {
  key: "chat",
  storage,
};

const wikiPersistConfig = {
  key: "wiki",
  storage,
};

const persistedAuthReducer = persistReducer(authPersistConfig, authReducer);
const persistedChatReducer = persistReducer(chatPersistConfig, chatReducer);
const persistedWikiReducer = persistReducer(wikiPersistConfig, wikiReducer);

export const store = configureStore({
  reducer: {
    auth:   persistedAuthReducer,
    chat:   persistedChatReducer,
    graph:  graphReducer,
    ingest: ingestReducer,
    wiki:   persistedWikiReducer,
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
