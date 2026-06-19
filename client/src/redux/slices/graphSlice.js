import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchKnowledgeGraph } from "../../utils/api";
import { buildErrorMessage } from "../../utils/sliceUtils";

export const requestGraph = createAsyncThunk(
  "graph/requestGraph",
  async ({ wikiId, topic = "" }, { rejectWithValue, signal }) => {
    try {
      const graph = await fetchKnowledgeGraph(wikiId, topic, { signal });
      return { topic, graph };
    } catch (e) {
      if (e.name === 'AbortError' || e.code === 'ERR_CANCELED') throw e;
      return rejectWithValue(buildErrorMessage(e, "Unable to load the knowledge graph.")); 
    }
  },
);

const initialState = {
  nodes: [], edges: [], topic: "",
  selectedNodeId: "", status: "idle", error: null,
};

const graphSlice = createSlice({
  name: "graph",
  initialState,
  reducers: {
    selectGraphNode(state, action) { state.selectedNodeId = action.payload; },
    clearGraphError(state)         { state.error = null; },
    clearGraphState()              { return initialState; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(requestGraph.pending, (s, a) => {
        s.status = "loading"; s.error = null;
        s.topic  = a.meta.arg?.topic ?? "";
      })
      .addCase(requestGraph.fulfilled, (s, a) => {
        const { graph, topic } = a.payload;
        const topicNode  = graph.nodes.find((n) => n.id?.toLowerCase() === (topic ?? "").trim().toLowerCase());
        const existingNode = graph.nodes.find((n) => n.id === s.selectedNodeId);
        s.nodes          = graph.nodes;
        s.edges          = graph.edges;
        s.topic          = topic ?? "";
        s.status         = "succeeded";
        s.selectedNodeId = topicNode?.id ?? existingNode?.id ?? graph.nodes[0]?.id ?? "";
      })
      .addCase(requestGraph.rejected, (s, a) => {
        s.status = "failed";
        s.error  = a.payload || "Unable to load the knowledge graph.";
      });
  },
});

export const { selectGraphNode, clearGraphError, clearGraphState } = graphSlice.actions;
export default graphSlice.reducer;