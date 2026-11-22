from sqlalchemy import Column,Integer,String,Text,DateTime,ForeignKey,func
from app.db.database import Base
from sqlalchemy import JSON, text

class TicketAIAnalysis(Base):
    __tablename__="ticket_ai_analyses"
    id=Column(Integer,primary_key=True,index=True)
    ticket_id=Column(Integer,ForeignKey("tickets.id"),nullable=False,index=True)
    category=Column(String(50),nullable=False)
    suggested_priority=Column(String(30),nullable=False)
    summary=Column(Text,nullable=False)
    suggested_reply=Column(Text,nullable=False)
    created_at=Column(DateTime(timezone=True),server_default=func.now(),nullable=False)
    approved_by=Column(Integer,ForeignKey("users.id"),nullable=True)
    approved_at=Column(DateTime(timezone=True),nullable=True)
    approved_reply=Column(Text,nullable=True)
    reply_approved_by=Column(Integer,ForeignKey("users.id"),nullable=True)
    reply_approved_at=Column(DateTime(timezone=True),nullable=True)
    sources = Column(
    JSON,
    nullable=False,
    default=list,
    server_default=text("'[]'::json")
)