import axios from "axios";
import { clearSession, finishHydration, setSession } from "../redux/slices/authSlice";

function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || "";
  if (!configured || typeof window === "undefined") return configured;

  try {
    const url = new URL(configured);
    const host = window.location.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    const isApiLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    // Keep browser and API on same local hostname family to avoid cookie same-site mismatches.
    if (isLocalHost && isApiLocalHost && url.hostname !== host) {
      url.hostname = host;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // keep configured value
  }

  return configured;
}

const baseURL = resolveBaseUrl();

const httpClient = axios.create({
  baseURL,
  timeout: 30000,
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL,
  timeout: 30000,
  withCredentials: true,
});

let boundStore = null;
let refreshPromise = null;
let lastRefreshAttempt = 0;  // BUG FIX #2: Track refresh timestamp to prevent loops
const REFRESH_COOLDOWN_MS = 2000;  // BUG FIX #2: Cooldown between refresh attempts

export function initializeHttpClient(store) {
  if (boundStore) {
    return;
  }

  boundStore = store;

  // Request interceptor: add Bearer token from Redux state to Authorization header
  httpClient.interceptors.request.use((config) => {
    const state = boundStore?.getState?.();
    const accessToken = state?.auth?.accessToken;
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  // Response interceptor: handle 401 by refreshing token automatically
  httpClient.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const isUnauthorized = error.response?.status === 401;
      const isRefreshRequest = originalRequest?.url?.includes("/api/auth/refresh");
      const isAuthMutation = originalRequest?.url?.includes("/api/auth/login") || originalRequest?.url?.includes("/api/auth/register");

      if (!boundStore || !isUnauthorized || originalRequest?._retry || isRefreshRequest || isAuthMutation) {
        throw error;
      }

      try {
        originalRequest._retry = true;
        
        // BUG FIX #14: Prevent concurrent refresh attempts by multiple requests
        // If already refreshing, wait for the existing refresh to complete
        if (refreshPromise) {
          await refreshPromise;
          // Retry original request with new token
          return await httpClient(originalRequest);
        }
        
        // BUG FIX #2: Limit retries to max 2 to prevent infinite loops
        const retryCount = (originalRequest._retryCount || 0) + 1;
        if (retryCount > 2) {
          console.warn("Max retries exceeded for", originalRequest.url);
          throw error;  // Give up after 2 retries
        }
        originalRequest._retryCount = retryCount;
        
        // BUG FIX #2: Add cooldown between refresh attempts to prevent thundering herd
        const now = Date.now();
        const timeSinceLastRefresh = now - lastRefreshAttempt;
        if (timeSinceLastRefresh < REFRESH_COOLDOWN_MS) {
          await new Promise(resolve => 
            setTimeout(resolve, REFRESH_COOLDOWN_MS - timeSinceLastRefresh)
          );
        }
        lastRefreshAttempt = Date.now();
        
        await refreshSession();
        
        // Retry original request — access token will be added by the request interceptor
        return await httpClient(originalRequest);
      } catch (refreshError) {
        boundStore.dispatch(clearSession());
        boundStore.dispatch(finishHydration());
        throw refreshError;
      }
    },
  );
}

export async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await refreshClient.post("/api/auth/refresh");
      const session = response.data;
      if (boundStore) {
        boundStore.dispatch(
          setSession({
            user: session.user,
            refreshToken: session.refresh_token,
            accessTokenExpiresAt: session.expires_at,
            accessToken: session.access_token,
          })
        );
      }
      return session;
    })()
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export default httpClient;
