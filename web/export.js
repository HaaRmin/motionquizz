// MP4 export of a quiz page shown in an <iframe>, entirely in the browser.
// Frames: the page's #stage is drawn into an SVG <foreignObject> image, then onto a canvas (renderAt(t) per frame).
// Video: WebCodecs H.264. Sound: the page's renderAudioWav() (music + voices), encoded to AAC.
// File: mp4-muxer (MIT, vendor/) combines both into one .mp4. Tested in Chrome on a Mac and in Safari (iOS Simulator).
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

const W = 1080, H = 1920, FPS = 30;
const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']; // H.264 High, Main, Baseline (level 4.0)
const AUDIO = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 192_000 };

export async function canExport() {
  if (!('VideoEncoder' in window) || !('AudioEncoder' in window)) return false;
  return (await videoConfigs()).length > 0 && (await AudioEncoder.isConfigSupported(AUDIO)).supported;
}

// every H.264 setting this browser accepts, best first
async function videoConfigs() {
  const ok = [];
  for (const codec of VIDEO_CODECS) {
    const cfg = { codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(cfg)).supported) ok.push(cfg);
  }
  return ok;
}

// The pictures (background photo, logo) are drawn straight onto the canvas, not inside the SVG frame image:
// Safari loads pictures inside an SVG image asynchronously, so a frame could be captured without them, and the
// background "blinked" in videos made on an iPhone. The photo goes under the frame image, the logo over it.
// (The cat's pose images, switched off in config.json, are still inside the frame image.)
async function pictures(doc) {
  const stage = doc.getElementById('stage');
  const photo = stage.querySelector('.qz-photo'), logo = stage.querySelector('.qz-logo');
  const load = el => (el && el.getAttribute('src') ? loadImage(el.getAttribute('src')) : null);
  return { stage, group: stage.querySelector('.qz-group'), photo, logo, photoImg: await load(photo), logoImg: await load(logo) };
}
const num = (re, s, d) => { const m = re.exec(s || ''); return m ? parseFloat(m[1]) : d; };

