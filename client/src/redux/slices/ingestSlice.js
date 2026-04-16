import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchIngestionHistory, ingestWeb, ingestYouTube } from "../../utils/api";
import { buildErrorMessage } from "../../utils/sliceUtils";

export const loadIngestionHistory = createAsyncThunk(
  "ingest/loadHistory",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchIngestionHistory();
    } catch (error) {
      return rejectWithValue(buildErrorMessage(error, "Unable to load ingestion history."));
    }
  },
);

export const submitIngestion = createAsyncThunk(
  "ingest/submit",
  async ({ sourceType, url }, { rejectWithValue }) => {
    try {
      return sourceType === "youtube"
        ? await ingestYouTube(url)
        : await ingestWeb(url);
    } catch (error) {
      return rejectWithValue(buildErrorMessage(error, "Unable to ingest that source."));
    }
  },
);

const initialState = {
  items: [],
  historyStatus: "idle",   // idle | loading | succeeded | failed
  submitStatus: "idle",    // idle | loading | succeeded | failed
  error: null,
  successMessage: null,
  latestResult: null,
};

const ingestSlice = createSlice({
  name: "ingest",
  initialState,
  reducers: {
    clearIngestFeedback(state) {
      state.error          = null;
      state.successMessage = null;
    },
    resetSubmitStatus(state) {
      state.submitStatus = "idle";
    },
  },
  extraReducers: (builder) => {
    builder
      // ── History ──────────────────────────────────────────────
      .addCase(loadIngestionHistory.pending, (state) => {
        state.historyStatus = "loading";
        state.error         = null;
      })
      .addCase(loadIngestionHistory.fulfilled, (state, action) => {
        state.items         = action.payload;
        state.historyStatus = "succeeded";
      })
      .addCase(loadIngestionHistory.rejected, (state, action) => {
        state.historyStatus = "failed";
        state.error         = action.payload || "Unable to load ingestion history.";
      })
      // ── Submit ───────────────────────────────────────────────
      .addCase(submitIngestion.pending, (state) => {
        state.submitStatus   = "loading";
        state.error          = null;
        state.successMessage = null;
      })
      .addCase(submitIngestion.fulfilled, (state, action) => {
        const result           = action.payload;
        state.submitStatus     = "succeeded";
        state.latestResult     = result;
        state.successMessage   = `"${result.title}" is ready in your knowledge base.`;
        // Prepend new item, dedupe by id
        state.items = [
          {
            id:          result.id,
            title:       result.title,
            source_type: result.source_type,
            source_url:  result.source_url,
            summary:     result.summary,
            created_at:  result.created_at,
          },
          ...state.items.filter((item) => item.id !== result.id),
        ];
      })
      .addCase(submitIngestion.rejected, (state, action) => {
        state.submitStatus = "failed";
        state.error        = action.payload || "Unable to ingest that source.";
      });
  },
});

export const { clearIngestFeedback, resetSubmitStatus } = ingestSlice.actions;

export default ingestSlice.reducer;