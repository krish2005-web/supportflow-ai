from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

KNOWLEDGE_BASE_DIR = BASE_DIR / "knowledge_base"


def load_documents():
    documents = []

    for file in KNOWLEDGE_BASE_DIR.glob("*.md"):
        content = file.read_text(encoding="utf-8")

        document = {
            "source": file.name,
            "content": content
        }

        documents.append(document)

    return documents


if __name__ == "__main__":
    documents = load_documents()

    print("Total documents:", len(documents))

    for document in documents:
        print(document["source"])