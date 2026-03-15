"""Minimal eval-only server that exercises the production handle_message path.

Spawned by the hermes eval adapter's gateway.start(). Never ships to production —
lives in evals/adapters/, not in hermes/src/.

Exposes:
  GET  /pool/health   — health check (matches production)
  POST /agent/query   — runs a query through AgentRunner.handle_message()
"""

import asyncio
import os
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from starlette.responses import PlainTextResponse

from src.agent_runner import AgentRunner, warm_imports

GATEWAY_TOKEN = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")


async def require_auth(request: Request) -> None:
    if not GATEWAY_TOKEN:
        return
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {GATEWAY_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@asynccontextmanager
async def lifespan(app: FastAPI):
    warm_imports()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/pool/health")
async def health():
    return {"ready": True}


class QueryRequest(BaseModel):
    query: str


@app.post("/agent/query")
async def agent_query(request: Request, body: QueryRequest):
    await require_auth(request)
    model = os.environ.get("OPENCLAW_PRIMARY_MODEL") or os.environ.get("HERMES_MODEL") or "anthropic/claude-sonnet-4-6"
    if model.startswith("openrouter/"):
        model = model.removeprefix("openrouter/")

    runner = AgentRunner(
        model=model,
        hermes_home=os.environ.get("HERMES_HOME", ""),
    )
    response = await runner.handle_message(
        content=body.query,
        sender_name="eval",
        sender_id="eval-user",
        timestamp=time.time(),
        conversation_id="eval-session",
        message_id=f"eval-{int(time.time())}",
    )
    return PlainTextResponse(response or "")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
