from app.app_factory import create_app
from app.logging import setup_logging

setup_logging()

app = create_app()
