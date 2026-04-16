import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchKnowledgeGraph } from "../../utils/api";
import { buildErrorMessage } from "../../utils/sliceUtils";

export const requestGraph = createAsyncThunk(
  "graph/requestGraph",
  async (topic = "", { rejectWithValue }) => {
    try {
      const graph = await fetchKnowledgeGraph(topic);
      return { topic, graph };
    } catch (error) {
      return rejectWithValue(buildErrorMessage(error, "Unable to load the knowledge graph."));
    }
  },
);

const initialState = {
  nodes: [],
  edges: [],
  topic: "",
  selectedNodeId: "",
  status: "idle",   // idle | loading | succeeded | failed
  error: null,
};

const graphSlice = createSlice({
  name: "graph",
  initialState,
  reducers: {
    selectGraphNode(state, action) {
      state.selectedNodeId = action.payload;
    },
    clearGraphError(state) {
      state.error = null;
    },
    clearGraphState() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(requestGraph.pending, (state, action) => {
        state.status = "loading";
        state.error  = null;
        state.topic  = action.meta.arg ?? "";
      })
      .addCase(requestGraph.fulfilled, (state, action) => {
        const { graph, topic } = action.payload;
        const topicNode       = graph.nodes.find((n) => n.id.toLowerCase() === topic.trim().toLowerCase());
        const existingNode    = graph.nodes.find((n) => n.id === state.selectedNodeId);

        state.nodes          = graph.nodes;
        state.edges          = graph.edges;
        state.topic          = topic;
        state.status         = "succeeded";
        state.selectedNodeId = topicNode?.id ?? existingNode?.id ?? graph.nodes[0]?.id ?? "";
      })
      .addCase(requestGraph.rejected, (state, action) => {
        state.status = "failed";
        state.error  = action.payload || "Unable to load the knowledge graph.";
      });
  },
});

export const { clearGraphError, clearGraphState, selectGraphNode } = graphSlice.actions;

export default graphSlice.reducer;