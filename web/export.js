// MP4 export of a quiz page shown in an <iframe>, entirely in the browser.
// Frames: the page's #stage is drawn into an SVG <foreignObject> image, then onto a canvas (renderAt(t) per frame).
// Video: WebCodecs H.264. Sound: the page's renderAudioWav() (music + voices), encoded to AAC.
// File: mp4-muxer (MIT, vendor/) combines both into one .mp4. Tested in Chrome and Edge.
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

const W = 1080, H = 1920, FPS = 30;
const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']; // H.264 High, Main, Baseline (level 4.0)
const AUDIO = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 192_000 };

export async function canExport() {
  if (!('VideoEncoder' in window) || !('AudioEncoder' in window)) return false;
  return Boolean(await pickVideoConfig()) && (await AudioEncoder.isConfigSupported(AUDIO)).supported;
}

async function pickVideoConfig() {
  for (const codec of VIDEO_CODECS) {
    const cfg = { codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
  }
  return null;
}

// one frame of the quiz page as an SVG image URL
function frameSource(doc) {
  const stage = doc.getElementById('stage');
  // the page's CSS, with :root variables moved to the wrapper (inside the SVG image :root would be the <svg>)
  const css = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n').replace(/:root/g, '.xp-root');
  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
    '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
    '<div xmlns="http://www.w3.org/1999/xhtml" class="xp-root" style="position:relative;width:' + W + 'px;height:' + H + 'px">' +
    '<style><![CDATA[' + css + ']]></style>';
  const tail = '</div></foreignObject></svg>';
  const ser = new XMLSerializer();
  return () => {
    const scale = stage.style.transform;
    stage.style.transform = 'none'; // the player scales the stage to fit its window; the video is 1:1
    const body = ser.serializeToString(stage);
    stage.style.transform = scale;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(head + body + tail);
  };
}

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function soundBuffer(win) {
  const b64 = await win.renderAudioWav();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer);
}

// win: the quiz page's window (same origin). onProgress(done, total) is called now and then.
export async function exportMp4(win, onProgress = () => {}) {
  if (!('VideoEncoder' in window) || !('AudioEncoder' in window)) throw new Error('This browser cannot make videos. Use Chrome or Edge on a computer.');
  await win.QUIZ_READY;
  const vcfg = await pickVideoConfig();
  if (!vcfg) throw new Error('This browser cannot encode H.264 video. Use Chrome or Edge on a computer.');
  if (!(await AudioEncoder.isConfigSupported(AUDIO)).supported) throw new Error('This browser cannot encode the sound (AAC). Use Chrome or Edge on a computer.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 44100 },
  });
  let encError = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encError = e; } });
  venc.configure(vcfg);

  // sound first: it is quick, and the file then has both tracks from the start
  const buf = await soundBuffer(win);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { encError = e; } });
  aenc.configure(AUDIO);
  for (let i = 0, step = 4410; i < buf.length; i += step) {
    const n = Math.min(step, buf.length - i), data = new Float32Array(n * 2);
    data.set(buf.getChannelData(0).subarray(i, i + n), 0);
    data.set(buf.getChannelData(1).subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 44100, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 44100 * 1e6), data });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  aenc.close();

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const src = frameSource(win.document);
  const frames = Math.round(win.DURATION * FPS);
  for (let i = 0; i < frames; i++) {
    if (encError) throw encError;
    win.renderAt(i / FPS);
    ctx.drawImage(await loadImage(src()), 0, 0, W, H);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
    if (i % 15 === 0) onProgress(i, frames);
  }
  await venc.flush();
  venc.close();
  if (encError) throw encError;
  muxer.finalize();
  win.renderAt(0);
  onProgress(frames, frames);
  return new Blob([target.buffer], { type: 'video/mp4' });
}