// the template's photo: object-fit:cover in the stage, transform-origin 50% 40%, transform translate(x,y) scale(s)
function drawPhoto(ctx, p) {
  const img = p.photoImg, t = p.photo.style.transform || '';
  const tx = num(/translate\(([-\d.]+)px/, t, 0), ty = num(/translate\([-\d.]+px,\s*([-\d.]+)px/, t, 0), s = num(/scale\(([-\d.]+)\)/, t, 1);
  const cover = Math.max(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * cover, dh = img.naturalHeight * cover;
  const ox = W * 0.5, oy = H * 0.4;
  ctx.save();
  ctx.translate(ox + tx, oy + ty); ctx.scale(s, s); ctx.translate(-ox, -oy);
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
}

// the template's logo: a 240 px circle on the closing card, rotate(deg) scale(s), with a soft shadow
function drawLogo(ctx, p) {
  const el = p.logo, card = el.parentElement, view = el.ownerDocument.defaultView;
  const alpha = parseFloat(view.getComputedStyle(card).opacity) * parseFloat(view.getComputedStyle(el).opacity);
  if (!(alpha > 0.001)) return;
  const x = card.offsetLeft + el.offsetLeft, y = card.offsetTop + el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
  const t = el.style.transform || '', deg = num(/rotate\(([-\d.]+)deg\)/, t, 0), s = num(/scale\(([-\d.]+)\)/, t, 1);
  const img = p.logoImg, cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  ctx.save();
  // x, y are inside the card's group (the template's .qz-group), which is moved and shrunk as a whole
  const group = card.offsetParent, gs = group && group !== p.stage ? groupTransform(ctx, group, view) : 1;
  ctx.globalAlpha = alpha;
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate(deg * Math.PI / 180); ctx.scale(s, s);
  ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
  // a canvas shadow is not scaled with the drawing, so it is sized here like the CSS one
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 36 * s * gs; ctx.shadowOffsetY = 14 * s * gs;
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  ctx.drawImage(img, -img.naturalWidth * cover / 2, -img.naturalHeight * cover / 2, img.naturalWidth * cover, img.naturalHeight * cover);
  ctx.restore();
}

// applies an element's CSS transform (around its transform-origin) to the canvas; returns its scale
function groupTransform(ctx, el, view) {
  const cs = view.getComputedStyle(el);
  if (!cs.transform || cs.transform === 'none') return 1;
  const m = new DOMMatrix(cs.transform), [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
  ctx.translate(el.offsetLeft + ox, el.offsetTop + oy);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.translate(-ox, -oy);
  return Math.hypot(m.a, m.b);
}

// one frame of the quiz page as an SVG image URL, without the pictures drawn separately
function frameSource(doc, p) {
  const stage = p.stage;
  // the page's CSS, with :root variables moved to the wrapper (inside the SVG image :root would be the <svg>)
  const css = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n').replace(/:root/g, '.xp-root');
  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
    '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
    '<div xmlns="http://www.w3.org/1999/xhtml" class="xp-root" style="position:relative;width:' + W + 'px;height:' + H + 'px">' +
    '<style><![CDATA[' + css + ']]></style>';
  const tail = '</div></foreignObject></svg>';
  const ser = new XMLSerializer(), hide = [p.photoImg && p.photo, p.logoImg && p.logo].filter(Boolean);
  const url = body => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(head + body + tail);
  // the stage's own tag, unscaled (the player scales the stage to fit its window; the video is 1:1)
  const shell = transparent => {
    const el = p.stage.cloneNode(false);
    el.style.transform = 'none';
    if (transparent) el.style.background = 'transparent';
    const html = ser.serializeToString(el), end = html.lastIndexOf('</div>');
    return [html.slice(0, end), html.slice(end)];
  };
  // Two images per frame: "back" is the stage without the quiz group, "front" the quiz group alone, unscaled. Safari
  // draws rounded shadows with square corners when an SVG image is scaled while it is drawn (dark boxes beside the
  // cards, a square light ring behind the bubble), whether by CSS or by the canvas; so the front is drawn 1:1 onto a
  // canvas of its own, and only that finished bitmap is moved and shrunk like the page does.
  return () => {
    hide.forEach(el => { el.style.visibility = 'hidden'; });
    const [bo, bc] = shell(Boolean(p.photoImg)); // the photo under the frame shows through
    let back = bo;
    for (const child of stage.children) if (child !== p.group) back += ser.serializeToString(child);
    let front = null;
    if (p.group) {
      const keep = p.group.style.transform;
      p.group.style.transform = 'none';
      const [fo, fc] = shell(true);
      front = url(fo + ser.serializeToString(p.group) + fc);
      p.group.style.transform = keep;
    }
    hide.forEach(el => { el.style.visibility = ''; });
    return { back: url(back + bc), front };
  };
}

// draw(t): the quiz page at time t on a 1080 x 1920 canvas, as it goes into the video
export async function frameRenderer(win) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas'); // the quiz group, drawn 1:1 (see frameSource)
  layer.width = W; layer.height = H;
  const lctx = layer.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const pics = await pictures(win.document);
  const src = frameSource(win.document, pics);
  return {
    canvas,
    layer, // the quiz group's own 1:1 picture of the last frame (for checking)
    async draw(t) {
      win.renderAt(t);
      const s = src();
      const [back, front] = await Promise.all([loadImage(s.back), s.front && loadImage(s.front)]);
      ctx.clearRect(0, 0, W, H);
      if (pics.photoImg) drawPhoto(ctx, pics);
      ctx.drawImage(back, 0, 0, W, H);
      if (front) {
        lctx.clearRect(0, 0, W, H);
        lctx.drawImage(front, 0, 0);
        ctx.save();
        groupTransform(ctx, pics.group, win);
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      }
      if (pics.logoImg) drawLogo(ctx, pics);
      return canvas;
    },
  };
}

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

// An encoder that keeps frames and gives nothing back. Safari in the iOS Simulator does this with H.264 High:
// it takes 4 frames, returns nothing, and even its flush never ends. The export then starts again with the next setting.
class Stalled extends Error {}

// waits while the encoder has more than 6 frames to do; counted in turns, so a slowed-down background tab is not "stalled"
async function drain(venc) {
  for (let turns = 0; venc.encodeQueueSize > 6; turns++) {
    if (turns > 250) throw new Stalled('the video encoder stopped');
    await new Promise(r => setTimeout(r, 4));
  }
}

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Stalled('the video encoder did not finish')), ms))]);

