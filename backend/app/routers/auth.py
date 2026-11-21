from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import timedelta
from ..database import get_db
from ..models import User, Tenant
from ..auth import verify_password, create_access_token, get_password_hash, get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

class Token(BaseModel):
    access_token: str
    token_type: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    tenant_name: str
    email: EmailStr
    password: str

@router.post("/register", response_model=Token)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    # Create tenant + owner user
    tenant = Tenant(name=req.tenant_name)
    db.add(tenant)
    db.flush()
    user = User(
        tenant_id=tenant.id,
        email=req.email,
        hashed_password=get_password_hash(req.password),
        role="owner",
    )
    db.add(user)
    db.commit()
    token = create_access_token({"sub": str(user.id), "tenant_id": str(tenant.id)})
    return {"access_token": token, "token_type": "bearer"}

@router.post("/token", response_model=Token)
def login(form_data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.email).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token({"sub": str(user.id), "tenant_id": str(user.tenant_id)})
    return {"access_token": token, "token_type": "bearer"}

@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "role": current_user.role,
        "tenant_id": str(current_user.tenant_id),
    }
