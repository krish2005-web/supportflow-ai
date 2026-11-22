from sqlalchemy import Column,Integer,String,Text
from pgvector.sqlalchemy import VECTOR
from app.db.database import Base

class DocumentChunk(Base):
    __tablename__="document_chunk"
    id=Column(Integer,primary_key=True,index=True)
    source=Column(String(255),nullable=False)
    content=Column(Text,nullable=False)
    embedding=Column(VECTOR(768),nullable=False)