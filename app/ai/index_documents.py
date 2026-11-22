
from app.db.database import SessionLocal
from app.models.document_chunk import DocumentChunk
from app.ai.document_loader import load_documents
from app.ai.chunking import chunk_documents
from app.ai.embedding_service import embed_chunks


def index_documents():
    db = SessionLocal()

    try:
        
        documents = load_documents()

        
        chunks = chunk_documents(documents)

        
        embedded_chunks = embed_chunks(chunks)

        if not embedded_chunks:
            print("No documents to index.")
            return

        
        db.query(DocumentChunk).delete(
            synchronize_session=False
        )

        
        db.add_all([
            DocumentChunk(
                source=item["source"],
                content=item["content"],
                embedding=item["embedding"]
            )
            for item in embedded_chunks
        ])

        
        db.commit()

        print("Documents indexed successfully!")
        print("Total documents:", len(documents))
        print("Total chunks stored:", len(embedded_chunks))

    except Exception as e:
        db.rollback()
        print("Indexing failed:", str(e))
        raise

    finally:
        db.close()


if __name__ == "__main__":
    index_documents()
