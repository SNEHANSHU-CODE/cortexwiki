import { configureStore } from "@reduxjs/toolkit";
import authReducer   from "./slices/authSlice";
import chatReducer   from "./slices/chatSlice";
import graphReducer  from "./slices/graphSlice";
import ingestReducer from "./slices/ingestSlice";
import wikiReducer   from "./slices/wikiSlice";

export const store = configureStore({
  reducer: {
    auth:   authReducer,
    chat:   chatReducer,
    graph:  graphReducer,
    ingest: ingestReducer,
    wiki:   wikiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: ["auth.expiresAt"],
      },
    }),
});