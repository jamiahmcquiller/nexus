from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from ..database import get_db
from ..models import User, Tenant
from ..auth import verify_password, create_access_token, get_password_hash, get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Administrator workspaces. One sign-in, one JWT, two workspaces:
# an authorized user switches between them without signing in again.
# The server is the source of truth for which workspaces a role may
# open; the console only renders what this endpoint returns.
#   owner / admin  -> both workspaces
#   technician     -> IT Operations only
#   auditor        -> Security Operations only
# Any other / unknown role gets no administrator workspace.
WORKSPACE_ACCESS: dict[str, list[str]] = {
    "owner": ["operations", "security"],
    "admin": ["operations", "security"],
    "technician": ["operations"],
    "auditor": ["security"],
}


def workspaces_for_role(role: str) -> list[str]:
    """Administrator workspaces a role is authorized to open."""
    return list(WORKSPACE_ACCESS.get((role or "").lower(), []))

class Token(BaseModel):
    access_token: str
    token_type: str

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    tenant_name: str
    username: str
    password: str

@router.post("/register", response_model=Token)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    try:
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
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

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
        "workspaces": workspaces_for_role(current_user.role),
    }


@router.get("/workspaces")
def workspaces(current_user: User = Depends(get_current_user)):
    """Administrator workspaces the signed-in user may open.

    The same access token authorizes both workspaces — switching
    workspaces in the console never requires signing in again.
    A user with no authorized workspace gets an empty list and the
    console shows that plainly instead of guessing.
    """
    return {
        "username": current_user.username,
        "role": current_user.role,
        "tenant_id": str(current_user.tenant_id),
        "workspaces": workspaces_for_role(current_user.role),
    }
