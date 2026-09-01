"""Unified Local AI Service Server: SenseVoice STT + Kokoro Neural TTS.

Runs high-accuracy SenseVoice speech recognition and Kokoro ONNX neural speech synthesis
locally on CPU on port 8081, with zero cloud dependencies and zero GPU contention.
"""

import io
import json
import logging
import os
import sys
import wave
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import numpy as np

import sys

# Strict Drive D isolation
if getattr(sys, 'frozen', False):
    PROJECT_DIR = os.path.dirname(sys.executable)
else:
    PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
os.environ["PIP_CACHE_DIR"] = os.path.join(PROJECT_DIR, ".cache", "pip")

import sherpa_onnx
from tts.engine import KokoroTTSEngine
from config import TTSConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s [AI Service] %(message)s")
logger = logging.getLogger("ai_service")

# 1. Initialize SenseVoice STT
SENSE_DIR = os.path.join(PROJECT_DIR, "models", "stt", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
logger.info("Loading SenseVoice STT Model from %s ...", SENSE_DIR)
stt_recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=os.path.join(SENSE_DIR, "model.onnx"),
    tokens=os.path.join(SENSE_DIR, "tokens.txt"),
    language="en",
    use_itn=True,
    num_threads=4,
    debug=False,
)
logger.info("SenseVoice STT loaded successfully!")

# 2. Initialize Kokoro Neural TTS
KOKORO_MODEL = os.path.join(PROJECT_DIR, "models", "kokoro-v0_19.onnx")
KOKORO_VOICES = os.path.join(PROJECT_DIR, "models", "voices.bin")
tts_config = TTSConfig(model_path=KOKORO_MODEL, voices_path=KOKORO_VOICES, voice="af_bella")
tts_engine = KokoroTTSEngine(tts_config)
tts_engine.load()
logger.info("Kokoro Neural TTS loaded successfully!")


class AIServiceRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request handler for speech transcription and neural synthesis."""

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        if self.path == "/health":
            self._set_headers(200)
            self.wfile.write(
                json.dumps({
                    "status": "ok",
                    "stt": "SenseVoice (Sherpa-ONNX)",
                    "tts": "Kokoro Neural TTS",
                }).encode("utf-8")
            )
        else:
            self._set_headers(404)
            self.wfile.write(b"Not Found")

    def do_POST(self):
        if self.path == "/transcribe":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                audio_bytes = self.rfile.read(content_length)

                float_audio_16k = self._to_16k_float32(audio_bytes)
                if len(float_audio_16k) == 0:
                    self._set_headers(200)
                    self.wfile.write(json.dumps({"text": ""}).encode("utf-8"))
                    return

                stream = stt_recognizer.create_stream()
                stream.accept_waveform(16000, float_audio_16k)
                stt_recognizer.decode_stream(stream)
                text = stream.result.text.strip()

                # Filter out emotion/event tags if present e.g. <|nospeech|> or <|NEUTRAL|>
                clean_text = self._clean_sensevoice_output(text)

                logger.info("Transcribed text: '%s'", clean_text)
                self._set_headers(200)
                self.wfile.write(json.dumps({"text": clean_text}).encode("utf-8"))

            except Exception as e:
                logger.error("SenseVoice transcription error: %s", e, exc_info=True)
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

        elif self.path == "/synthesize":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = json.loads(self.rfile.read(content_length).decode("utf-8"))
                text = post_data.get("text", "").strip()
                voice = post_data.get("voice", "af_bella")

                if not text:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Empty text"}).encode("utf-8"))
                    return

                # Synthesize neural voice with Kokoro
                samples = tts_engine.synthesize(text, voice=voice)
                wav_bytes = self._encode_wav(samples, sample_rate=24000)

                self._set_headers(200, content_type="audio/wav")
                self.wfile.write(wav_bytes)

            except Exception as e:
                logger.error("Kokoro synthesis error: %s", e, exc_info=True)
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

        elif self.path == "/tool":
            try:
                import agent_tools
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = json.loads(self.rfile.read(content_length).decode("utf-8"))
                tool_name = post_data.get("tool", "")
                args = post_data.get("args", {})

                result = {"success": False, "error": f"Unknown tool: {tool_name}"}

                if tool_name == "search_web":
                    result = agent_tools.search_web(args.get("query", ""))
                elif tool_name == "open_browser":
                    result = agent_tools.open_browser(args.get("target", ""))
                elif tool_name == "launch_app":
                    result = agent_tools.launch_app(args.get("app_name", ""))
                elif tool_name == "inspect_workspace":
                    result = agent_tools.inspect_workspace(args.get("dir_path", None))
                elif tool_name == "read_project_file":
                    result = agent_tools.read_project_file(args.get("file_path", ""))
                elif tool_name == "system_telemetry":
                    result = agent_tools.get_system_telemetry()
                elif tool_name == "save_note":
                    result = agent_tools.save_note(args.get("title", "Note"), args.get("content", ""))
                elif tool_name == "list_notes":
                    result = agent_tools.list_notes()

                self._set_headers(200)
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except Exception as e:
                logger.error("Tool execution error: %s", e, exc_info=True)
                self._set_headers(500)
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))

        elif self.path == "/shutdown":
            self._set_headers(200)
            self.wfile.write(json.dumps({"status": "shutting down"}).encode("utf-8"))
            import threading
            threading.Thread(target=lambda: os._exit(0)).start()

        else:
            self._set_headers(404)
            self.wfile.write(b"Not Found")

    def _to_16k_float32(self, audio_bytes: bytes) -> np.ndarray:
        """Convert incoming audio (WAV / raw PCM) to 16kHz float32 mono array."""
        try:
            if audio_bytes.startswith(b"RIFF"):
                with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
                    n_channels = wf.getnchannels()
                    sampwidth = wf.getsampwidth()
                    framerate = wf.getframerate()
                    raw = wf.readframes(wf.getnframes())

                    if sampwidth == 2:
                        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                    elif sampwidth == 4:
                        data = np.frombuffer(raw, dtype=np.float32)
                    else:
                        data = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0

                    if n_channels > 1:
                        data = data.reshape(-1, n_channels)[:, 0]

                    if framerate != 16000 and len(data) > 0:
                        duration = len(data) / framerate
                        target_len = int(duration * 16000)
                        indices = np.linspace(0, len(data) - 1, target_len)
                        data = np.interp(indices, np.arange(len(data)), data).astype(np.float32)

                    return data
            else:
                return np.frombuffer(audio_bytes, dtype=np.float32)

        except Exception as e:
            logger.error("Audio parsing error: %s", e)
            return np.empty(0, dtype=np.float32)

    def _clean_sensevoice_output(self, text: str) -> str:
        """Remove emotion/event tags such as <|NEUTRAL|> or <|nospeech|> from output."""
        import re
        clean = re.sub(r"<\|.*?\|>", "", text)
        return clean.strip()

    def _encode_wav(self, samples: np.ndarray, sample_rate: int = 24000) -> bytes:
        """Encode float32 samples into WAV audio bytes."""
        int16_samples = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(int16_samples.tobytes())
        return buf.getvalue()

    def log_message(self, format, *args):
        return


def main():
    server_address = ("127.0.0.1", 8081)
    httpd = ThreadingHTTPServer(server_address, AIServiceRequestHandler)
    logger.info("AI Service (SenseVoice + Kokoro) running on http://127.0.0.1:8081")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down AI Service server...")
        httpd.server_close()


if __name__ == "__main__":
    main()
