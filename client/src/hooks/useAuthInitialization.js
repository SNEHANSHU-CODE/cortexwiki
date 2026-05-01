import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  clearSession,
  finishHydration,
  setSession,
  setStatus,
} from "../redux/slices/authSlice";
import { getSessionFromRefresh } from "../utils/api";

/**
 * Runs the silent token refresh exactly once on mount.
 * Returns { isInitialized } — same shape as the finance tracker hook
 * so the pattern is familiar.
 */
export function useAuthInitialization() {
  const dispatch = useDispatch();
  const { initialized } = useSelector((s) => s.auth);

  useEffect(() => {
    if (initialized) return; // already ran
    let active = true;

    const bootstrap = async () => {
      dispatch(setStatus("loading"));
      try {
        const session = await getSessionFromRefresh();
        if (!active) return;
        dispatch(
          setSession({
            accessToken: session.access_token,
            user:        session.user,
            expiresAt:   session.expires_at ?? null,
          }),
        );
        dispatch(finishHydration());
      } catch {
        if (!active) return;
        dispatch(clearSession());
        dispatch(finishHydration());
      }
    };

    void bootstrap();
    return () => { active = false; };
  }, [dispatch, initialized]);

  return { isInitialized: initialized };
}