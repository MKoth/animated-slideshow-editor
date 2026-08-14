from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.model import Base


class Database:
    """I own the engine and sessions for the asset library database."""

    def __init__(self, database_url: str) -> None:
        self._engine = create_engine(database_url, connect_args={"check_same_thread": False})

    @property
    def engine(self) -> Engine:
        return self._engine

    def init_schema(self) -> None:
        Base.metadata.create_all(self._engine)

    def session(self) -> Session:
        return Session(self._engine, expire_on_commit=False)
