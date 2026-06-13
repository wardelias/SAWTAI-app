# Voice gender detection — local test harness

Talk to your machine and watch the **production** `VoiceGenderDetector` decide
whether your voice is male or female, in real time. This isolates just the
detector — no STT, LLM, TTS, database, or telephony — so it's fast to run and
sidesteps the Windows long-path / deepgram import issue that blocks the normal
test suite.

```
browser mic --WebRTC--> transport.input() -> VoiceGenderDetector -> (result to browser)
```

The page shows the detected gender, the median pitch (F0), the confidence, how
much voiced speech was used, and — most usefully — whether the result crosses
the `NOTE_MIN_CONFIDENCE` threshold that decides if the live agent would
actually switch to gendered address forms (Arabic/Hebrew) or stay neutral.

## One-time setup (host Python venv)

From the repo root:

```powershell
python -m venv .venv-gender
.\.venv-gender\Scripts\python -m pip install -U pip
.\.venv-gender\Scripts\python -m pip install -e .\pipecat aiortc fastapi "uvicorn[standard]"
```

This installs only what the harness needs (pipecat core + aiortc for WebRTC +
FastAPI/uvicorn). It does **not** install deepgram, so the long-path blocker
does not apply.

> To also run the **F0-vs-ECAPA comparison harness** (`scripts/gender_compare/`),
> add the neural backend's dependencies to the same venv:
>
> ```powershell
> .\.venv-gender\Scripts\python -m pip install torch torchaudio huggingface_hub safetensors
> ```
>
> The first ECAPA decision downloads the model weights (~tens of MB), then caches them.

> If `aiortc` fails to build on Python 3.13, use a 3.12 interpreter for the
> venv (`py -3.12 -m venv .venv-gender`) — aiortc ships prebuilt wheels there.

## Run

```powershell
.\.venv-gender\Scripts\python scripts\gender_test\server.py
```

Then open <http://localhost:7860>, allow microphone access, click **Start
listening**, and talk normally for a few seconds.

## How to read the result

- **Median pitch (F0)** — male voices typically land ~85–155 Hz, female
  ~165–255 Hz. The 148–182 Hz band is deliberately treated as ambiguous.
- **Actionable (green banner)** — confidence ≥ threshold: the agent would
  address you with the matching gendered forms.
- **Neutral (yellow banner)** — below threshold or ambiguous: by design the
  agent keeps neutral address rather than risk misgendering.

The detector is **one-shot per connection**. Click **Test again** (drops the
peer connection and reconnects with a fresh detector) or reload the page to try
another voice. Try speaking in a deliberately higher or lower register to see
the F0 and verdict move, and to find where it flips to low-confidence/neutral.

## Notes

- Requires a working microphone and a Chromium/Firefox browser on `localhost`
  (getUserMedia needs a secure context; `localhost` counts as secure).
- Server logs print each decision (`Detector fired -> {...}`) so you can also
  watch results in the terminal.
