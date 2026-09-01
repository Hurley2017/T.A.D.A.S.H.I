"""Asynchronous Audio Player with Instant Barge-In Interruption Support.

Handles non-blocking chunked audio playback via sounddevice and provides
millisecond-latency cancellation when speech barge-in is triggered.
"""

import asyncio
import logging
from typing import Optional
import numpy as np
import sounddevice as sd

logger = logging.getLogger(__name__)


class AsyncAudioPlayer:
    """Non-blocking audio output player supporting streaming and instant barge-in kill."""

    def __init__(
        self,
        sample_rate: int = 24000,
        channels: int = 1,
        device: Optional[int] = None,
    ):
        """Initialize the audio player.

        Args:
            sample_rate: Output sample rate in Hz (default 24000 Hz for Kokoro TTS).
            channels: Number of output channels (1 = Mono).
            device: Output device index (None for system default).
        """
        self.sample_rate = sample_rate
        self.channels = channels
        self.device = device

        self._queue: asyncio.Queue[Optional[np.ndarray]] = asyncio.Queue()
        self._playback_task: Optional[asyncio.Task] = None
        self._is_playing = False
        self._interrupt_event = asyncio.Event()
        self._stream: Optional[sd.OutputStream] = None

    @property
    def is_playing(self) -> bool:
        """Check if audio is currently being played."""
        return self._is_playing

    async def play_chunk(self, audio_data: np.ndarray) -> None:
        """Enqueue an audio chunk (float32 numpy array) for playback.

        Args:
            audio_data: 1D or 2D float32 numpy array containing audio samples.
        """
        if self._interrupt_event.is_set():
            logger.debug("Discarding chunk because playback was interrupted")
            return

        # Ensure correct float32 shape
        if audio_data.dtype != np.float32:
            audio_data = audio_data.astype(np.float32)

        await self._queue.put(audio_data)

    async def finish_stream(self) -> None:
        """Signal end of stream by enqueuing a sentinel None."""
        if not self._interrupt_event.is_set():
            await self._queue.put(None)

    def start_playback_loop(self) -> None:
        """Start the background playback worker task."""
        self._interrupt_event.clear()
        self._is_playing = True
        self._playback_task = asyncio.create_task(self._worker())

    async def wait_until_done(self) -> None:
        """Wait until all queued audio has finished playing or playback is interrupted."""
        if self._playback_task is not None:
            try:
                await self._playback_task
            except asyncio.CancelledError:
                pass

    # =========================================================================
    # BARGE-IN INTERRUPTION MECHANISM
    # =========================================================================
    def interrupt(self) -> None:
        """Instant Barge-In Stop.

        Instantly halts active audio playback on hardware level and clears all
        pending audio chunks from memory:
        1. Sets the `_interrupt_event` flag to block any new incoming audio.
        2. Drains and empties the `_queue` immediately.
        3. Aborts the active `sounddevice.OutputStream` via `sd.stop()`/`stream.abort()`.
        4. Cancels the background playback task without blocking the event loop.
        """
        logger.info("[BARGE-IN] Interrupted! Aborting audio playback immediately.")
        self._interrupt_event.set()
        self._is_playing = False

        # Drain pending queue
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
                self._queue.task_done()
            except (asyncio.QueueEmpty, ValueError):
                break

        # Abort sounddevice hardware stream immediately
        if self._stream is not None:
            try:
                self._stream.abort(ignore_errors=True)
                self._stream.close(ignore_errors=True)
            except Exception as e:
                logger.debug("Error aborting sounddevice output stream: %s", e)
            finally:
                self._stream = None

        # Cancel the playback worker task
        if self._playback_task is not None and not self._playback_task.done():
            self._playback_task.cancel()

    async def _worker(self) -> None:
        """Background worker that continuously pulls audio chunks and writes to stream."""
        try:
            self._stream = sd.OutputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="float32",
                device=self.device,
            )
            self._stream.start()

            while not self._interrupt_event.is_set():
                chunk = await self._queue.get()

                # None is the end-of-stream sentinel
                if chunk is None:
                    self._queue.task_done()
                    break

                if len(chunk) > 0 and not self._interrupt_event.is_set():
                    # Write to sounddevice in an async thread pool to keep event loop free
                    await asyncio.to_thread(self._stream.write, chunk)

                self._queue.task_done()

        except asyncio.CancelledError:
            logger.debug("Audio playback task was cancelled.")
        except Exception as e:
            logger.error("Audio playback error: %s", e, exc_info=True)
        finally:
            self._is_playing = False
            if self._stream is not None:
                try:
                    self._stream.stop()
                    self._stream.close()
                except Exception:
                    pass
                finally:
                    self._stream = None
