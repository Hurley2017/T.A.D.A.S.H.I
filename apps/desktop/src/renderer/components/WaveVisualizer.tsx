import { useEffect, useRef, useState } from 'react';

type State = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Props {
  state: State;
  analyser?: AnalyserNode;
}

export function WaveVisualizer({ state, analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataArray = useRef<Uint8Array | null>(null);
  
  const phase = useRef(0);
  const voiceLevel = useRef(0.08);
  const targetLevel = useRef(0.08);
  
  useEffect(() => {
    if (analyser) {
      analyser.fftSize = 256;
      dataArray.current = new Uint8Array(analyser.frequencyBinCount);
    }
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let width = 0;
    let height = 0;
    
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      width = rect.width;
      height = rect.height;
    };
    
    resize();
    window.addEventListener('resize', resize);
    
    let animationId: number;
    
    const drawAuroraRibbon = (colorStart: string, colorEnd: string, amplitudeMultiplier: number, freq: number, speed: number, offset: number, fillAlpha = 0.15) => {
      const centerY = height / 2;
      const maxAmp = (height * 0.42) * voiceLevel.current * amplitudeMultiplier;

      ctx.beginPath();
      ctx.moveTo(0, centerY);

      for (let x = 0; x <= width; x += 3) {
        const normX = (x / width) * 2 - 1;
        const envelope = Math.exp(-3.5 * normX * normX);
        const y = centerY + Math.sin(x * freq + phase.current * speed + offset) * maxAmp * envelope;
        ctx.lineTo(x, y);
      }

      const grad = ctx.createLinearGradient(0, centerY - maxAmp, width, centerY + maxAmp);
      grad.addColorStop(0, colorStart);
      grad.addColorStop(1, colorEnd);

      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      if (fillAlpha > 0) {
        ctx.lineTo(width, centerY);
        ctx.lineTo(0, centerY);
        ctx.closePath();

        const fillGrad = ctx.createLinearGradient(0, centerY - maxAmp, 0, centerY + maxAmp);
        fillGrad.addColorStop(0, colorStart.replace(')', `, ${fillAlpha})`).replace('rgb', 'rgba'));
        fillGrad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = fillGrad;
        ctx.fill();
      }
    };
    
    const animate = () => {
      if (analyser && dataArray.current) {
        analyser.getByteFrequencyData(dataArray.current);
        let sum = 0;
        for (let i = 0; i < dataArray.current.length; i++) {
          sum += dataArray.current[i];
        }
        const avg = sum / dataArray.current.length;
        targetLevel.current = Math.max(0.08, avg / 128.0);
      } else {
        if (state === 'idle') {
          targetLevel.current = 0.12 + Math.sin(phase.current * 1.8) * 0.04;
        } else if (state === 'listening') {
          targetLevel.current = 0.65 + Math.sin(phase.current * 3.5) * 0.35;
        } else if (state === 'thinking') {
          targetLevel.current = 0.45 + Math.sin(phase.current * 7.0) * 0.25;
        } else if (state === 'speaking') {
          targetLevel.current = 0.70 + Math.sin(phase.current * 5.0) * 0.30;
        }
      }
      voiceLevel.current += (targetLevel.current - voiceLevel.current) * 0.18;
      
      ctx.clearRect(0, 0, width, height);

      const centerY = height / 2;
      const centerX = width / 2;

      const glowRadius = (width * 0.22) * (0.6 + voiceLevel.current * 0.6);
      const glowAlpha = 0.03 + voiceLevel.current * 0.05;
      const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
      glow.addColorStop(0, `rgba(0, 210, 255, ${glowAlpha})`);
      glow.addColorStop(0.5, `rgba(0, 210, 255, ${glowAlpha * 0.4})`);
      glow.addColorStop(1, 'rgba(0, 210, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      const beamGrad = ctx.createLinearGradient(0, centerY, width, centerY);
      beamGrad.addColorStop(0, 'rgba(0, 210, 255, 0)');
      beamGrad.addColorStop(0.3, 'rgba(0, 210, 255, 0.12)');
      beamGrad.addColorStop(0.5, 'rgba(0, 210, 255, 0.18)');
      beamGrad.addColorStop(0.7, 'rgba(0, 210, 255, 0.12)');
      beamGrad.addColorStop(1, 'rgba(0, 210, 255, 0)');
      ctx.strokeStyle = beamGrad;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.shadowBlur = 16;
      ctx.shadowColor = 'rgba(0, 210, 255, 0.5)';

      drawAuroraRibbon('rgba(156, 39, 176, 0.85)', 'rgba(124, 77, 255, 0.85)', 0.85, 0.012, 1.6, Math.PI * 0.5, 0.12);
      drawAuroraRibbon('rgba(41, 121, 255, 0.85)', 'rgba(0, 210, 255, 0.85)', 1.05, 0.016, 2.2, Math.PI * 1.2, 0.10);
      drawAuroraRibbon('rgba(0, 229, 255, 0.95)', 'rgba(0, 255, 200, 0.95)', 1.25, 0.020, 2.8, 0, 0.08);
      drawAuroraRibbon('rgba(224, 64, 251, 0.9)', 'rgba(255, 64, 129, 0.9)', 0.95, 0.018, 2.4, Math.PI * 0.75, 0.06);

      phase.current += 0.032;
      animationId = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [state, analyser]);
  
  return (
    <div style={{ width: '100%', height: '120px', position: 'relative', overflow: 'hidden', background: '#090d15', borderRadius: '12px' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
