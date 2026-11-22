from typing import Literal
from pydantic import BaseModel, EmailStr, Field


class AdminUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Literal["customer", "agent"]


class AdminRoleUpdate(BaseModel):
    role: Literal["customer", "agent"]


class AdminTicketAssignment(BaseModel):
    agent_id: int = Field(gt=0)
