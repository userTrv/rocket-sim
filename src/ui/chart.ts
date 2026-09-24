import type { TelemetrySample } from '../sim/telemetry';

export interface ChartSeries {
  readonly label: string;
  readonly color: string;
  readonly unit: string;
  readonly scale: number;
  readonly value: (s: TelemetrySample) => number;
}

/** Tiny canvas line chart for live telemetry (value vs mission time). */
export class TelemetryChart {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly series: ChartSeries,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(samples: readonly TelemetrySample[]): void {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = this.series;
    const top = 16;
    const bottom = h - 4;
    const left = 4;
    const right = w - 4;

    ctx.strokeStyle = 'rgba(160, 190, 220, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = top + ((bottom - top) * i) / 3;
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(right, y + 0.5);
      ctx.stroke();
    }

    const values = samples.map((x) => s.value(x) * s.scale);
    const maxValue = Math.max(1e-6, ...values);
    const tMax = Math.max(60, samples.at(-1)?.t ?? 0);
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = s.color;
    ctx.fillText(s.label.toUpperCase(), left, 11);
    ctx.fillStyle = 'rgba(220, 232, 245, 0.85)';
    const peak = `${maxValue.toFixed(maxValue < 10 ? 2 : 0)} ${s.unit}`;
    ctx.fillText(peak, right - ctx.measureText(peak).width, 11);
    if (samples.length < 2) return;

    ctx.beginPath();
    samples.forEach((sample, i) => {
      const x = left + ((right - left) * sample.t) / tMax;
      const y = bottom - ((bottom - top) * values[i]!) / maxValue;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineTo(left + ((right - left) * samples.at(-1)!.t) / tMax, bottom);
    ctx.lineTo(left + ((right - left) * samples[0]!.t) / tMax, bottom);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
