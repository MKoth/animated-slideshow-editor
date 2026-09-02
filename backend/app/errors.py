import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        from fastapi.encoders import jsonable_encoder

        return JSONResponse(status_code=422, content=jsonable_encoder({"detail": exc.errors()}))

    @app.exception_handler(Exception)
    async def unexpected_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logging.getLogger("app.error").exception(
            "Unhandled exception for %s %s", request.method, request.url.path
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
