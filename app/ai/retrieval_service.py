import hashlib
import json
import re
from collections import Counter
from functools import lru_cache

import redis
from redis.exceptions import RedisError

from app.ai.chunking import chunk_documents
from app.ai.document_loader import load_documents
from app.ai.embedding_service import generate_embedding
from app.core.config import settings
from app.db.database import SessionLocal
from app.models.document_chunk import DocumentChunk



redis_client = redis.Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=1.5,
    socket_timeout=1.5,
)

CACHE_TTL = 1800



STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by",
    "can", "could", "did", "do", "does", "for", "from",
    "how", "i", "in", "is", "it", "me", "my", "of", "on",
    "or", "our", "please", "should", "the", "this", "to",
    "was", "we", "what", "when", "where", "which", "who",
    "why", "will", "with", "you", "your",
}



SYNONYMS = {
    "login": {"account", "access", "password"},
    "signin": {"account", "access", "password", "login"},
    "locked": {"account", "access", "password"},
    "deducted": {"payment", "transaction", "money"},
    "charged": {"payment", "transaction", "money"},
    "money": {"payment", "transaction", "deducted"},
    "refund": {"payment", "transaction"},
    "reversal": {"refund", "payment", "transaction"},
    "upi": {"payment", "transaction"},
    "card": {"payment", "transaction", "cvv"},
}



def get_tokens(text):

    words = re.findall(r"[a-z0-9]+", text.lower())

    return [
        word for word in words
        if word not in STOP_WORDS and len(word) > 1
    ]



def expand_terms(text):

    terms = set(get_tokens(text))

    for word in list(terms):
        related_words = SYNONYMS.get(word, set())
        terms.update(related_words)

    return terms



@lru_cache(maxsize=1)
def get_local_chunks():

    documents = load_documents()

    return tuple(chunk_documents(documents))



def lexical_search(query, top_k):

    query_terms = expand_terms(query)

    if not query_terms:
        return []

    chunks = get_local_chunks()

    results = []

    for chunk in chunks:

        words = get_tokens(chunk["content"])

        word_counts = Counter(words)

        
        matching_words = query_terms.intersection(word_counts)

        if not matching_words:
            continue

        
        score = sum(
            1 + word_counts[word]
            for word in matching_words
        )

        results.append((score, chunk))

    
    results.sort(key=lambda item: item[0], reverse=True)

    return [
        chunk
        for score, chunk in results[:top_k]
    ]



def vector_search(query, top_k):

    db = SessionLocal()

    try:

        
        if db.query(DocumentChunk.id).first() is None:
            return []

        
        embedding = generate_embedding(
            f"task: question answering | query: {query}"
        )

        
        documents = (
            db.query(DocumentChunk)
            .order_by(
                DocumentChunk.embedding.cosine_distance(embedding)
            )
            .limit(top_k)
            .all()
        )

        results = []

        for document in documents:

            results.append({
                "source": document.source,
                "content": document.content,
            })

        return results

    finally:
        db.close()



def retrieve_documents(
    query: str,
    top_k: int = 3,
    *,
    allow_vector_fallback: bool = True,
):

    
    normalized_query = " ".join(query.lower().split())

    query_hash = hashlib.sha256(
        normalized_query.encode("utf-8")
    ).hexdigest()

    cache_key = f"resolveiq:retrieval:v2:{top_k}:{query_hash}"

    
    try:

        cached_data = redis_client.get(cache_key)

        if cached_data:
            return json.loads(cached_data)

    except (RedisError, ValueError, TypeError):
        pass

    
    try:

        results = lexical_search(query, top_k)

        
        if not results and allow_vector_fallback:
            results = vector_search(query, top_k)

    except Exception:

        
        results = lexical_search(query, top_k)

    
    try:

        redis_client.set(
            cache_key,
            json.dumps(results),
            ex=CACHE_TTL,
        )

    except RedisError:
        pass

    return results