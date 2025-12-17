import uuid
import logging
from typing import Optional, Dict  # 👈 Dict сюда

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request, Depends  # 👈 Depends сюда
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .schemas import AnalyzeRequest, AnalyzeResponse, TaskStatusResponse
from .models import Task
from .storage import storage
from .pipeline import run_pipeline_for_task

from common.audit_client import AuditClient
from common.jwt_auth import verify_jwt_token, JWTHandler


logging.basicConfig(
    level=logging.INFO,  # показывать INFO и выше
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("orchestrator")

app = FastAPI(title=settings.PROJECT_NAME)

# ---- CORS Configuration ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",  # Angular dev server
        "http://localhost",       # Docker frontend
        "http://127.0.0.1:4200",
        "https://crdlts.github.io",  # GitHub Pages
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Audit-клиент для этого сервиса ----

audit = AuditClient(service_name=settings.PROJECT_NAME)


# ---- Middleware для trace_id ----

@app.middleware("http")
async def trace_id_middleware(request: Request, call_next):
    """
    Генерируем/прокидываем X-Trace-Id,
    сохраняем его в request.state.trace_id и добавляем в headers ответа.
    """
    incoming_trace_id = request.headers.get("X-Trace-Id")
    trace_id = incoming_trace_id or str(uuid.uuid4())

    request.state.trace_id = trace_id

    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


# ---- Эндпоинты ----

@app.get("/health")
async def health(request: Request):
    trace_id: Optional[str] = getattr(request.state, "trace_id", None)

    await audit.log(
        level="INFO",
        message="Health check",
        trace_id=trace_id,
        context={"path": str(request.url.path)},
    )

    return {"status": "ok", "service": settings.PROJECT_NAME}


@app.post("/api/token")
async def get_token():
    """Получить JWT токен для авторизации"""
    token = JWTHandler.create_token({"sub": "api-client"})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_endpoint(
    request: Request,
    body: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    token: Dict = Depends(verify_jwt_token),
):
    trace_id: Optional[str] = getattr(request.state, "trace_id", None)
    report_id = str(uuid.uuid4())

    logger.info(
        "Received analyze request report_id=%s trace_id=%s",
        report_id,
        trace_id,
    )

    await audit.log(
        level="INFO",
        message="Analyze request received",
        trace_id=trace_id,
        report_id=report_id,
        context={
            "tool": body.tool,
            "payload_size": len(body.report)
            if hasattr(body.report, "__len__")
            else None,
            "path": str(request.url.path),
            "method": request.method,
        },
    )

    task = Task(
        id=report_id,
        status="pending",
        source=body.tool,
        metadata={"trace_id": trace_id} if trace_id else None,
        request_payload=body.report,
    )

    storage.save(task)

    await audit.log(
        level="INFO",
        message="Task created and stored",
        trace_id=trace_id,
        report_id=report_id,
        context={"status": task.status},
    )

    # Запускаем пайплайн в фоне
    background_tasks.add_task(run_pipeline_for_task, task)

    await audit.log(
        level="INFO",
        message="Pipeline scheduled in background",
        trace_id=trace_id,
        report_id=report_id,
        context={},
    )

    return AnalyzeResponse(report_id=report_id, status=task.status)


@app.get("/api/reports/{report_id}", response_model=TaskStatusResponse)
async def get_report(report_id: str, request: Request, token: Dict = Depends(verify_jwt_token)):
    trace_id: Optional[str] = getattr(request.state, "trace_id", None)

    logger.info(
        "Get report status report_id=%s trace_id=%s",
        report_id,
        trace_id,
    )

    task = storage.get(report_id)
    if not task:
        await audit.log(
            level="WARNING",
            message="Report not found",
            trace_id=trace_id,
            report_id=report_id,
            context={"path": str(request.url.path)},
        )
        raise HTTPException(status_code=404, detail="Report not found")

    findings = None
    stats = None

    if isinstance(task.result, dict):
        findings = task.result.get("findings")
        stats = task.result.get("stats")

    await audit.log(
        level="INFO",
        message="Report status retrieved",
        trace_id=trace_id
        or (task.metadata or {}).get("trace_id")
        if task.metadata
        else None,
        report_id=task.id,
        context={
            "status": task.status,
            "has_findings": findings is not None,
            "has_stats": stats is not None,
            "has_error": task.error is not None,
        },
    )

    return TaskStatusResponse(
        report_id=task.id,
        status=task.status,
        findings=findings,
        stats=stats,
        error=task.error,
    )
