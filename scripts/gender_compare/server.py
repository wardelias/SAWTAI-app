"""Side-by-side WebRTC harness comparing both voice gender backends.

Runs the *real* production ``VoiceGenderDetector`` twice over the same live mic
audio — once with the pitch-based ``F0GenderClassifier`` and once with the neural
``ECAPAGenderClassifier`` (``JaesungHuh/voice-gender-classifier``). No STT, LLM,
TTS, database, or telephony, so it's fast and sidesteps the Windows long-path /
deepgram import blocker.

Pipeline::

    browser mic --WebRTC--> input -> [F0 detector] -> [ECAPA detector] -> output

Both detectors pass every frame through untouched, so each sees the full caller
audio and decides independently. As each fires its one-shot callback we relay the
estimate (tagged with its backend) to the browser, which shows the two verdicts
side by side plus an agreement indicator — the empirical A/B for "is ECAPA better".

Run::

    python scripts/gender_compare/server.py
    # then open http://localhost:7861

Each detector is one-shot per connection. Click "Test again" in the page (drops
the peer connection and reconnects with fresh detectors) or reload.
"""

import argparse
import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks, FastAPI
from fastapi.responses import FileResponse
from loguru import logger

# Make the repo root importable so we can load the production detector as-is.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api.services.gender.voice_gender_detector import (  # noqa: E402
    NOTE_MIN_CONFIDENCE,
    GenderEstimate,
    VoiceGenderDetector,
    make_gender_classifier,
)
from pipecat.pipeline.pipeline import Pipeline  # noqa: E402
from pipecat.pipeline.task import PipelineParams, PipelineTask  # noqa: E402
from pipecat.transports.base_transport import TransportParams  # noqa: E402
from pipecat.transports.smallwebrtc.connection import (  # noqa: E402
    IceServer,
    SmallWebRTCConnection,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport  # noqa: E402
from pipecat.workers.runner import WorkerRunner  # noqa: E402

# ECAPA resamples to 16 kHz internally; 16 kHz in also resolves F0 cleanly.
AUDIO_IN_SAMPLE_RATE = 16000

CLIENT_HTML = Path(__file__).parent / "client.html"

ice_servers = [IceServer(urls="stun:stun.l.google.com:19302")]
pcs_map: dict[str, SmallWebRTCConnection] = {}


def _make_relay(webrtc_connection: SmallWebRTCConnection, backend: str):
    """Build a one-shot callback that relays an estimate tagged with its backend."""

    async def on_gender_detected(estimate: GenderEstimate) -> None:
        actionable = (
            estimate.gender in ("male", "female")
            and estimate.confidence >= NOTE_MIN_CONFIDENCE
        )
        payload = {
            "type": "gender-result",
            "backend": backend,
            "gender": estimate.gender,
            "confidence": round(estimate.confidence, 2),
            "median_f0_hz": round(estimate.median_f0_hz, 1),
            "voiced_seconds": round(estimate.voiced_seconds, 1),
            "threshold": NOTE_MIN_CONFIDENCE,
            "actionable": actionable,
        }
        logger.info(f"[{backend}] fired -> {payload}")
        webrtc_connection.send_app_message(payload)

    return on_gender_detected


async def run_detectors(webrtc_connection: SmallWebRTCConnection) -> None:
    """Build and run a mic -> [F0, ECAPA] pipeline for one connection."""
    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=False,
            audio_in_sample_rate=AUDIO_IN_SAMPLE_RATE,
        ),
    )

    f0_detector = VoiceGenderDetector(
        on_gender_detected=_make_relay(webrtc_connection, "f0"),
        classifier=make_gender_classifier("f0"),
    )
    ecapa_detector = VoiceGenderDetector(
        on_gender_detected=_make_relay(webrtc_connection, "ecapa"),
        classifier=make_gender_classifier("ecapa"),
    )

    pipeline = Pipeline(
        [transport.input(), f0_detector, ecapa_detector, transport.output()]
    )
    task = PipelineTask(pipeline, params=PipelineParams(enable_metrics=False))

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):  # noqa: ANN001
        logger.info("Client connected — start talking; ~3s of voiced speech needed")
        webrtc_connection.send_app_message({"type": "status", "value": "listening"})

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):  # noqa: ANN001
        logger.info("Client disconnected")
        await task.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(task)
    await runner.run()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    coros = [pc.disconnect() for pc in pcs_map.values()]
    await asyncio.gather(*coros, return_exceptions=True)
    pcs_map.clear()


app = FastAPI(lifespan=lifespan)


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(CLIENT_HTML)


@app.post("/api/offer")
async def offer(request: dict, background_tasks: BackgroundTasks):
    pc_id = request.get("pc_id")

    if pc_id and pc_id in pcs_map:
        connection = pcs_map[pc_id]
        logger.info(f"Reusing connection {pc_id}")
        await connection.renegotiate(
            sdp=request["sdp"],
            type=request["type"],
            restart_pc=request.get("restart_pc", False),
        )
    else:
        connection = SmallWebRTCConnection(ice_servers)
        await connection.initialize(sdp=request["sdp"], type=request["type"])

        @connection.event_handler("closed")
        async def handle_closed(c: SmallWebRTCConnection):
            logger.info(f"Discarding connection {c.pc_id}")
            pcs_map.pop(c.pc_id, None)

        background_tasks.add_task(run_detectors, connection)

    answer = connection.get_answer()
    pcs_map[answer["pc_id"]] = connection
    return answer


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Voice gender backend comparison harness")
    parser.add_argument("--host", default="localhost", help="HTTP host")
    parser.add_argument("--port", type=int, default=7861, help="HTTP port")
    args = parser.parse_args()

    logger.info(f"Open http://{args.host}:{args.port} and allow microphone access")
    logger.info("First ECAPA decision downloads the model (~tens of MB); then it's cached.")
    uvicorn.run(app, host=args.host, port=args.port)
