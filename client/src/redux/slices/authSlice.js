import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  user: null,
  accessToken: null,
  expiresAt: null,
  status: "idle",       // idle | loading | authenticated | anonymous
  initialized: false,   // true once the bootstrap refresh attempt has settled
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setStatus(state, action) {
      state.status = action.payload;
    },
    setSession(state, action) {
      state.user        = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.expiresAt   = action.payload.expiresAt ?? null;
      state.status      = "authenticated";
      state.initialized = true;
      state.error       = null;
    },
    clearSession(state) {
      state.user        = null;
      state.accessToken = null;
      state.expiresAt   = null;
      state.status      = "anonymous";
      state.initialized = true;
      state.error       = null;
    },
    setAuthError(state, action) {
      state.error  = action.payload;
      state.status = "anonymous";
    },
    clearAuthError(state) {
      state.error = null;
    },
    // Only needed if we must mark initialized without a full session payload.
    // setSession / clearSession already set initialized = true, so this is a
    // safety net for edge-cases (e.g. network abort before dispatch resolves).
    finishHydration(state) {
      if (!state.initialized) {
        state.initialized = true;
        if (state.status === "loading") {
          state.status = state.accessToken ? "authenticated" : "anonymous";
        }
      }
    },
  },
});

export const {
  clearAuthError,
  clearSession,
  finishHydration,
  setAuthError,
  setSession,
  setStatus,
} = authSlice.actions;

export default authSlice.reducer;