// Safari describes its AAC sound with a whole MPEG-4 ES descriptor (tag 3), where Chrome gives the 2-byte
// AudioSpecificConfig the muxer expects. Put into the file as it is, players cannot read the sound track and
// the video plays silent, so the AudioSpecificConfig (the DecoderSpecificInfo inside it, tag 5) is taken out.
function aacMeta(meta) {
  const d = meta && meta.decoderConfig && meta.decoderConfig.description;
  if (!d) return meta;
  const b = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  if (b[0] !== 0x03) return meta; // already an AudioSpecificConfig
  const asc = specificInfo(b);
  return asc ? { ...meta, decoderConfig: { ...meta.decoderConfig, description: asc } } : meta;
}

// the payload of the DecoderSpecificInfo inside an ES_Descriptor, or null
function specificInfo(b) {
  const read = at => { // a descriptor's tag, payload start and length (the length uses 7 bits per byte)
    let len = 0, i = at + 1;
    for (let k = 0; k < 4; k++) { const x = b[i++]; len = (len << 7) | (x & 0x7f); if (!(x & 0x80)) break; }
    return { tag: b[at], start: i, end: i + len };
  };
  const es = read(0);
  let i = es.start + 2; // ES_ID
  const flags = b[i++];
  if (flags & 0x80) i += 2; // depends on another stream
  if (flags & 0x40) i += 1 + b[i]; // URL
  if (flags & 0x20) i += 2; // OCR stream
  while (i < es.end) {
    const dc = read(i);
    if (dc.tag === 0x04) { // DecoderConfigDescriptor: 13 bytes of settings, then its own descriptors
      for (let j = dc.start + 13; j < dc.end;) {
        const ds = read(j);
        if (ds.tag === 0x05) return b.slice(ds.start, ds.end);
        j = ds.end;
      }
      return null;
    }
    i = dc.end;
  }
  return null;
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
  const configs = await videoConfigs();
  if (!configs.length) throw new Error('This browser cannot encode H.264 video. Use Chrome or Edge on a computer.');
  if (!(await AudioEncoder.isConfigSupported(AUDIO)).supported) throw new Error('This browser cannot encode the sound (AAC). Use Chrome or Edge on a computer.');
  const sound = await soundBuffer(win);
  try {
    for (let k = 0; ; k++) {
      try {
        return await encode(win, configs[k], sound, onProgress);
      } catch (e) {
        if (!(e instanceof Stalled) || k === configs.length - 1) throw e;
      }
    }
  } finally {
    win.renderAt(0);
  }
}

async function encode(win, vcfg, buf, onProgress) {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 44100 },
  });
  let encError = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encError = e; } });
  try {
    venc.configure(vcfg);

    // sound first: it is quick, and the file then has both tracks from the start
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, aacMeta(m)), error: e => { encError = e; } });
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

    const render = await frameRenderer(win);
    const frames = Math.round(win.DURATION * FPS);
    for (let i = 0; i < frames; i++) {
      if (encError) throw encError;
      const canvas = await render.draw(i / FPS);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
      vf.close();
      await drain(venc);
      if (i % 15 === 0) onProgress(i, frames);
    }
    await within(venc.flush(), 30_000);
    if (encError) throw encError;
    muxer.finalize();
    onProgress(frames, frames);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (venc.state !== 'closed') venc.close();
  }
}
