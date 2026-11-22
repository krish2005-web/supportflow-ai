from pydantic import BaseModel,ConfigDict,Field
from datetime import datetime
from typing import Literal

class TicketCreate(BaseModel):
    title:str
    description:str
    priority: Literal["low", "medium", "high", "urgent"]

class TicketResponse(BaseModel):

    model_config=ConfigDict(from_attributes=True)

    id:int
    title:str
    description:str
    status:str
    priority:str
    customer_id:int
    assigned_to:int | None
    created_at:datetime
    updated_at:datetime

class TicketUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title:str | None=None
    description:str | None=None
    

class TicketStatusUpdate(BaseModel):
    status: Literal["open", "in_progress", "resolved", "closed"]

class TicketAnalysis(BaseModel):
    category:Literal["account_access","payment","technical","other"]
    suggested_priority:Literal["low","medium","high","urgent"]
    summary:str
    suggested_reply:str

class TicketAnalysisWithSources(TicketAnalysis):
    sources: list[str]

class TicketPriorityApproval(BaseModel):
    priority:Literal["low","medium","high","urgent"]

class TicketAIAnalysisResponse(BaseModel):

    model_config = ConfigDict(from_attributes=True)

    id:int
    ticket_id:int
    category:str
    suggested_priority:str
    summary:str
    suggested_reply:str
    created_at:datetime
    approved_by: int | None = None
    approved_at: datetime | None = None
    approved_reply: str | None = None
    reply_approved_by: int | None = None
    reply_approved_at: datetime | None = None
    sources: list[str] = Field(default_factory=list)

class TicketReplyApproval(BaseModel):
    approved_reply: str

class TicketChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class TicketChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[TicketChatHistoryItem] = Field(default_factory=list, max_length=8)


class TicketChatResponse(BaseModel):
    ticket_id: int
    answer: str
    sources: list[str] = Field(default_factory=list)


class TicketMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TicketMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    sender_id: int
    sender_role: str
    body: str
    source: str
    created_at: datetime
