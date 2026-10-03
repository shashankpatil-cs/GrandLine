import os
from datetime import datetime, timedelta, timezone
import jwt
from passlib.context import CryptContext
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import secrets

from .database import users_collection, redis_client
from .models import UserCreate, Token, RefreshToken

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "supersecretkey_please_change")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
SESSION_TTL_SECONDS = 45

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")
router = APIRouter(prefix="/api/auth", tags=["auth"])


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(token: str = Depends(oauth2_scheme)):
    return await get_user_from_token(token)

async def get_user_from_token(token: str):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        sid: str = payload.get("sid")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    
    user = await users_collection.find_one({"username": username})
    if user is None:
        raise credentials_exception

    # Check if session is still active
    if sid:
        current_sid = await redis_client.get(f"user_session:{username}")
        if current_sid is None:
            # Re-establish key in case server/redis restarted
            await redis_client.setex(f"user_session:{username}", SESSION_TTL_SECONDS, sid)
        elif current_sid != sid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired: logged in from another device",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return user


@router.post("/register", response_model=Token)
async def register(user: UserCreate):
    existing_user = await users_collection.find_one({"username": user.username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = {"username": user.username, "hashed_password": hashed_password}
    await users_collection.insert_one(new_user)
    
    session_id = secrets.token_urlsafe(16)
    await redis_client.setex(f"user_session:{user.username}", SESSION_TTL_SECONDS, session_id)
    
    access_token = create_access_token(
        data={"sub": user.username, "sid": session_id}, 
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    refresh_token = secrets.token_urlsafe(32)
    
    # Store refresh token in redis
    await redis_client.setex(
        f"refresh_token:{refresh_token}", 
        timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), 
        user.username
    )
    
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    force: bool = Query(False)
):
    user = await users_collection.find_one({"username": form_data.username})
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    username = user["username"]
    active_session = await redis_client.get(f"user_session:{username}")
    if active_session and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User '{username}' is already logged in on another device or tab. Please log out first."
        )

    session_id = secrets.token_urlsafe(16)
    await redis_client.setex(f"user_session:{username}", SESSION_TTL_SECONDS, session_id)

    access_token = create_access_token(
        data={"sub": username, "sid": session_id}, 
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    refresh_token = secrets.token_urlsafe(32)
    
    # Store refresh token in redis
    await redis_client.setex(
        f"refresh_token:{refresh_token}", 
        timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), 
        user["username"]
    )
    
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/refresh", response_model=Token)
async def refresh(refresh_req: RefreshToken):
    username = await redis_client.get(f"refresh_token:{refresh_req.refresh_token}")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Invalid or expired refresh token"
        )
    
    # Rotate refresh token
    await redis_client.delete(f"refresh_token:{refresh_req.refresh_token}")
    new_refresh_token = secrets.token_urlsafe(32)
    await redis_client.setex(
        f"refresh_token:{new_refresh_token}", 
        timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), 
        username
    )
    
    session_id = secrets.token_urlsafe(16)
    await redis_client.setex(f"user_session:{username}", SESSION_TTL_SECONDS, session_id)
    
    access_token = create_access_token(
        data={"sub": username, "sid": session_id}, 
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "refresh_token": new_refresh_token, "token_type": "bearer"}


@router.post("/heartbeat")
async def heartbeat(user: dict = Depends(get_current_user)):
    username = user["username"]
    current_sid = await redis_client.get(f"user_session:{username}")
    if current_sid:
        await redis_client.expire(f"user_session:{username}", SESSION_TTL_SECONDS)
    return {"status": "ok"}


@router.post("/logout")
async def logout(request: Request, refresh_req: RefreshToken | None = None):
    if refresh_req and refresh_req.refresh_token:
        await redis_client.delete(f"refresh_token:{refresh_req.refresh_token}")
    
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            sid = payload.get("sid")
            if username and sid:
                current_sid = await redis_client.get(f"user_session:{username}")
                if current_sid == sid:
                    await redis_client.delete(f"user_session:{username}")
                    status_keys = await redis_client.keys(f"status:*:{username}")
                    if status_keys:
                        await redis_client.delete(*status_keys)
        except Exception:
            pass
    return {"msg": "Successfully logged out"}


@router.post("/release-session")
async def release_session(token: str = Query(None)):
    if not token:
        return {"msg": "No token provided"}
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        sid = payload.get("sid")
        if username and sid:
            current_sid = await redis_client.get(f"user_session:{username}")
            if current_sid == sid:
                await redis_client.delete(f"user_session:{username}")
                status_keys = await redis_client.keys(f"status:*:{username}")
                if status_keys:
                    await redis_client.delete(*status_keys)
    except Exception:
        pass
    return {"msg": "Session released"}
