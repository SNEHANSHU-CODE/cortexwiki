from pydantic import BaseModel, ConfigDict, Field


class GraphNodeData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str = "concept"
    description: str = ""
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    category: str | None = None


class GraphEdgeData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    label: str


class GraphData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodes: list[GraphNodeData]
    edges: list[GraphEdgeData]
