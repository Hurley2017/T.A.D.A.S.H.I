"""Configuration module for the Local Voice Assistant.

Centralizes all audio parameters, model thresholds, device configurations,
and API settings with sensible defaults for local GPU/CPU execution.
"""

import os
import sys

import sys

# Force all caches strictly to Drive D project root
if getattr(sys, 'frozen', False):
    PROJECT_DIR = os.path.dirname(sys.executable)
else:
    PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
os.environ["HF_HOME"] = os.path.join(PROJECT_DIR, ".cache", "huggingface")
os.environ["TORCH_HOME"] = os.path.join(PROJECT_DIR, ".cache", "torch")
os.environ["MODELS_DIR"] = os.path.join(PROJECT_DIR, "models")
os.environ["PIP_CACHE_DIR"] = os.path.join(PROJECT_DIR, ".cache", "pip")
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AudioConfig:
    """Audio I/O device and sample rate settings."""
    # Standard 16 kHz sample rate required by Silero VAD, Faster-Whisper, and OpenWakeWord
    input_sample_rate: int = 16000
    # Kokoro ONNX default output sample rate
    output_sample_rate: int = 24000
    input_channels: int = 1
    output_channels: int = 1
    # Frame sizes: 512 samples = 32ms at 16kHz (Silero VAD window size)
    vad_frame_size: int = 512
    # OpenWakeWord chunk size: 1280 samples = 80ms at 16kHz
    wake_word_frame_size: int = 1280
    # Device indices (None = OS default audio input/output)
    input_device_index: Optional[int] = None
    output_device_index: Optional[int] = None


@dataclass
class WakeWordConfig:
    """OpenWakeWord detection parameters."""
    # Built-in openwakeword models: 'hey_jarvis', 'alexa', 'timer', 'weather', etc.
    model_name: str = "hey_jarvis"
    # Activation confidence threshold (0.0 to 1.0)
    threshold: float = 0.35
    # Beep confirmation audio frequency and duration
    ack_beep_freq: float = 880.0  # A5 note
    ack_beep_duration: float = 0.15  # seconds


@dataclass
class VADConfig:
    """Silero VAD speech activity detection parameters."""
    # Probability threshold to consider audio as human speech (0.0 to 1.0)
    # Set to 0.6 to reject mechanical keyboard clicks and background noise
    threshold: float = 0.6
    # Silence period (in milliseconds) before deciding the user stopped speaking
    silence_timeout_ms: int = 1500
    # Padding duration (in milliseconds) to retain audio prior to detected speech onset
    pre_speech_pad_ms: int = 300
    # Minimum human speech duration (in milliseconds) to filter out transient pops/clicks
    min_speech_duration_ms: int = 250
    # Minimum consecutive speech frames required to trigger barge-in during TTS playback
    # 2 frames * 32ms = 64ms of speech
    barge_in_consecutive_frames: int = 2


@dataclass
class STTConfig:
    """Faster-Whisper speech-to-text configuration."""
    # Whisper model: 'tiny.en', 'base.en', 'small.en', 'medium.en'
    model_size: str = "base.en"
    # Device: 'cuda' (dedicated GPU) or 'cpu'
    device: str = "cuda"
    # Compute type: 'float16' on GPU, 'int8' or 'int8_float16' on CPU
    compute_type: str = "float16"
    language: str = "en"
    beam_size: int = 1  # Greedy search for lowest latency


@dataclass
class LLMConfig:
    """OpenAI API client configuration for local server (llama.cpp / Ollama)."""
    # Local endpoint (llama.cpp server or Ollama's OpenAI-compatible API)
    base_url: str = os.getenv("LLM_BASE_URL", "http://localhost:8080/v1")
    api_key: str = os.getenv("LLM_API_KEY", "local-no-key-required")
    # Model name matching your loaded GGUF / Ollama model tag
    model: str = os.getenv("LLM_MODEL", "llama-3.2-3b-instruct")
    temperature: float = 0.7
    max_tokens: int = 512
    system_prompt: str = (
        "You are a helpful, fast, and concise voice-activated AI assistant. "
        "Your responses will be spoken aloud via text-to-speech, so keep answers brief, natural, "
        "and conversational. Avoid markdown formatting, long lists, bullet points, or ASCII art unless necessary. "
        "If you need current or real-time information to answer the user's question, use the web_search tool."
    )


@dataclass
class TTSConfig:
    """Kokoro ONNX text-to-speech settings."""
    model_path: str = "models/kokoro-v0_19.onnx"
    voices_path: str = "models/voices.bin"
    # Available voices: 'af_bella', 'af_sarah', 'af_nicole', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', etc.
    voice: str = "af_bella"
    speed: float = 1.0
    # Split incoming LLM stream into sentences to start audio playback immediately
    sentence_delimiters: str = r"(?<=[.!?\n])\s+"


@dataclass
class AssistantConfig:
    """Root configuration object uniting all sub-system configs."""
    audio: AudioConfig = field(default_factory=AudioConfig)
    wake_word: WakeWordConfig = field(default_factory=WakeWordConfig)
    vad: VADConfig = field(default_factory=VADConfig)
    stt: STTConfig = field(default_factory=STTConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    tts: TTSConfig = field(default_factory=TTSConfig)


# Default global instance
config = AssistantConfig()
