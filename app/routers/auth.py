
import secrets
import redis

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.core.email_service import send_password_reset_otp, smtp_configured

from app.db.database import get_db
from app.models.user import User

from app.schemas.user import (
    UserCreate,
    UserLogin,
    UserResponse,
    LoginResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    VerifyResetOtpRequest,
    VerifyResetOtpResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])


# Redis settings
RESET_TTL = 300

OTP_PREFIX = "supportflow:pwdotp:"
TOKEN_PREFIX = "supportflow:pwdreset:"


# Connect to Redis
def get_redis():
    return redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True
    )




@router.post("/register", response_model=UserResponse, status_code=201)
def create_user(user_data: UserCreate, db: Session = Depends(get_db)):

    email = user_data.email.lower().strip()

    if len(user_data.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    if not user_data.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")

    existing_user = db.query(User).filter(User.email == email).first()

    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    new_user = User(
        name=user_data.name.strip(),
        email=email,
        password_hash=hash_password(user_data.password),
        role="customer"
    )

    db.add(new_user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered")

    db.refresh(new_user)

    return new_user




@router.post("/login", response_model=LoginResponse)
def user_login(login_data: UserLogin, db: Session = Depends(get_db)):

    email = login_data.email.lower().strip()

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(login_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id)

    return {
        "access_token": token,
        "token_type": "bearer"
    }




@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):

    return current_user



@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):

    email = payload.email.lower().strip()

    generic_message = (
        "If an account exists for that email, a one-time code was sent. "
        "It expires in 5 minutes."
    )

    user = db.query(User).filter(User.email == email).first()

    if not user:
        return ForgotPasswordResponse(message=generic_message)

    
    otp = f"{secrets.randbelow(1_000_000):06d}"

    
    reset_token = secrets.token_urlsafe(32)

    try:
        r = get_redis()

        r.setex(
            f"{OTP_PREFIX}{email}",
            RESET_TTL,
            f"{user.id}:{otp}:{reset_token}"
        )

        r.setex(
            f"{TOKEN_PREFIX}{reset_token}",
            RESET_TTL,
            str(user.id)
        )

    except redis.RedisError:
        raise HTTPException(
            status_code=503,
            detail="Password reset service is unavailable"
        )

    
    email_sent = send_password_reset_otp(email, otp)

    if email_sent:
        message = (
            "If an account exists, a reset code was sent. "
            "Check your inbox and spam folder."
        )

    elif smtp_configured():
        message = (
            "The reset code was created, but email delivery failed. "
            "Please try again or contact an administrator."
        )

    else:
        message = (
            "Reset code created. Email is not configured. "
            "Check server logs for the local demo OTP."
        )

    return ForgotPasswordResponse(message=message)




@router.post("/verify-reset-otp", response_model=VerifyResetOtpResponse)
def verify_reset_otp(payload: VerifyResetOtpRequest, db: Session = Depends(get_db)):

    email = payload.email.lower().strip()
    otp = payload.otp.strip()

    if len(otp) != 6 or not otp.isdigit():
        raise HTTPException(status_code=400, detail="Enter a valid 6-digit OTP")

    try:
        r = get_redis()
        saved_data = r.get(f"{OTP_PREFIX}{email}")

    except redis.RedisError:
        raise HTTPException(status_code=503, detail="Redis service unavailable")

    if not saved_data:
        raise HTTPException(status_code=400, detail="OTP expired or invalid")

    
    parts = saved_data.split(":")

    if len(parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    user_id, saved_otp, reset_token = parts

    if otp != saved_otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    
    try:
        r.delete(f"{OTP_PREFIX}{email}")
    except redis.RedisError:
        raise HTTPException(status_code=503, detail="Redis service unavailable")

    user = db.query(User).filter(User.id == int(user_id)).first()

    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    return VerifyResetOtpResponse(
        message="OTP verified successfully",
        reset_token=reset_token
    )




@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):

    token = payload.token.strip()
    new_password = payload.new_password

    if len(new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    if not token:
        raise HTTPException(status_code=422, detail="Reset token is required")

    try:
        r = get_redis()
        user_id = r.get(f"{TOKEN_PREFIX}{token}")

    except redis.RedisError:
        raise HTTPException(status_code=503, detail="Redis service unavailable")

    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == int(user_id)).first()

    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    
    user.password_hash = hash_password(new_password)

    db.commit()

    
    r.delete(f"{TOKEN_PREFIX}{token}")

    return ResetPasswordResponse(
        message="Password updated successfully"
    )
