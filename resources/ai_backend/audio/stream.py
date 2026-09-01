"""Asynchronous Audio Input Stream using SoundDevice.

Captures mono microphone audio at 16 kHz and yields uniform sample frames
asynchronous-friendly via asyncio.Queue without blocking the event loop.
"""

import asyncio
import logging
from typing import Optional
import numpy as np
import sounddevice as sd

logger = logging.getLogger(__name__)


class AsyncAudioInputStream:
    """Non-blocking audio capture stream feeding async queues."""

    def __init__(
        self,
        sample_rate: int = 16000,
        channels: int = 1,
        dtype: str = "float32",
        device: Optional[int] = None,
        block_size: int = 512,
    ):
        """Initialize the audio input stream.

        Args:
            sample_rate: Input sample rate in Hz (16000 standard for VAD/STT).
            channels: Number of audio channels (1 = Mono).
            dtype: Data type ('float32' for Silero/Whisper, range -1.0 to 1.0).
            device: SoundDevice device index (None for system default).
            block_size: Hardware buffer block size in samples.
        """
        self.sample_rate = sample_rate
        self.channels = channels
        self.dtype = dtype
        self.device = device
        self.block_size = block_size

        self._stream: Optional[sd.InputStream] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._queue: asyncio.Queue[np.ndarray] = asyncio.Queue()
        self._is_running = False
        self._internal_buffer = np.empty((0,), dtype=np.float32)

    def _audio_callback(
        self, indata: np.ndarray, frames: int, time_info: dict, status: sd.CallbackFlags
    ) -> None:
        """SoundDevice OS-level audio callback (runs in a dedicated audio thread)."""
        if status:
            logger.warning("Audio input stream status warning: %s", status)

        if not self._is_running or self._loop is None:
            return

        # Flatten mono channel to 1D float32 array
        audio_chunk = indata[:, 0].copy().astype(np.float32)

        # Safely push audio frame into the asyncio queue from the audio thread
        self._loop.call_soon_threadsafe(self._queue.put_nowait, audio_chunk)

    def start(self) -> None:
        """Open and start the microphone capture stream."""
        if self._is_running:
            return

        self._loop = asyncio.get_running_loop()
        # Clear out any leftover data in the queue
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        self._internal_buffer = np.empty((0,), dtype=np.float32)
        self._is_running = True

        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype=self.dtype,
            device=self.device,
            blocksize=self.block_size,
            callback=self._audio_callback,
        )
        self._stream.start()
        logger.info("Microphone audio capture started at %d Hz", self.sample_rate)

    def stop(self) -> None:
        """Stop and close the microphone input stream."""
        self._is_running = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as e:
                logger.debug("Error closing input stream: %s", e)
            finally:
                self._stream = None
        self._internal_buffer = np.empty((0,), dtype=np.float32)
        logger.info("Microphone audio capture stopped")

    async def read_chunk(self, chunk_size: int = 512) -> np.ndarray:
        """Read an exact number of audio samples asynchronously.

        Accumulates audio frames from the stream callback until the requested
        chunk_size is fulfilled.

        Args:
            chunk_size: Number of samples to read (e.g. 512 for VAD, 1280 for WakeWord).

        Returns:
            1D float32 numpy array with exactly chunk_size samples.
        """
        while len(self._internal_buffer) < chunk_size:
            # Wait for next raw buffer from hardware callback
            frame = await self._queue.get()
            self._internal_buffer = np.concatenate((self._internal_buffer, frame))

        # Extract exactly chunk_size samples
        chunk = self._internal_buffer[:chunk_size]
        self._internal_buffer = self._internal_buffer[chunk_size:]
        return chunk

    def clear(self) -> None:
        """Clear all buffered unread audio samples."""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._internal_buffer = np.empty((0,), dtype=np.float32)

    @property
    def is_running(self) -> bool:
        return self._is_running
