import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  user: null,
  refreshToken: null,
  accessToken: null,
  accessTokenExpiresAt: null,
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
      state.user                = action.payload.user;
      state.refreshToken        = action.payload.refreshToken ?? null;
      state.accessToken         = action.payload.accessToken ?? null;
      state.accessTokenExpiresAt = action.payload.accessTokenExpiresAt ?? null;
      state.status              = "authenticated";
      state.initialized         = true;
      state.error               = null;
    },
    clearSession(state) {
      state.user                = null;
      state.refreshToken        = null;
      state.accessToken         = null;
      state.accessTokenExpiresAt = null;
      state.status              = "anonymous";
      state.initialized         = true;
      state.error               = null;
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
          state.status = "anonymous";
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
