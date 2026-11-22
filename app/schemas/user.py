from pydantic import BaseModel,ConfigDict,EmailStr
from datetime import datetime

class UserCreate(BaseModel):
    name:str
    email:EmailStr
    password:str

class UserResponse(BaseModel):
    model_config=ConfigDict(from_attributes=True)
    id:int
    name:str
    email:EmailStr
    role:str
    created_at:datetime

class UserLogin(BaseModel):
    email:EmailStr
    password:str

class LoginResponse(BaseModel):
    access_token:str
    token_type:str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str


class VerifyResetOtpRequest(BaseModel):
    email: EmailStr
    otp: str


class VerifyResetOtpResponse(BaseModel):
    message: str
    reset_token: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ResetPasswordResponse(BaseModel):
    message: str
