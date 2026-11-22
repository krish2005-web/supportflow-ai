
from functools import lru_cache

from google import genai
from google.genai import types
from app.core.config import settings


@lru_cache(maxsize=1)
def _get_client():
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not configured. Add a valid Gemini API key to .env "
            "to use ResolveIQ analysis and chat."
        )
    return genai.Client(api_key=api_key)

EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSIONS = 768


def generate_embedding(text: str):
    response = _get_client().models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config=types.EmbedContentConfig(
            output_dimensionality=EMBEDDING_DIMENSIONS
        )
    )

    return response.embeddings[0].values


if __name__ == "__main__":
    sample_text = (
        "title: Payment Issues Support Policy | "
        "text: Customer reports failed payment but money was deducted."
    )

    embedding = generate_embedding(sample_text)

    print("Embedding dimensions:", len(embedding))
    print("First 5 values:", embedding[:5])

def embed_chunks(chunks):
    embedded_chunks = []

    for chunk in chunks:
        document_text = f"title: {chunk['source']} | text: {chunk['content']}"

        embedding = generate_embedding(document_text)

        embedded_chunk = {
            "source": chunk["source"],
            "content": chunk["content"],
            "embedding": embedding
        }

        embedded_chunks.append(embedded_chunk)

    return embedded_chunks

if __name__ == "__main__":
    from app.ai.document_loader import load_documents
    from app.ai.chunking import chunk_documents

    documents = load_documents()
    chunks = chunk_documents(documents)

    embedded_chunks = embed_chunks(chunks)

    print("Total embedded chunks:", len(embedded_chunks))
    print("Embedding dimensions:", len(embedded_chunks[0]["embedding"]))
    print("Source:", embedded_chunks[0]["source"])