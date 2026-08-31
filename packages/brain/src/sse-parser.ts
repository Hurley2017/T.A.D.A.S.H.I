export type SseFrame = { event?: string; data: string };

export class SseParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const frames: SseFrame[] = [];
    let separator = this.buffer.indexOf('\n\n');
    while (separator >= 0) {
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
      separator = this.buffer.indexOf('\n\n');
    }
    return frames;
  }

  flush(): SseFrame[] {
    if (!this.buffer.trim()) return [];
    const frame = parseFrame(this.buffer);
    this.buffer = '';
    return frame ? [frame] : [];
  }
}

function parseFrame(raw: string): SseFrame | undefined {
  const data: string[] = [];
  let event: string | undefined;
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join('\n') } : undefined;
}
