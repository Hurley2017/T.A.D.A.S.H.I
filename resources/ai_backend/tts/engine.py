"""Kokoro ONNX Text-to-Speech Engine.

Provides high-quality, low-latency neural TTS synthesis entirely locally
using ONNX Runtime, generating 24kHz float32 audio arrays.
"""

import asyncio
import logging
import os
from typing import Optional, Tuple
import numpy as np
from config import TTSConfig

logger = logging.getLogger(__name__)


class KokoroTTSEngine:
    """Async wrapper around kokoro-onnx for fast local speech synthesis."""

    def __init__(self, config: Optional[TTSConfig] = None):
        self.config = config or TTSConfig()
        self.model = None
        self._is_loaded = False
        self._sample_rate = 24000

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def load(self) -> None:
        """Load Kokoro ONNX model and voice embeddings into memory."""
        if self._is_loaded:
            return

        model_path = self.config.model_path
        voices_path = self.config.voices_path

        if not os.path.exists(model_path) or not os.path.exists(voices_path):
            raise FileNotFoundError(
                f"Kokoro model files not found at '{model_path}' or '{voices_path}'. "
                f"Please run 'python download_models.py' to download the required Kokoro ONNX weights."
            )

        logger.info("Loading Kokoro ONNX TTS model from '%s'...", model_path)
        try:
            from kokoro_onnx import Kokoro

            self.model = Kokoro(model_path, voices_path)
            self._is_loaded = True
            logger.info("Kokoro ONNX TTS model loaded successfully (voice: %s).", self.config.voice)
        except Exception as e:
            logger.error("Failed to load Kokoro ONNX TTS: %s", e)
            raise

    def synthesize(self, text: str, voice: Optional[str] = None) -> np.ndarray:
        """Synthesize text to 24kHz float32 audio waveform.

        Args:
            text: Text string to speak.
            voice: Voice name (e.g. 'af_bella', 'af_sarah', 'am_adam').

        Returns:
            1D float32 numpy array with audio samples.
        """
        if not self._is_loaded or self.model is None:
            self.load()

        clean_text = text.strip()
        if not clean_text:
            return np.empty(0, dtype=np.float32)

        chosen_voice = voice or self.config.voice

        try:
            # kokoro.create returns (samples, sample_rate)
            samples, sample_rate = self.model.create(
                clean_text,
                voice=chosen_voice,
                speed=self.config.speed,
                lang="en-us",
            )
            self._sample_rate = sample_rate
            return samples.astype(np.float32)
        except Exception as e:
            logger.error("Kokoro synthesis error for text '%s': %s", text, e)
            return np.empty(0, dtype=np.float32)

    async def synthesize_async(self, text: str, voice: Optional[str] = None) -> np.ndarray:
        """Asynchronously synthesize speech by running ONNX model in thread executor."""
        return await asyncio.to_thread(self.synthesize, text, voice)
