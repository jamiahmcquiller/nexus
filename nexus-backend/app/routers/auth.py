from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from ..database import get_db
from ..models import User, Tenant
from ..auth import verify_password, create_access_token, get_password_hash, get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

class Token(BaseModel):
    access_token: str
    token_type: str

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=2, max_length=64, pattern=r"^\S+$")
    password: str = Field(min_length=8, max_length=128)

@router.post("/register", response_model=Token)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    # Usernames are global for now because login looks users up by username alone.
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=409, detail="That username is already taken")
    # Create tenant + owner user
    tenant = Tenant(name=req.tenant_name)
    db.add(tenant)
    db.flush()
    user = User(
        tenant_id=tenant.id,
        username=req.username,
        hashed_password=get_password_hash(req.password),
        role="owner",
    )
    db.add(user)
    db.commit()
    token = create_access_token({"sub": str(user.id), "tenant_id": str(tenant.id)})
    return {"access_token": token, "token_type": "bearer"}

@router.post("/token", response_model=Token)
def login(form_data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token({"sub": str(user.id), "tenant_id": str(user.tenant_id)})
    return {"access_token": token, "token_type": "bearer"}

@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "role": current_user.role,
        "tenant_id": str(current_user.tenant_id),
    }
