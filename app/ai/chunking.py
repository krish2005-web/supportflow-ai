
from app.ai.document_loader import load_documents

CHUNK_SIZE = 500
CHUNK_OVERLAP = 100


def chunk_documents(documents):
    chunks = []

    for document in documents:
        content = document["content"]
        start = 0

        while start < len(content):
            end = min(start + CHUNK_SIZE, len(content))

            
            if end < len(content):
                boundary = end

                while boundary > start and not content[boundary - 1].isspace():
                    boundary -= 1

                if boundary > start:
                    end = boundary

            chunk_text = content[start:end].strip()

            if chunk_text:
                chunk = {
                    "source": document["source"],
                    "content": chunk_text
                }

                chunks.append(chunk)

            if end >= len(content):
                break

            
            next_start = max(end - CHUNK_OVERLAP, start + 1)

            
            while next_start < len(content) and not content[next_start].isspace():
                next_start += 1

            while next_start < len(content) and content[next_start].isspace():
                next_start += 1

            start = next_start

    return chunks


if __name__ == "__main__":
    documents = load_documents()

    chunks = chunk_documents(documents)

    print("Total documents:", len(documents))
    print("Total chunks:", len(chunks))

    for chunk in chunks[:5]:
        print("Source:", chunk["source"])
        print("Characters:", len(chunk["content"]))
        print("Content:", chunk["content"])
        print("----------------------")
