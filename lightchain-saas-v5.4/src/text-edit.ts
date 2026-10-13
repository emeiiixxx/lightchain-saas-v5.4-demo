import type { Worker } from 'tesseract.js';
import { rememberDemoAsset } from './demo-storage';

export type TextRegion = { x: number; y: number; width: number; height: number };
export type RecognizedLine = TextRegion & { text: string; words: TextRegion[] };
export type TextRecognition = { text: string; lines: RecognizedLine[] };
export type TextEditInput = {
  sourceUrl: string; width: number; height: number; region: TextRegion;
  recognition: TextRecognition;
};

export function cropTextRegion(image: HTMLImageElement, region: TextRegion) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width)); canvas.height = Math.max(1, Math.round(region.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createTextRecognizer() {
  let worker: Promise<Worker> | undefined;
  let queue = Promise.resolve();
  let disposed = false;
  const getWorker = () => worker ??= import('tesseract.js').then(async ({ createWorker, PSM }) => {
    const base = new URL('/assets/ocr/', window.location.href).href;
    const instance = await createWorker(['chi_sim', 'eng'], 1, {
      workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''),
      workerBlobURL: false, errorHandler: () => {},
    });
    if (disposed) { await instance.terminate(); throw new Error('cancelled'); }
    await instance.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    return instance;
  });
  return {
    recognize(image: HTMLImageElement, region: TextRegion): Promise<TextRecognition> {
      const task = queue.then(async () => {
        if (disposed) throw new Error('cancelled');
        const instance = await getWorker();
        const crop = cropTextRegion(image, region);
        // Enlarge small text for OCR; return all coordinates in original image pixels.
        const scale = Math.min(3, Math.max(1, 1800 / Math.max(crop.width, crop.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(crop.width * scale); canvas.height = Math.round(crop.height * scale);
        canvas.getContext('2d')!.drawImage(crop, 0, 0, canvas.width, canvas.height);
        const { data } = await instance.recognize(canvas, {}, { text: true, blocks: true });
        const rect = (bbox: { x0: number; y0: number; x1: number; y1: number }): TextRegion => ({
          x: region.x + bbox.x0 / scale, y: region.y + bbox.y0 / scale,
          width: (bbox.x1 - bbox.x0) / scale, height: (bbox.y1 - bbox.y0) / scale,
        });
        const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
          .filter(line => line.text.trim() && line.confidence >= 25)
          .map(line => ({ ...rect(line.bbox), text: line.text.trim(), words: line.words.map(word => rect(word.bbox)) }));
        return { text: lines.map(line => line.text).join('\n'), lines };
      });
      queue = task.then(() => {}, () => {
        const failedWorker = worker; worker = undefined;
        void failedWorker?.then(instance => instance.terminate()).catch(() => {});
      });
      return task;
    },
    dispose() { disposed = true; void worker?.then(instance => instance.terminate()).catch(() => {}); },
  };
}

async function keepCanvas(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('image_export_failed')), 'image/png'));
  const url = URL.createObjectURL(blob);
  try { await rememberDemoAsset(url, blob); return url; }
  catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function textSelectionPreview(image: HTMLImageElement, region: TextRegion) {
  const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(32,208,196,0.2)'; context.strokeStyle = '#0bc1b8'; context.lineWidth = 2;
  context.fillRect(region.x * scale, region.y * scale, region.width * scale, region.height * scale);
  context.strokeRect(region.x * scale, region.y * scale, region.width * scale, region.height * scale);
  return keepCanvas(canvas);
}

export function replacementText(prompt: string) {
  const quoted = prompt.match(/(?:改为|改成|替换为|替换成)\s*[“「"]([\s\S]*?)[”」"]\s*[。.]?$/);
  return (quoted?.[1] ?? prompt).trim();
}

/** Local effect simulation, not a generative AI service. Only the selected crop is composited back. */
export async function renderTextEdit(input: TextEditInput, prompt: string): Promise<string> {
  const image = new Image(); image.crossOrigin = 'anonymous'; image.src = input.sourceUrl; await image.decode();
  const { region, recognition } = input;
  const crop = cropTextRegion(image, region);
  const context = crop.getContext('2d')!;
  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  const sample = (x: number, y: number) => {
    const offset = (Math.max(0, Math.min(crop.height - 1, Math.round(y))) * crop.width + Math.max(0, Math.min(crop.width - 1, Math.round(x)))) * 4;
    return [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
  };
  // Sample the surrounding paper/background for each recognized word, keeping table rules intact.
  for (const line of recognition.lines) for (const word of line.words) {
    const x = word.x - region.x, y = word.y - region.y;
    const samples = [sample(x - 2, y), sample(x + word.width + 2, y), sample(x + word.width / 2, y - 2), sample(x + word.width / 2, y + word.height + 2)];
    const color = [0, 1, 2].map(channel => samples.map(item => item[channel]).sort((a, b) => a - b)[2]);
    context.fillStyle = `rgb(${color.join(',')})`; context.fillRect(x - 1, y - 1, word.width + 2, word.height + 2);
  }
  await document.fonts.ready;
  const lines = replacementText(prompt).split('\n');
  const matchingLines = lines.length === recognition.lines.length;
  const padding = Math.max(2, Math.min(8, crop.height * .02));
  const lineHeight = (crop.height - padding * 2) / lines.length;
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    const target = matchingLines ? recognition.lines[index] : undefined;
    const x = target ? target.x - region.x : padding;
    const y = target ? target.y - region.y : padding + index * lineHeight;
    const maxWidth = Math.max(1, crop.width - x - padding);
    let fontSize = Math.max(2, target ? target.height : Math.min(lineHeight * .78, 48));
    context.font = `${fontSize}px "Noto Sans SC Variable", sans-serif`;
    const measured = context.measureText(line).width;
    if (measured > maxWidth) { fontSize *= maxWidth / measured; context.font = `${fontSize}px "Noto Sans SC Variable", sans-serif`; }
    const background = sample(x, Math.max(0, y - 2));
    context.fillStyle = background.reduce((sum, value) => sum + value, 0) > 380 ? '#171b1c' : '#ffffff';
    context.fillText(line, x, y, maxWidth);
  });
  const output = document.createElement('canvas'); output.width = image.naturalWidth; output.height = image.naturalHeight;
  const result = output.getContext('2d')!; result.drawImage(image, 0, 0);
  result.drawImage(crop, region.x, region.y, region.width, region.height);
  return keepCanvas(output);
}
