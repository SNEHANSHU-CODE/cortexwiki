import math
import re
from collections import Counter
from itertools import combinations


STOPWORDS = {
    "about",
    "after",
    "again",
    "against",
    "also",
    "among",
    "because",
    "been",
    "before",
    "being",
    "between",
    "could",
    "does",
    "each",
    "from",
    "have",
    "into",
    "like",
    "made",
    "more",
    "most",
    "other",
    "over",
    "should",
    "some",
    "such",
    "than",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "through",
    "under",
    "very",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "would",
    "your",
}


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def split_sentences(text: str) -> list[str]:
    normalized = clean_text(text)
    if not normalized:
        return []
    return [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", normalized) if segment.strip()]


def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", "-", value).strip("-") or "untitled"


def keyword_score(query: str, text: str) -> float:
    query_terms = [term for term in re.findall(r"[a-zA-Z0-9]{3,}", query.lower()) if term not in STOPWORDS]
    text_terms = set(re.findall(r"[a-zA-Z0-9]{3,}", text.lower()))
    if not query_terms:
        return 0.0
    overlap = sum(1 for term in query_terms if term in text_terms)
    return overlap / len(query_terms)


def cosine_similarity(vector_a: list[float], vector_b: list[float]) -> float:
    if not vector_a or not vector_b or len(vector_a) != len(vector_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vector_a, vector_b))
    magnitude_a = math.sqrt(sum(a * a for a in vector_a))
    magnitude_b = math.sqrt(sum(b * b for b in vector_b))
    if magnitude_a == 0 or magnitude_b == 0:
        return 0.0
    return dot / (magnitude_a * magnitude_b)


def extract_candidate_concepts(text: str, limit: int = 12) -> list[str]:
    sentences = split_sentences(text)
    capitalized = re.findall(r"\b(?:[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)\b", text)
    counts = Counter(
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", text)
        if word.lower() not in STOPWORDS
    )

    concepts: list[str] = []
    for phrase in capitalized:
        normalized = phrase.strip()
        if normalized and normalized not in concepts:
            concepts.append(normalized)

    for word, _count in counts.most_common(limit * 2):
        candidate = word.title()
        if candidate not in concepts:
            concepts.append(candidate)

    sentence_titles = [sentence[:80].strip() for sentence in sentences[:2] if sentence.strip()]
    for candidate in sentence_titles:
        if candidate and candidate not in concepts:
            concepts.append(candidate)

    return concepts[:limit]


def build_relationships(concepts: list[str], text: str, limit: int = 20) -> list[dict]:
    relationships: list[dict] = []
    sentences = split_sentences(text)
    concept_set = {concept.lower(): concept for concept in concepts}

    for sentence in sentences:
        present = []
        lowered = sentence.lower()
        for raw, original in concept_set.items():
            if raw in lowered:
                present.append(original)
        for source, target in combinations(sorted(set(present)), 2):
            relationships.append(
                {
                    "source": source,
                    "target": target,
                    "type": "ASSOCIATED_WITH",
                    "evidence": sentence[:240],
                }
            )
            if len(relationships) >= limit:
                return relationships

    if not relationships and len(concepts) > 1:
        for source, target in zip(concepts, concepts[1:]):
            relationships.append(
                {
                    "source": source,
                    "target": target,
                    "type": "RELATED_TO",
                    "evidence": "Derived from shared source content.",
                }
            )
            if len(relationships) >= limit:
                break
    return relationships


def chunk_words(text: str) -> list[str]:
    return [f"{word} " for word in text.split()]
