import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import chatReducer from "./slices/chatSlice";
import graphReducer from "./slices/graphSlice";
import ingestReducer from "./slices/ingestSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chat: chatReducer,
    graph: graphReducer,
    ingest: ingestReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // expiresAt may be a numeric timestamp or ISO string — both are fine,
        // but suppress the warning if the backend ever sends a Date object.
        ignoredPaths: ["auth.expiresAt"],
      },
    }),
});