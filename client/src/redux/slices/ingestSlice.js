import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchIngestionHistory, ingestWeb, ingestYouTube } from "../../utils/api";
import { buildErrorMessage } from "../../utils/sliceUtils";

export const loadIngestionHistory = createAsyncThunk(
  "ingest/loadHistory",
  async (wikiId, { rejectWithValue }) => {
    try { return await fetchIngestionHistory(wikiId); }
    catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to load ingestion history.")); }
  },
);

export const submitIngestion = createAsyncThunk(
  "ingest/submit",
  async ({ sourceType, url, wikiId }, { rejectWithValue }) => {
    try {
      return sourceType === "youtube"
        ? await ingestYouTube(url, wikiId)
        : await ingestWeb(url, wikiId);
    } catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to ingest that source.")); }
  },
);

const initialState = {
  items: [], historyStatus: "idle", submitStatus: "idle",
  error: null, successMessage: null, latestResult: null,
};

const ingestSlice = createSlice({
  name: "ingest",
  initialState,
  reducers: {
    clearIngestFeedback(state) { state.error = null; state.successMessage = null; },
    resetSubmitStatus(state)   { state.submitStatus = "idle"; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadIngestionHistory.pending,   (s) => { s.historyStatus = "loading"; s.error = null; })
      .addCase(loadIngestionHistory.fulfilled, (s, a) => { s.items = a.payload; s.historyStatus = "succeeded"; })
      .addCase(loadIngestionHistory.rejected,  (s, a) => { s.historyStatus = "failed"; s.error = a.payload; })

      .addCase(submitIngestion.pending,   (s) => { s.submitStatus = "loading"; s.error = null; s.successMessage = null; })
      .addCase(submitIngestion.fulfilled, (s, a) => {
        const r = a.payload;
        s.submitStatus   = "succeeded";
        s.latestResult   = r;
        s.successMessage = `"${r.title}" is ready in your knowledge base.`;
        s.items = [
          { id: r.id, title: r.title, source_type: r.source_type, source_url: r.source_url, summary: r.summary, created_at: r.created_at },
          ...s.items.filter((i) => i.id !== r.id),
        ];
      })
      .addCase(submitIngestion.rejected, (s, a) => { s.submitStatus = "failed"; s.error = a.payload; });
  },
});

export const { clearIngestFeedback, resetSubmitStatus } = ingestSlice.actions;
export default ingestSlice.reducer;