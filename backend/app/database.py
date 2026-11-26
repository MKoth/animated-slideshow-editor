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
        self._ensure_indexes()
        self._ensure_project_order_columns()

    def _ensure_project_order_columns(self) -> None:
        with self._engine.begin() as connection:
            for table in ("projects", "project_folders"):
                if table not in inspect(connection).get_table_names():
                    continue
                columns = {column["name"] for column in inspect(connection).get_columns(table)}
                added = "sort_order" not in columns
                has_nulls = False
                if added:
                    connection.execute(
                        text(
                            f"ALTER TABLE {table} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
                        )
                    )
                else:
                    has_nulls = (
                        connection.execute(
                            text(f"SELECT 1 FROM {table} WHERE sort_order IS NULL LIMIT 1")
                        ).first()
                        is not None
                    )
                if added:
                    if table == "project_folders":
                        rows = connection.execute(
                            text("SELECT id FROM project_folders ORDER BY lower(name), id")
                        ).all()
                        for index, (folder_id,) in enumerate(rows):
                            connection.execute(
                                text(
                                    "UPDATE project_folders SET sort_order = :order WHERE id = :id"
                                ),
                                {"order": index, "id": folder_id},
                            )
                    else:
                        rows = connection.execute(
                            text(
                                "SELECT id, folder_id FROM projects "
                                "ORDER BY folder_id, last_modified DESC, id"
                            )
                        ).all()
                        next_project_order: dict[str | None, int] = {}
                        for project_id, folder_id in rows:
                            order = next_project_order.get(folder_id, 0)
                            connection.execute(
                                text("UPDATE projects SET sort_order = :order WHERE id = :id"),
                                {"order": order, "id": project_id},
                            )
                            next_project_order[folder_id] = order + 1
                elif has_nulls and table == "project_folders":
                    rows = connection.execute(
                        text(
                            "SELECT id, name FROM project_folders WHERE sort_order IS NULL "
                            "ORDER BY lower(name), id"
                        )
                    ).all()
                    last_order = connection.scalar(
                        text("SELECT coalesce(max(sort_order), -1) FROM project_folders")
                    )
                    next_folder_order = (int(last_order) if last_order is not None else -1) + 1
                    for folder_id, _ in rows:
                        connection.execute(
                            text("UPDATE project_folders SET sort_order = :order WHERE id = :id"),
                            {"order": next_folder_order, "id": folder_id},
                        )
                        next_folder_order += 1
                elif has_nulls:
                    rows = connection.execute(
                        text(
                            "SELECT id, folder_id FROM projects WHERE sort_order IS NULL "
                            "ORDER BY folder_id, last_modified DESC, id"
                        )
                    ).all()
                    for project_id, folder_id in rows:
                        last_order = connection.scalar(
                            text(
                                "SELECT coalesce(max(sort_order), -1) FROM projects "
                                "WHERE folder_id IS :folder_id"
                            ),
                            {"folder_id": folder_id},
                        )
                        next_project_index = (int(last_order) if last_order is not None else -1) + 1
                        connection.execute(
                            text("UPDATE projects SET sort_order = :order WHERE id = :id"),
                            {"order": next_project_index, "id": project_id},
                        )

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

    def _ensure_indexes(self) -> None:
        """Create indexes introduced after a table was first created.

        create_all creates missing tables (with their indexes) but does not
        add indexes to tables that already exist, so databases written by an
        older version of the app would otherwise miss them. IF NOT EXISTS
        keeps this idempotent.
        """
        with self._engine.begin() as connection:
            if "projects" not in inspect(connection).get_table_names():
                return
            for statement in (
                (
                    "CREATE INDEX IF NOT EXISTS ix_projects_last_modified"
                    " ON projects (last_modified)"
                ),
                ("CREATE INDEX IF NOT EXISTS ix_projects_folder_id ON projects (folder_id)"),
            ):
                connection.execute(text(statement))


def _is_addable(column: Column[object]) -> bool:
    if column.unique:
        return False
    if column.server_default is not None:
        return False
    if column.nullable:
        return True
    # Non-nullable column: safe to add only if it has a Python-side default
    # that SQLite will apply to existing rows via ALTER TABLE ADD COLUMN … DEFAULT.
    return column.default is not None
