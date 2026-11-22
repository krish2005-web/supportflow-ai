from fastapi.security import HTTPAuthorizationCredentials,HTTPBearer
import jwt
from fastapi import Depends,HTTPException,status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.user import User
from app.db.database import get_db

security=HTTPBearer()

def get_current_user(credentials:HTTPAuthorizationCredentials=Depends(security),
                     db:Session=Depends(get_db)
                     ):
    token=credentials.credentials
    try:
        payload=jwt.decode(
                        token,
                        settings.secret_key,
                        algorithms=[settings.algorithm]
        )
        user_id=payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401,detail="Invalid token ")
        user_id=int(user_id)
        user=db.query(User).filter(User.id==user_id).first()
        if not user:
            raise HTTPException(status_code=401,detail="User not found")
        return user

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401,detail="Token has expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401,detail="Invalid Token")

    
def require_role(role: str):
    def role_checker(current_user=Depends(get_current_user)):
        if current_user.role != role:
            raise HTTPException(
                status_code=403,
                detail="Permission denied"
            )
        return current_user

    return role_checker

