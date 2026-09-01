"""OpenWakeWord detection engine.

Continuously scores incoming 16kHz audio chunks against pre-trained wake word
models (e.g. 'hey_jarvis', 'alexa') with minimal CPU/GPU overhead.
"""

import asyncio
import logging
from typing import Optional, List
import numpy as np
from config import WakeWordConfig

logger = logging.getLogger(__name__)


class WakeWordDetector:
    """Wrapper around openWakeWord Model for real-time keyword spotting."""

    def __init__(self, config: Optional[WakeWordConfig] = None):
        """Initialize OpenWakeWord model.

        Args:
            config: WakeWordConfig instance.
        """
        self.config = config or WakeWordConfig()
        self.model = None
        self._model_name = self.config.model_name
        self._threshold = self.config.threshold
        self._is_loaded = False

    def load(self) -> None:
        """Load OpenWakeWord models into memory."""
        if self._is_loaded:
            return

        logger.info("Loading OpenWakeWord model: '%s'...", self._model_name)
        try:
            from openwakeword.model import Model
            
            # Load with ONNX runtime backend
            self.model = Model(
                wakeword_models=[self._model_name],
                inference_framework="onnx",
            )
            self._is_loaded = True
            logger.info("OpenWakeWord model '%s' loaded successfully.", self._model_name)
        except Exception as e:
            logger.error("Failed to load openWakeWord model '%s': %s", self._model_name, e)
            raise

    def reset(self) -> None:
        """Reset internal prediction buffers and states."""
        if self.model is not None:
            self.model.reset()

    def score_chunk(self, audio_chunk: np.ndarray) -> Tuple[bool, float]:
        """Process an audio chunk and return both detection status and confidence score.

        Args:
            audio_chunk: 1D numpy array of 16kHz audio.

        Returns:
            Tuple[bool, float]: (is_detected, confidence_score)
        """
        if not self._is_loaded or self.model is None:
            self.load()

        if audio_chunk.dtype == np.float32 or audio_chunk.dtype == np.float64:
            audio_int16 = (np.clip(audio_chunk, -1.0, 1.0) * 32767).astype(np.int16)
        else:
            audio_int16 = audio_chunk.astype(np.int16)

        self.model.predict(audio_int16)

        max_score = 0.0
        for name, scores in self.model.prediction_buffer.items():
            if self._model_name.lower() in name.lower() or name.lower() in self._model_name.lower():
                score = float(scores[-1]) if len(scores) > 0 else 0.0
                if score > max_score:
                    max_score = score

        if max_score >= self._threshold:
            logger.info("Wake word detected! Score: %.3f (Threshold: %.2f)", max_score, self._threshold)
            self.reset()
            return True, max_score

        return False, max_score

    def process_chunk(self, audio_chunk: np.ndarray) -> bool:
        """Process chunk and return bool detection result."""
        detected, _ = self.score_chunk(audio_chunk)
        return detected

    async def score_chunk_async(self, audio_chunk: np.ndarray) -> Tuple[bool, float]:
        """Score chunk asynchronously without blocking the event loop."""
        return await asyncio.to_thread(self.score_chunk, audio_chunk)

    async def process_chunk_async(self, audio_chunk: np.ndarray) -> bool:
        """Process chunk asynchronously without blocking the event loop."""
        return await asyncio.to_thread(self.process_chunk, audio_chunk)
