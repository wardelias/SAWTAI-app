# Voice gender detection — F0 vs ECAPA comparison harness

Talk to your machine and watch **both** production gender-classifier backends decide
on the **same** live mic audio, side by side:

- **F0** — the current pitch-based `F0GenderClassifier` (no model, telephony-robust).
- **ECAPA** — the neural `ECAPAGenderClassifier` wrapping
  [`JaesungHuh/voice-gender-classifier`](https://huggingface.co/JaesungHuh/voice-gender-classifier)
  (ECAPA-TDNN, finetuned on VoxCeleb2).

```
browser mic --WebRTC--> input -> [F0 detector] -> [ECAPA detector] -> (results to browser)
```

Both run the real production `VoiceGenderDetector`; each passes frames through
untouched and decides independently. The page shows each backend's verdict,
confidence, F0 (F0 backend only), voiced speech used, whether it crosses the
`NOTE_MIN_CONFIDENCE` threshold that drives gendered address — and an **agreement /
disagreement** banner. This is the empirical A/B for "is ECAPA better for us".

No STT, LLM, TTS, database, or telephony, so it's fast and sidesteps the Windows
long-path / deepgram import issue that blocks the normal test suite.

## Setup

Reuse the `.venv-gender` from [`scripts/gender_test/README.md`](../gender_test/README.md),
then add the neural backend's dependencies:

```powershell
.\.venv-gender\Scripts\python -m pip install torch torchaudio huggingface_hub safetensors
```

## Run

```powershell
.\.venv-gender\Scripts\python scripts\gender_compare\server.py
```

Then open <http://localhost:7861>, allow microphone access, click **Start
listening**, and talk normally for several seconds (ECAPA buffers ~3 s of voiced
speech before deciding).

> The **first** ECAPA decision downloads the model weights (~tens of MB) and may take
> a few seconds; after that it's cached in your Hugging Face cache.

## How to read it

- **Agree (green)** — both backends picked the same gender. The interesting cases are
  the **disagreements (red)**: note your actual voice, the F0 in Hz, and which backend
  matched reality. Try voices near the pitch overlap band (~150–185 Hz) and
  breathy/creaky registers — that's where F0 is weakest and ECAPA should help.
- **Confidence + threshold** — only a verdict at or above `NOTE_MIN_CONFIDENCE` would
  make the live agent actually switch to gendered (Arabic/Hebrew) address forms.

Each detector is **one-shot per connection**. Click **Test again** (fresh detectors)
or reload to try another voice. Server logs print every decision (`[f0] fired -> {…}`,
`[ecapa] fired -> {…}`).

## Notes

- ECAPA was trained on 16 kHz wideband audio; on 8 kHz telephony (upsampled) its
  real-world accuracy will be below its headline VoxCeleb figure. Test on audio that
  resembles your production calls before deciding to switch the backend.
- The **live** pipeline uses `ecapa` by default. Override globally with
  `VOICE_GENDER_DETECTION_BACKEND=f0` or per workflow via
  `voice_gender_detection.backend`. The model warm-loads at call setup, runs inference
  off the audio event loop, and degrades to a neutral/unknown result if it ever fails
  to load — so calls are never blocked.
