from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from app.db.database import Base


class TicketMessage(Base):
    __tablename__ = "ticket_messages"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sender_role = Column(String(20), nullable=False)  
    body = Column(Text, nullable=False)
    source = Column(String(30), nullable=False, default="manual")  
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
