"""Faster-Whisper Speech-to-Text Engine.

Provides high-performance, GPU-accelerated transcription of speech chunks
with async execution to prevent blocking the asyncio event loop.
"""

import asyncio
import logging
from typing import Optional
import numpy as np
from config import STTConfig

logger = logging.getLogger(__name__)


class FasterWhisperSTT:
    """Async wrapper around faster-whisper WhisperModel."""

    def __init__(self, config: Optional[STTConfig] = None):
        self.config = config or STTConfig()
        self.model = None
        self._is_loaded = False

    def load(self) -> None:
        """Load the Faster-Whisper model onto GPU or CPU."""
        if self._is_loaded:
            return

        logger.info(
            "Loading Faster-Whisper model '%s' (device: %s, compute_type: %s)...",
            self.config.model_size,
            self.config.device,
            self.config.compute_type,
        )

        try:
            from faster_whisper import WhisperModel

            self.model = WhisperModel(
                self.config.model_size,
                device=self.config.device,
                compute_type=self.config.compute_type,
            )
            self._is_loaded = True
            logger.info("Faster-Whisper model loaded successfully on %s.", self.config.device)
        except Exception as e:
            if self.config.device == "cuda":
                logger.warning(
                    "Failed to load Faster-Whisper on CUDA (%s). Falling back to CPU with int8 compute.",
                    e,
                )
                from faster_whisper import WhisperModel

                self.model = WhisperModel(
                    self.config.model_size,
                    device="cpu",
                    compute_type="int8",
                )
                self._is_loaded = True
                logger.info("Faster-Whisper loaded successfully on CPU fallback.")
            else:
                logger.error("Failed to load Faster-Whisper model: %s", e)
                raise

    def transcribe(self, audio_array: np.ndarray) -> str:
        """Transcribe a 1D float32 audio array sampled at 16kHz.

        Args:
            audio_array: 1D float32 numpy array with audio samples in [-1.0, 1.0].

        Returns:
            str: Transcribed text string.
        """
        if not self._is_loaded or self.model is None:
            self.load()

        if len(audio_array) == 0:
            return ""

        # Normalize float32 audio to [-1.0, 1.0] if necessary
        if audio_array.dtype != np.float32:
            audio_array = audio_array.astype(np.float32)

        # Transcribe with greedy decoding for minimum latency
        segments, _ = self.model.transcribe(
            audio_array,
            beam_size=self.config.beam_size,
            language=self.config.language,
            task="transcribe",
            condition_on_previous_text=False,
            vad_filter=False,  # Audio has already been cleanly segmented by Silero VAD
        )

        transcription = " ".join([segment.text.strip() for segment in segments]).strip()
        return transcription

    async def transcribe_async(self, audio_array: np.ndarray) -> str:
        """Asynchronously transcribe audio by offloading computation to a worker thread."""
        return await asyncio.to_thread(self.transcribe, audio_array)
