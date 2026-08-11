from sqlalchemy import asc, desc, select

from app.assets.model import AssetDefinition
from app.assets.storage import AssetStorage
from app.database import Database


class AssetNotFoundError(KeyError):
    """Raised when an asset id does not exist in the library."""


SORT_COLUMNS = {
    "name": AssetDefinition.name,
    "import_date": AssetDefinition.import_date,
}
ORDER_DIRECTIONS = {"asc": asc, "desc": desc}


class AssetLibrary:
    """I list, fetch, and delete asset definitions."""

    def __init__(self, database: Database, storage: AssetStorage) -> None:
        self._database = database
        self._storage = storage

    @staticmethod
    def _escape_like(pattern: str) -> str:
        return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def list(
        self, search: str | None = None, sort: str = "import_date", order: str = "desc"
    ) -> list[AssetDefinition]:
        statement = select(AssetDefinition)
        if search:
            statement = statement.where(
                AssetDefinition.name.ilike(f"%{self._escape_like(search)}%", escape="\\")
            )
        statement = statement.order_by(
            ORDER_DIRECTIONS[order](SORT_COLUMNS[sort]), AssetDefinition.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, asset_id: str) -> AssetDefinition:
        with self._database.session() as session:
            definition = session.get(AssetDefinition, asset_id)
        if definition is None:
            raise AssetNotFoundError(asset_id)
        return definition

    def delete(self, asset_id: str) -> None:
        with self._database.session() as session:
            definition = session.get(AssetDefinition, asset_id)
            if definition is None:
                raise AssetNotFoundError(asset_id)
            stored_paths = [definition.original_path, definition.thumbnail_path]
            session.delete(definition)
            session.commit()
        for relative_path in stored_paths:
            self._storage.remove(relative_path)
