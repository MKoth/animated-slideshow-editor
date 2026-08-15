from sqlalchemy import Column, create_engine, inspect, text
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
        self._add_missing_columns()

    def session(self) -> Session:
        return Session(self._engine, expire_on_commit=False)

    def _add_missing_columns(self) -> None:
        """Add columns introduced after a table was first created.

        create_all only creates missing tables, so a database written by an
        older version of the app lacks newer columns. Only columns that can be
        back-filled safely are added: nullable, no server default, no unique
        constraint. A column with a server default would need a backfill query
        instead — not present in the schema yet.
        """
        with self._engine.begin() as connection:
            inspector = inspect(connection)
            for table in Base.metadata.sorted_tables:
                existing = {column["name"] for column in inspector.get_columns(table.name)}
                for column in table.columns:
                    if column.name in existing or not _is_addable(column):
                        continue
                    column_sql = column.type.compile(connection.dialect)
                    connection.execute(
                        text(f"ALTER TABLE {table.name} ADD COLUMN {column.name} {column_sql}")
                    )


def _is_addable(column: Column[object]) -> bool:
    return bool(
        column.nullable
        and column.default is None
        and column.server_default is None
        and not column.unique
    )
