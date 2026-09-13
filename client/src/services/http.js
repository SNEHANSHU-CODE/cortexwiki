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
  timeout: 100000, // 100 seconds (matches Render's max timeout)
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL,
  timeout: 100000, // 100 seconds
  withCredentials: true,
});

let boundStore = null;
let refreshPromise = null;

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

        // If a refresh is already in-flight, queue behind it and share the result.
        // The refreshSession() singleton guarantees exactly one HTTP refresh call at
        // a time. The _retry flag above ensures no individual request is retried twice.
        // No cooldown or retry counter is needed — the old cooldown was the root cause
        // of duplicate refresh calls: it caused callers to sleep past the point where
        // refreshPromise was cleared and then each fire an independent refresh.
        if (refreshPromise) {
          await refreshPromise;
          return await httpClient(originalRequest);
        }

        await refreshSession();
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
