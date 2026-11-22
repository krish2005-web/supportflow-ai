from sqlalchemy import Column,Integer,String,ForeignKey,Text,DateTime,func
from app.db.database import Base

class Ticket(Base):
    __tablename__="tickets"
    id=Column(Integer,primary_key=True,index=True)
    title=Column(String(150),nullable=False)
    description=Column(Text)
    status=Column(String(30),nullable=False,default="open")
    priority=Column(String(20),nullable=False)
    customer_id=Column(Integer,ForeignKey("users.id"),nullable=False)
    assigned_to=Column(Integer,ForeignKey("users.id"),nullable=True)
    created_at=Column(DateTime(timezone=True),server_default=func.now())
    updated_at=Column(DateTime(timezone=True),server_default=func.now(),onupdate=func.now())
        
    
    
    

