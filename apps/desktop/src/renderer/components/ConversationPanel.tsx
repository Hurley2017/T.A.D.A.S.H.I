import { useRef, useState, type FormEvent } from 'react';
import { WaveVisualizer } from './WaveVisualizer';
import type { ConversationMessage } from '@contracts/index';

type Props = {
  messages: ConversationMessage[];
  disabled: boolean;
  assessing?: boolean;
  onSubmit: (content: string) => Promise<void>;
  onVoiceError: (message: string) => void;
};

export function ConversationPanel({ messages, disabled, assessing = false, onSubmit, onVoiceError }: Props) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | undefined>(undefined);
  const audioChunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const isHolding = useRef(false);

  async function startListening() {
    if (isHolding.current || !navigator.mediaDevices?.getUserMedia) {
      if (!navigator.mediaDevices?.getUserMedia) onVoiceError('Microphone access is unavailable in this desktop session.');
      return;
    }
    isHolding.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The user may have released while the mic was being opened — cancel instead of starting late.
      if (!isHolding.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      audioChunks.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => audioChunks.current.push(event.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = undefined;
        setIsListening(false);
        try {
          const blob = new Blob(audioChunks.current, { type: recorder.mimeType });
          const wav = await blobToWav(blob);
          const transcript = await window.tadashi.transcribeAudio(wav, 'audio/wav');
          setContent((current) => current ? `${current} ${transcript}`.trim() : transcript);
        } catch (error) {
          onVoiceError(error instanceof Error ? error.message : 'Voice transcription could not start.');
        }
      };
      recorder.start();
      setIsListening(true);
    } catch (error) {
      isHolding.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      onVoiceError(error instanceof Error ? error.message : 'Microphone permission was not granted.');
    }
  }

  function stopListening() {
    if (!isHolding.current) return;
    isHolding.current = false;
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    else setIsListening(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = content.trim();
    if (!value || disabled || isSending) return;
    setIsSending(true);
    try {
      await onSubmit(value);
      setContent('');
    } finally {
      setIsSending(false);
    }
  }

  async function toggleVoice() {
    if (isListening) stopListening();
    else await startListening();
  }

  // Derive wave state
  let waveState: 'idle' | 'listening' | 'thinking' | 'speaking' = 'idle';
  if (isListening) waveState = 'listening';
  else if (isSending || assessing) waveState = 'thinking';
  else if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') waveState = 'speaking'; // Approximate speaking for now

  return (
    <section className="conversation-panel" aria-labelledby="conversation-heading">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">Conversation</div>
          <h2 id="conversation-heading">Tell me what to move forward.</h2>
        </div>
        <span className="live-indicator"><span aria-hidden="true" /> {assessing ? 'Assessing request' : 'Ready for intent'}</span>
      </div>
      
      {/* Aurora Wave Visualizer injected at the top */}
      <div style={{ marginBottom: '16px' }}>
        <WaveVisualizer state={waveState} />
      </div>

      <div className="conversation-log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="conversation-empty">
            <div className="signal-orbit" aria-hidden="true"><span /><span /><span /></div>
            <p>Your project is quiet.</p>
            <small>Ask me to inspect, change, test, or explain something. I will turn it into a task before any agent runs.</small>
          </div>
        ) : messages.map((message) => (
          <article className={`message message-${message.role}`} key={message.id}>
            <div className="message-meta">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Tadashi' : 'System'} <time>{formatTime(message.createdAt)}</time></div>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
      <form className="command-composer" onSubmit={submit}>
        <label htmlFor="command-input">Instruction</label>
        <textarea id="command-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder="e.g. Find why the onboarding test is failing and propose a fix" rows={3} disabled={disabled || isSending} />
        <div className="composer-actions">
          <button className={`voice-button ${isListening ? 'is-listening' : ''}`} onMouseDown={(event) => { event.preventDefault(); void startListening(); }} onMouseUp={stopListening} onMouseLeave={stopListening} onTouchStart={(event) => { event.preventDefault(); void startListening(); }} onTouchEnd={(event) => { event.preventDefault(); stopListening(); }} type="button" disabled={disabled || isSending} aria-pressed={isListening}>
            <span className="voice-dot" aria-hidden="true" />
            {isListening ? 'Release to stop talking' : 'Hold to talk 🎙'}
          </button>
          <button className="send-button" type="submit" disabled={disabled || isSending || !content.trim()}>
            {isSending ? 'Assessing…' : 'Route instruction'}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </form>
    </section>
  );
}

async function blobToWav(blob: Blob): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = audio.numberOfChannels;
    const bytesPerSample = 2;
    const dataLength = audio.length * channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, audio.sampleRate, true);
    view.setUint32(28, audio.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, dataLength, true);
    const channelData = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
    let offset = 44;
    for (let frame = 0; frame < audio.length; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
      }
    }
    return new Uint8Array(buffer);
  } finally {
    await context.close();
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
