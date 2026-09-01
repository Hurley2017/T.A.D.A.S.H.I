"""Silero VAD (Voice Activity Detection) Wrapper and Speech Segmenter.

Provides sub-millisecond speech probability scoring and stateful utterance
segmentation with pre-speech padding and silence thresholding.
"""

import asyncio
from collections import deque
import logging
from typing import Optional, Tuple
import numpy as np
from config import VADConfig

logger = logging.getLogger(__name__)


class SileroVAD:
    """Lightweight wrapper around Silero VAD model for frame-by-frame speech detection."""

    def __init__(self, config: Optional[VADConfig] = None):
        self.config = config or VADConfig()
        self.model = None
        self._is_loaded = False
        self._threshold = self.config.threshold

    def load(self) -> None:
        """Load Silero VAD model via silero_vad package or torch.hub fallback."""
        if self._is_loaded:
            return

        logger.info("Loading Silero VAD model...")
        try:
            # First try official silero_vad package
            from silero_vad import load_silero_vad
            self.model = load_silero_vad(onnx=True)
            self._is_loaded = True
            logger.info("Silero VAD (ONNX) loaded successfully.")
        except Exception as e1:
            logger.debug("Falling back to torch.hub for Silero VAD: %s", e1)
            try:
                self.model, _ = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                    onnx=True,
                )
                self._is_loaded = True
                logger.info("Silero VAD (torch.hub) loaded successfully.")
            except Exception as e2:
                logger.error("Failed to load Silero VAD: %s", e2)
                raise

    def get_speech_probability(self, audio_chunk: np.ndarray, sample_rate: int = 16000) -> float:
        """Calculate speech probability for a 512-sample (32ms) 16kHz audio frame.

        Args:
            audio_chunk: 1D float32 numpy array with 512 samples.
            sample_rate: Sample rate in Hz (default 16000).

        Returns:
            float: Speech probability between 0.0 and 1.0.
        """
        if not self._is_loaded:
            self.load()

        if len(audio_chunk) != 512:
            raise ValueError(f"Silero VAD requires exactly 512 samples at 16kHz, received {len(audio_chunk)}")

        import torch

        # Convert numpy array to torch tensor
        tensor = torch.from_numpy(audio_chunk).float()
        if tensor.ndim == 1:
            tensor = tensor.unsqueeze(0)  # Shape (1, 512)

        with torch.no_grad():
            prob = self.model(tensor, sample_rate).item()

        return float(prob)

    def is_speech(self, audio_chunk: np.ndarray, threshold: Optional[float] = None) -> bool:
        """Check if an audio chunk exceeds the speech probability threshold."""
        thresh = threshold if threshold is not None else self._threshold
        return self.get_speech_probability(audio_chunk) >= thresh

    def reset_states(self) -> None:
        """Reset internal model state if available."""
        if hasattr(self.model, "reset_states"):
            self.model.reset_states()


class SpeechSegmenter:
    """Stateful speech collector.

    Listens to incoming 512-sample chunks, maintains a pre-speech ring buffer
    so the beginning of speech is never truncated, collects user voice, and
    triggers completion when a sustained silence period (e.g. 1.5s) is reached.
    """

    def __init__(self, vad: SileroVAD, config: Optional[VADConfig] = None):
        self.vad = vad
        self.config = config or VADConfig()

        # Frame duration at 16kHz with 512 samples is 32ms
        self.frame_duration_ms = (512 / 16000.0) * 1000.0  # 32.0 ms

        # Number of frames for pre-speech buffer padding
        self.pre_speech_frames = max(1, int(self.config.pre_speech_pad_ms / self.frame_duration_ms))
        # Number of silence frames required to trigger end of speech
        self.silence_frames_threshold = int(self.config.silence_timeout_ms / self.frame_duration_ms)
        # Minimum speech frames to accept as legitimate speech (not a brief click)
        self.min_speech_frames = int(self.config.min_speech_duration_ms / self.frame_duration_ms)

        self.pre_buffer = deque(maxlen=self.pre_speech_frames)
        self.recorded_frames = []
        self.speaking = False
        self.silence_counter = 0
        self.speech_frames_count = 0

    def reset(self) -> None:
        """Reset the speech segmenter for a new listening session."""
        self.pre_buffer.clear()
        self.recorded_frames = []
        self.speaking = False
        self.silence_counter = 0
        self.speech_frames_count = 0
        self.vad.reset_states()

    def process_frame(self, frame: np.ndarray) -> Tuple[bool, Optional[np.ndarray]]:
        """Process a single 512-sample frame from the microphone.

        Args:
            frame: 1D float32 numpy array with 512 samples.

        Returns:
            Tuple[is_complete, audio_array]:
                is_complete (bool): True if user finished speaking.
                audio_array (np.ndarray or None): The full continuous utterance
                    if complete, or None if still listening.
        """
        prob = self.vad.get_speech_probability(frame)
        is_speech_frame = prob >= self.config.threshold

        if not self.speaking:
            # We are waiting for the user to start speaking
            self.pre_buffer.append(frame)
            if is_speech_frame:
                self.speech_frames_count += 1
                if self.speech_frames_count >= 2:  # Confirmed onset of speech (2 frames = 64ms)
                    self.speaking = True
                    self.silence_counter = 0
                    # Flush pre-speech buffer into recorded frames
                    self.recorded_frames.extend(list(self.pre_buffer))
                    self.pre_buffer.clear()
            else:
                self.speech_frames_count = 0
            return False, None
        else:
            # We are in active speech recording mode
            self.recorded_frames.append(frame)

            if is_speech_frame:
                self.silence_counter = 0
                self.speech_frames_count += 1
            else:
                self.silence_counter += 1

                # Check if silence timeout reached
                if self.silence_counter >= self.silence_frames_threshold:
                    # User has stopped speaking
                    if self.speech_frames_count >= self.min_speech_frames:
                        # Valid utterance collected
                        full_audio = np.concatenate(self.recorded_frames)
                        self.reset()
                        return True, full_audio
                    else:
                        # Noise was too brief (e.g. keyboard click), discard and reset
                        logger.debug("Discarded brief noise event (%d frames)", self.speech_frames_count)
                        self.reset()
                        return False, None

            return False, None
