/**
 * Extracts a human-readable error message from an Axios error or plain Error.
 * Used by async thunks across all slices.
 */
export function buildErrorMessage(error, fallback = "Something went wrong.") {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}