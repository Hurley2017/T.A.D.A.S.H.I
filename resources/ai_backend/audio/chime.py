"""Synthetic audio feedback tones (wake acknowledgment beep, chimes).

Generates pure numpy sine tones with smooth Hann envelope fading to prevent
audio clicks and pops, eliminating the need for external asset files.
"""

import numpy as np
import sounddevice as sd
from typing import Optional


def generate_tone(
    frequency_hz: float = 880.0,
    duration_s: float = 0.15,
    sample_rate: int = 24000,
    volume: float = 0.3,
) -> np.ndarray:
    """Generate a pure sine tone with smooth attack and decay envelope.

    Args:
        frequency_hz: Frequency of the sine wave in Hertz.
        duration_s: Duration of the tone in seconds.
        sample_rate: Output audio sample rate in Hz.
        volume: Peak amplitude scalar (0.0 to 1.0).

    Returns:
        1D float32 numpy array normalized to [-1.0, 1.0].
    """
    total_samples = int(sample_rate * duration_s)
    if total_samples <= 0:
        return np.empty(0, dtype=np.float32)

    # Generate time base
    t = np.linspace(0, duration_s, total_samples, endpoint=False, dtype=np.float32)
    # Sine wave
    waveform = np.sin(2 * np.pi * frequency_hz * t, dtype=np.float32)

    # Apply Hann window envelope for soft click-free attack and release
    window = np.hanning(total_samples).astype(np.float32)
    tone = waveform * window * volume

    return tone.astype(np.float32)


def generate_double_beep(
    freq1: float = 660.0,
    freq2: float = 880.0,
    duration_each: float = 0.08,
    silence_between: float = 0.04,
    sample_rate: int = 24000,
    volume: float = 0.25,
) -> np.ndarray:
    """Generate a high-tech two-tone activation chime (e.g. E5 -> A5)."""
    tone1 = generate_tone(freq1, duration_each, sample_rate, volume)
    gap = np.zeros(int(sample_rate * silence_between), dtype=np.float32)
    tone2 = generate_tone(freq2, duration_each, sample_rate, volume)
    return np.concatenate([tone1, gap, tone2]).astype(np.float32)


def play_tone(
    frequency_hz: float = 880.0,
    duration_s: float = 0.15,
    sample_rate: int = 24000,
    volume: float = 0.3,
    device: Optional[int] = None,
) -> None:
    """Synchronously play a synthetic tone on the selected audio device."""
    audio = generate_tone(frequency_hz, duration_s, sample_rate, volume)
    sd.play(audio, samplerate=sample_rate, device=device, blocking=False)
