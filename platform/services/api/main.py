"""
Platform API — FastAPI app for uvicorn.
Run: python -m uvicorn platform.services.api.main:app --host 127.0.0.1 --port 8000
"""

from fastapi import FastAPI

app = FastAPI(title="Platform API", version="0.1.0")


@app.get("/")
async def root():
    return {"status": "ok", "message": "Platform API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
