'use client'

import { useState, useRef, useCallback, useEffect, DragEvent, ChangeEvent } from 'react'

const MAX_DIM = 8096
const HIST_PAD = { top: 28, right: 24, bottom: 48, left: 56 }

// ── Color helpers ──────────────────────────────────────────────────────────────

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min
  const v = max, s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break
      case gn: h = ((bn - rn) / d + 2) / 6; break
      case bn: h = ((rn - gn) / d + 4) / 6; break
    }
  }
  return [h * 360, s, v]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hi = Math.floor(h / 60) % 6, f = h / 60 - Math.floor(h / 60)
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s)
  const table: Array<[number,number,number]> = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]]
  const [rn,gn,bn] = table[hi] ?? [0,0,0]
  return [Math.round(rn*255), Math.round(gn*255), Math.round(bn*255)]
}

// ── Histogram ─────────────────────────────────────────────────────────────────

interface HistCounts { r: Uint32Array; g: Uint32Array; b: Uint32Array; max: number }

function computeHistCounts(pixels: Uint8ClampedArray): HistCounts {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256)
  for (let i = 0; i < pixels.length; i += 4) { r[pixels[i]]++; g[pixels[i+1]]++; b[pixels[i+2]]++ }
  let max = 0
  for (let v = 0; v < 256; v++) { if (r[v]>max) max=r[v]; if (g[v]>max) max=g[v]; if (b[v]>max) max=b[v] }
  return { r, g, b, max }
}

interface VisibleChannels { r: boolean; g: boolean; b: boolean }

function drawHistogram(
  canvas: HTMLCanvasElement,
  counts: HistCounts,
  ranges: [number, number][],
  crosshairAt?: number,
  visibleChannels: VisibleChannels = { r: true, g: true, b: true }
) {
  const W = canvas.width, H = canvas.height
  const { top, right, bottom, left } = HIST_PAD
  const pW = W - left - right, pH = H - top - bottom
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#0d0d1a'
  ctx.fillRect(0, 0, W, H)

  if (ranges.length > 0) {
    const covered = new Uint8Array(256)
    for (const [lo, hi] of ranges)
      for (let v = Math.max(0,lo); v <= Math.min(255,hi); v++) covered[v] = 1

    ctx.fillStyle = 'rgba(0,0,0,0.52)'
    let runStart = -1
    for (let v = 0; v <= 256; v++) {
      if (v < 256 && !covered[v]) { if (runStart < 0) runStart = v }
      else if (runStart >= 0) {
        ctx.fillRect(left + (runStart/255)*pW, top, ((v-runStart)/255)*pW, pH)
        runStart = -1
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    for (const [lo, hi] of ranges)
      ctx.fillRect(left + (lo/255)*pW, top, ((hi-lo)/255)*pW, pH)
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = top + (i/4)*pH
    ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(left+pW,y); ctx.stroke()
  }
  for (let i = 0; i <= 4; i++) {
    const x = left + (i/4)*pW
    ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,top+pH); ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(left,top); ctx.lineTo(left,top+pH); ctx.lineTo(left+pW,top+pH); ctx.stroke()

  for (const [data, color, key] of [[counts.r,'rgba(255,80,80,0.9)','r'],[counts.g,'rgba(80,220,80,0.9)','g'],[counts.b,'rgba(80,140,255,0.9)','b']] as [Uint32Array,string,keyof VisibleChannels][]) {
    if (!visibleChannels[key]) continue
    ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.lineJoin='round'
    for (let v = 0; v < 256; v++) {
      const x = left + (v/255)*pW, y = top + pH - (data[v]/counts.max)*pH
      v === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
    }
    ctx.stroke()
  }

  if (ranges.length > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.5; ctx.setLineDash([])
    ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.75)'
    for (const [lo, hi] of ranges) {
      const x0 = left+(lo/255)*pW, x1 = left+(hi/255)*pW
      ctx.beginPath(); ctx.moveTo(x0,top); ctx.lineTo(x0,top+pH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x1,top); ctx.lineTo(x1,top+pH); ctx.stroke()
      ctx.textAlign = x0 < left+pW*0.15 ? 'left' : 'center'; ctx.fillText(String(lo), x0, top-4)
      ctx.textAlign = x1 > left+pW*0.85 ? 'right' : 'center'; ctx.fillText(String(hi), x1, top-4)
    }
  }

  if (crosshairAt != null) {
    const xLine = left + (crosshairAt/255)*pW
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([3,3])
    ctx.beginPath(); ctx.moveTo(xLine,top); ctx.lineTo(xLine,top+pH); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px monospace'
    ctx.textAlign = xLine > left+pW*0.8 ? 'right' : 'left'
    ctx.fillText(`${crosshairAt}`, xLine+(xLine > left+pW*0.8 ? -4 : 4), top+14)
  }

  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='11px monospace'; ctx.textAlign='center'
  for (const [v,f] of [[0,0],[64,.25],[128,.5],[192,.75],[255,1]] as [number,number][])
    ctx.fillText(String(v), left+f*pW, top+pH+16)
  ctx.fillText('Pixel Value', left+pW/2, H-6)

  ctx.save(); ctx.translate(14,top+pH/2); ctx.rotate(-Math.PI/2)
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.fillText('Count',0,0); ctx.restore()

  for (const [i,lbl,col,key] of [[0,'R','rgba(255,80,80,0.9)','r'],[1,'G','rgba(80,220,80,0.9)','g'],[2,'B','rgba(80,140,255,0.9)','b']] as [number,string,string,keyof VisibleChannels][]) {
    ctx.fillStyle = visibleChannels[key] ? col : 'rgba(255,255,255,0.18)'
    ctx.font='bold 12px monospace'; ctx.textAlign='left'
    ctx.fillText(lbl, left+i*24, top-8)
  }
}

// ── Image highlight ────────────────────────────────────────────────────────────

function drawImageWithHighlight(
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number, height: number,
  lumRanges: [number, number][],
  wheelFilter: { hue: number; sat: number } | null,
  wheelMaxR: number,
  wheelCursorR: number,
  visibleChannels: VisibleChannels = { r: true, g: true, b: true }
) {
  const ctx = canvas.getContext('2d')!
  const allVisible = visibleChannels.r && visibleChannels.g && visibleChannels.b
  const rM = visibleChannels.r ? 1 : 0
  const gM = visibleChannels.g ? 1 : 0
  const bM = visibleChannels.b ? 1 : 0

  if (lumRanges.length === 0 && !wheelFilter) {
    if (allVisible) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
      return
    }
    const out = new Uint8ClampedArray(pixels.length)
    for (let i = 0; i < pixels.length; i += 4) {
      out[i] = pixels[i]*rM; out[i+1] = pixels[i+1]*gM; out[i+2] = pixels[i+2]*bM; out[i+3] = pixels[i+3]
    }
    ctx.putImageData(new ImageData(out, width, height), 0, 0)
    return
  }

  const out = new Uint8ClampedArray(pixels.length)

  if (wheelFilter) {
    const hRad = wheelFilter.hue * Math.PI / 180
    const hovX = wheelFilter.sat * wheelMaxR * Math.cos(hRad)
    const hovY = wheelFilter.sat * wheelMaxR * Math.sin(hRad)
    const cr2 = wheelCursorR * wheelCursorR
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]*rM, g = pixels[i+1]*gM, b = pixels[i+2]*bM, a = pixels[i+3]
      const [h, s] = rgbToHsv(pixels[i], pixels[i+1], pixels[i+2])
      const pxX = s * wheelMaxR * Math.cos(h * Math.PI / 180)
      const pxY = s * wheelMaxR * Math.sin(h * Math.PI / 180)
      const dx = pxX - hovX, dy = pxY - hovY
      if (dx*dx + dy*dy <= cr2) { out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=a }
      else { out[i]=r>>3; out[i+1]=g>>3; out[i+2]=b>>3; out[i+3]=a }
    }
  } else {
    const covered = new Uint8Array(256)
    for (const [lo, hi] of lumRanges)
      for (let v = Math.max(0,lo); v <= Math.min(255,hi); v++) covered[v] = 1
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]*rM, g = pixels[i+1]*gM, b = pixels[i+2]*bM, a = pixels[i+3]
      const lum = (0.299*pixels[i] + 0.587*pixels[i+1] + 0.114*pixels[i+2]) | 0
      if (covered[lum]) { out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=a }
      else { out[i]=r>>3; out[i+1]=g>>3; out[i+2]=b>>3; out[i+3]=a }
    }
  }
  ctx.putImageData(new ImageData(out, width, height), 0, 0)
}

// ── Mask download ──────────────────────────────────────────────────────────────

function generateAndDownloadMask(
  pixels: Uint8ClampedArray,
  width: number, height: number,
  lumRanges: [number, number][]
) {
  const covered = new Uint8Array(256)
  for (const [lo, hi] of lumRanges)
    for (let v = Math.max(0,lo); v <= Math.min(255,hi); v++) covered[v] = 1

  const mask = new Uint8ClampedArray(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = (0.299*pixels[i] + 0.587*pixels[i+1] + 0.114*pixels[i+2]) | 0
    const val = covered[lum] ? 255 : 0
    mask[i] = mask[i+1] = mask[i+2] = val
    mask[i+3] = 255
  }

  const off = document.createElement('canvas')
  off.width = width; off.height = height
  off.getContext('2d')!.putImageData(new ImageData(mask, width, height), 0, 0)
  const link = document.createElement('a')
  link.download = 'mask.png'
  link.href = off.toDataURL('image/png')
  link.click()
}

// ── Color wheel ────────────────────────────────────────────────────────────────

function boxBlur(src: Float32Array, size: number, radius: number): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, c = 0
    for (let dx = -radius; dx <= radius; dx++) { const nx=x+dx; if(nx>=0&&nx<size){s+=src[y*size+nx];c++} }
    tmp[y*size+x] = c > 0 ? s/c : 0
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, c = 0
    for (let dy = -radius; dy <= radius; dy++) { const ny=y+dy; if(ny>=0&&ny<size){s+=tmp[ny*size+x];c++} }
    out[y*size+x] = c > 0 ? s/c : 0
  }
  return out
}

function normalizeDensity(arr: Float32Array): Float32Array {
  let maxV = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > maxV) maxV = arr[i]
  const logMax = Math.log1p(maxV), out = new Float32Array(arr.length)
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] > 0 ? Math.log1p(arr[i])/logMax : 0
  return out
}

// ── Tweak these to change the color wheel heatmap appearance ──────────────────
const WHEEL_PARAMS = {
  fillBlurRadius:     5,     // blob spread per blur pass
  fillBlurPasses:     3,     // passes (more = rounder, Gaussian-like)
  edgeDilateRadius:   4,     // border thickness in px (circular dilation)
  heatMaxAlpha:       200,   // max white fill opacity (0–255)
  heatMinNorm:        0.02,  // hide fill below this density (0–1)
  edgeHiThresh:       0.12,  // inner threshold for edge detection (0–1)
  edgeLoThresh:       0.04,  // outer threshold for edge detection (0–1)
  edgeR:              20,    // border color R
  edgeG:              20,    // border color G
  edgeB:              20,    // border color B
  edgeAlpha:          255,   // border opacity (0–255)
}
// ─────────────────────────────────────────────────────────────────────────────

function drawColorWheel(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray) {
  const P = WHEEL_PARAMS
  const SIZE = canvas.width, cx = SIZE/2, cy = SIZE/2, maxR = SIZE/2-20
  const ctx = canvas.getContext('2d')!

  const wheelData = ctx.createImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx=x-cx, dy=y-cy, r=Math.sqrt(dx*dx+dy*dy), idx=(y*SIZE+x)*4
    if (r > maxR) {
      wheelData.data[idx]=60; wheelData.data[idx+1]=60; wheelData.data[idx+2]=60; wheelData.data[idx+3]=255
    } else {
      const hue=((Math.atan2(dy,dx)*180/Math.PI)+360)%360, sat=r/maxR
      const [rr,gg,bb]=hsvToRgb(hue,sat,1.0)
      wheelData.data[idx]=rr; wheelData.data[idx+1]=gg; wheelData.data[idx+2]=bb; wheelData.data[idx+3]=255
    }
  }
  ctx.putImageData(wheelData, 0, 0)

  const density = new Float32Array(SIZE*SIZE)
  const total = pixels.length/4
  for (let i = 0; i < total; i++) {
    const [h,s] = rgbToHsv(pixels[i*4],pixels[i*4+1],pixels[i*4+2])
    const angle=h*Math.PI/180, rad=s*maxR
    const px=Math.round(cx+rad*Math.cos(angle)), py=Math.round(cy+rad*Math.sin(angle))
    if (px>=0&&px<SIZE&&py>=0&&py<SIZE) density[py*SIZE+px]++
  }

  let maxD = 0
  for (let i = 0; i < density.length; i++) if (density[i]>maxD) maxD=density[i]

  if (maxD > 0) {
    let blurred = density
    for (let p = 0; p < P.fillBlurPasses; p++) blurred = boxBlur(blurred, SIZE, P.fillBlurRadius)
    const norm = normalizeDensity(blurred)

    const heatData = ctx.createImageData(SIZE, SIZE)
    for (let i = 0; i < SIZE*SIZE; i++) {
      const t = norm[i]; if (t < P.heatMinNorm) continue
      heatData.data[i*4]=255; heatData.data[i*4+1]=255; heatData.data[i*4+2]=255
      heatData.data[i*4+3]=Math.round(t*P.heatMaxAlpha)
    }

    const edgeMask = new Uint8Array(SIZE*SIZE)
    for (let y=1;y<SIZE-1;y++) for (let x=1;x<SIZE-1;x++) {
      const i=y*SIZE+x; if (norm[i]<P.edgeHiThresh) continue
      if (norm[(y-1)*SIZE+x]<P.edgeLoThresh||norm[(y+1)*SIZE+x]<P.edgeLoThresh||
          norm[y*SIZE+(x-1)]<P.edgeLoThresh||norm[y*SIZE+(x+1)]<P.edgeLoThresh) edgeMask[i]=1
    }

    const edgeData = ctx.createImageData(SIZE, SIZE)
    const dr=P.edgeDilateRadius, dr2=dr*dr
    for (let y=dr;y<SIZE-dr;y++) for (let x=dr;x<SIZE-dr;x++) {
      if (!edgeMask[y*SIZE+x]) continue
      for (let dy=-dr;dy<=dr;dy++) for (let dx=-dr;dx<=dr;dx++) {
        if (dx*dx+dy*dy>dr2) continue
        const ni=(y+dy)*SIZE+(x+dx)
        edgeData.data[ni*4]=P.edgeR; edgeData.data[ni*4+1]=P.edgeG
        edgeData.data[ni*4+2]=P.edgeB; edgeData.data[ni*4+3]=P.edgeAlpha
      }
    }

    const offHeat=document.createElement('canvas'); offHeat.width=SIZE; offHeat.height=SIZE
    offHeat.getContext('2d')!.putImageData(heatData,0,0)
    const offEdge=document.createElement('canvas'); offEdge.width=SIZE; offEdge.height=SIZE
    offEdge.getContext('2d')!.putImageData(edgeData,0,0)

    ctx.save()
    ctx.beginPath(); ctx.arc(cx,cy,maxR,0,Math.PI*2); ctx.clip()
    ctx.drawImage(offHeat,0,0); ctx.drawImage(offEdge,0,0)
    ctx.restore()
  }

  ctx.beginPath(); ctx.arc(cx,cy,maxR,0,Math.PI*2)
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1; ctx.stroke()
  ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2)
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fill()
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='11px monospace'; ctx.textAlign='center'
  for (const deg of [0,60,120,180,240,300]) {
    const rad=deg*Math.PI/180
    ctx.fillText(`${deg}°`,cx+(maxR+16)*Math.cos(rad),cy+(maxR+16)*Math.sin(rad)+4)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function histClientXToValue(canvas: HTMLCanvasElement, clientX: number): number {
  const rect = canvas.getBoundingClientRect()
  const canvasX = (clientX - rect.left) * (canvas.width / rect.width)
  const pW = canvas.width - HIST_PAD.left - HIST_PAD.right
  return Math.max(0, Math.min(255, Math.round(((canvasX - HIST_PAD.left) / pW) * 255)))
}

// ── Main component ─────────────────────────────────────────────────────────────

type HistMode = 'hover' | 'range' | 'multi'
interface ImageState { src: string; width: number; height: number; pixels: Uint8ClampedArray }

export default function Home() {
  const [image, setImage] = useState<ImageState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  // ── Histogram interaction state ──────────────────────────────────────────────
  const [histMode, setHistMode] = useState<HistMode>('hover')
  const [hoveredValue, setHoveredValue] = useState<number | null>(null)
  const [hoverRadius, setHoverRadius] = useState(10)
  const [rangeSelection, setRangeSelection] = useState<[number,number] | null>(null)
  const [multiRanges, setMultiRanges] = useState<Array<[number,number]>>([])
  const [activeDrag, setActiveDrag] = useState<[number,number] | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartValueRef = useRef(0)

  // ── Color wheel interaction state ────────────────────────────────────────────
  const [wheelHovered, setWheelHovered] = useState<{ hue: number; sat: number } | null>(null)
  const [wheelSize, setWheelSize] = useState(420)
  const [wheelCursorR, setWheelCursorR] = useState(20)

  // ── Channel visibility ────────────────────────────────────────────────────────
  const [visibleChannels, setVisibleChannels] = useState<VisibleChannels>({ r: true, g: true, b: true })

  const toggleChannel = useCallback((ch: keyof VisibleChannels) => {
    setVisibleChannels(prev => ({ ...prev, [ch]: !prev[ch] }))
  }, [])

  const enableAllChannels = useCallback(() => setVisibleChannels({ r: true, g: true, b: true }), [])

  // ── Image view state ──────────────────────────────────────────────────────────
  const [imgFitHeight, setImgFitHeight] = useState(false)

  // ── Pixel inspector ───────────────────────────────────────────────────────────
  const [pixelInfo, setPixelInfo] = useState<{ r: number; g: number; b: number; clientX: number; clientY: number } | null>(null)

  // Derived
  const wheelMaxR = wheelSize / 2 - 20

  const histRef = useRef<HTMLCanvasElement>(null)
  const wheelRef = useRef<HTMLCanvasElement>(null)
  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const histCountsRef = useRef<HistCounts | null>(null)
  const wheelBGRef = useRef<ImageData | null>(null)
  const rafHistRef = useRef<number | null>(null)
  const rafImgRef = useRef<number | null>(null)

  const getHistRanges = useCallback((): [number,number][] => {
    if (histMode === 'hover' && hoveredValue !== null)
      return [[Math.max(0, hoveredValue-hoverRadius), Math.min(255, hoveredValue+hoverRadius)]]
    if (histMode === 'range' && rangeSelection) return [rangeSelection]
    if (histMode === 'multi') return activeDrag ? [...multiRanges, activeDrag] : [...multiRanges]
    return []
  }, [histMode, hoveredValue, hoverRadius, rangeSelection, multiRanges, activeDrag])

  // ── Image loading ────────────────────────────────────────────────────────────

  const processImage = useCallback((img: HTMLImageElement, src: string) => {
    const w = img.naturalWidth, h = img.naturalHeight
    if (w > MAX_DIM || h > MAX_DIM) {
      setError(`Image is ${w}×${h}px — both edges must be ≤ ${MAX_DIM}px.`); return false
    }
    const off = document.createElement('canvas'); off.width=w; off.height=h
    const offCtx = off.getContext('2d')!; offCtx.drawImage(img,0,0)
    const { data } = offCtx.getImageData(0,0,w,h)
    setImage({ src, width:w, height:h, pixels:data }); setError(null); return true
  }, [])

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => processImage(img, url)
    img.onerror = () => setError('Failed to decode the image file.')
    img.src = url
  }, [processImage])

  const fetchUrl = useCallback(async () => {
    const t = urlInput.trim(); if (!t) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/fetch-image?url=${encodeURIComponent(t)}`)
      if (!res.ok) { const b=await res.json().catch(()=>({error:'Failed to fetch image'})); setError(b.error); return }
      const blob = await res.blob(); const url = URL.createObjectURL(blob)
      const img = new Image(); img.onload=()=>processImage(img,url); img.onerror=()=>setError('Could not decode image.'); img.src=url
    } catch { setError('Network error.') } finally { setLoading(false) }
  }, [urlInput, processImage])

  // ── Draw effects ─────────────────────────────────────────────────────────────

  // Image load + wheel size change: draw wheel and store background
  useEffect(() => {
    if (!image) return
    histCountsRef.current = computeHistCounts(image.pixels)
    if (histRef.current) drawHistogram(histRef.current, histCountsRef.current, [], undefined, visibleChannels)
    if (wheelRef.current) {
      drawColorWheel(wheelRef.current, image.pixels)
      wheelBGRef.current = wheelRef.current.getContext('2d')!.getImageData(0, 0, wheelSize, wheelSize)
    }
    if (imageCanvasRef.current)
      drawImageWithHighlight(imageCanvasRef.current, image.pixels, image.width, image.height, [], null, wheelMaxR, wheelCursorR, visibleChannels)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, wheelSize])

  // Histogram redraw on mode/value change
  useEffect(() => {
    if (!histRef.current || !histCountsRef.current) return
    const ranges = getHistRanges()
    const crosshair = histMode === 'hover' ? (hoveredValue ?? undefined) : undefined
    if (rafHistRef.current) cancelAnimationFrame(rafHistRef.current)
    rafHistRef.current = requestAnimationFrame(() =>
      drawHistogram(histRef.current!, histCountsRef.current!, ranges, crosshair, visibleChannels)
    )
  }, [histMode, hoveredValue, hoverRadius, rangeSelection, multiRanges, activeDrag, getHistRanges, visibleChannels])

  // Image redraw: wheel hover takes precedence over histogram ranges
  useEffect(() => {
    if (!image || !imageCanvasRef.current) return
    if (rafImgRef.current) cancelAnimationFrame(rafImgRef.current)
    rafImgRef.current = requestAnimationFrame(() => {
      if (!imageCanvasRef.current) return
      if (wheelHovered) {
        drawImageWithHighlight(imageCanvasRef.current, image.pixels, image.width, image.height, [], wheelHovered, wheelMaxR, wheelCursorR, visibleChannels)
      } else {
        drawImageWithHighlight(imageCanvasRef.current, image.pixels, image.width, image.height, getHistRanges(), null, wheelMaxR, wheelCursorR, visibleChannels)
      }
    })
  }, [image, wheelHovered, histMode, hoveredValue, hoverRadius, rangeSelection, multiRanges, activeDrag, getHistRanges, wheelMaxR, wheelCursorR, visibleChannels])

  // Wheel cursor overlay: restore BG then draw circle
  useEffect(() => {
    if (!wheelRef.current || !wheelBGRef.current) return
    const ctx = wheelRef.current.getContext('2d')!
    ctx.putImageData(wheelBGRef.current, 0, 0)
    if (!wheelHovered) return
    const cx = wheelSize/2, cy = wheelSize/2
    const hRad = wheelHovered.hue * Math.PI / 180
    const cursorX = cx + wheelHovered.sat * wheelMaxR * Math.cos(hRad)
    const cursorY = cy + wheelHovered.sat * wheelMaxR * Math.sin(hRad)
    ctx.beginPath(); ctx.arc(cursorX, cursorY, wheelCursorR, 0, Math.PI*2)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke()
    ctx.beginPath(); ctx.arc(cursorX, cursorY, 2.5, 0, Math.PI*2)
    ctx.fillStyle = 'white'; ctx.fill()
  }, [wheelHovered, wheelSize, wheelMaxR, wheelCursorR])

  // Keyboard ↑/↓ while hovering wheel → resize wheel
  useEffect(() => {
    if (!wheelHovered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); setWheelSize(s => Math.min(600, s + 20)) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setWheelSize(s => Math.max(200, s - 20)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wheelHovered])

  // ── Histogram pointer handlers (mouse + touch) ───────────────────────────────

  const onHistPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!histRef.current) return
    if (isDraggingRef.current) {
      const v = histClientXToValue(histRef.current, e.clientX)
      const lo = Math.min(dragStartValueRef.current, v), hi = Math.max(dragStartValueRef.current, v)
      setActiveDrag([lo, hi])
      if (histMode === 'range') setRangeSelection([lo, hi])
    } else if (histMode === 'hover') {
      const canvas = histRef.current
      const rect = canvas.getBoundingClientRect()
      const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width)
      const pW = canvas.width - HIST_PAD.left - HIST_PAD.right
      const inPlot = canvasX >= HIST_PAD.left && canvasX <= canvas.width - HIST_PAD.right
      setHoveredValue(inPlot ? Math.max(0, Math.min(255, Math.round(((canvasX-HIST_PAD.left)/pW)*255))) : null)
    }
  }, [histMode])

  const onHistPointerLeave = useCallback(() => {
    if (histMode === 'hover') setHoveredValue(null)
  }, [histMode])

  const onHistPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if ((histMode !== 'range' && histMode !== 'multi') || !histRef.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = histClientXToValue(histRef.current, e.clientX)
    dragStartValueRef.current = v
    isDraggingRef.current = true
    setActiveDrag([v, v])
  }, [histMode])

  const onHistPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !histRef.current) return
    isDraggingRef.current = false
    setActiveDrag(null)
    const v = histClientXToValue(histRef.current, e.clientX)
    const lo = Math.min(dragStartValueRef.current, v), hi = Math.max(dragStartValueRef.current, v)
    if (histMode === 'range') {
      setRangeSelection(hi - lo < 2 ? null : [lo, hi])
    } else if (histMode === 'multi') {
      if (hi - lo < 2) setMultiRanges([])
      else setMultiRanges(prev => [...prev, [lo, hi]])
    }
  }, [histMode])

  // ── Color wheel pointer handlers (mouse + touch) ──────────────────────────────

  const onWheelPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = wheelRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height
    const cx = canvas.width/2, cy = canvas.height/2
    const x = (e.clientX - rect.left)*scaleX - cx
    const y = (e.clientY - rect.top)*scaleY - cy
    const r = Math.sqrt(x*x + y*y)
    if (r > wheelMaxR) { setWheelHovered(null); return }
    setWheelHovered({ hue: ((Math.atan2(y,x)*180/Math.PI)+360)%360, sat: r/wheelMaxR })
  }, [wheelMaxR])

  const onWheelPointerLeave = useCallback(() => setWheelHovered(null), [])

  // ── Image pixel inspector (mouse + touch) ─────────────────────────────────────

  const onImgPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = imageCanvasRef.current; if (!canvas || !image) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) * (image.width / rect.width))
    const y = Math.floor((e.clientY - rect.top) * (image.height / rect.height))
    if (x < 0 || x >= image.width || y < 0 || y >= image.height) return
    const idx = (y * image.width + x) * 4
    setPixelInfo({ r: image.pixels[idx], g: image.pixels[idx+1], b: image.pixels[idx+2], clientX: e.clientX, clientY: e.clientY })
  }, [image])

  const onImgPointerLeave = useCallback(() => setPixelInfo(null), [])
  const onImgPointerUp = useCallback(() => setPixelInfo(null), [])

  const switchMode = useCallback((m: HistMode) => {
    setHistMode(m); setHoveredValue(null); setRangeSelection(null)
    setMultiRanges([]); setActiveDrag(null); isDraggingRef.current = false
  }, [])

  const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) loadFile(f)
  }

  // ── Analyzer view ─────────────────────────────────────────────────────────────
  if (image) {
    const activeRanges = getHistRanges()
    const hasMaskableRange = (histMode === 'range' && rangeSelection !== null) ||
                             (histMode === 'multi' && multiRanges.length > 0)
    const maskRanges = histMode === 'range' && rangeSelection ? [rangeSelection] : multiRanges

    const rangeLabel = wheelHovered
      ? `hue ${Math.round(wheelHovered.hue)}° · sat ${(wheelHovered.sat*100).toFixed(0)}%`
      : histMode === 'hover' && hoveredValue !== null
        ? `lum ${hoveredValue} ±${hoverRadius}`
        : histMode === 'range' && rangeSelection
          ? `${rangeSelection[0]}–${rangeSelection[1]}`
          : histMode === 'multi' && multiRanges.length > 0
            ? `${multiRanges.length} range${multiRanges.length > 1 ? 's' : ''}`
            : null

    const imgCanvasStyle: React.CSSProperties = imgFitHeight
      ? { height: 'calc(100vh - 65px)', maxWidth: '100%', aspectRatio: `${image.width} / ${image.height}` }
      : {}

    return (
      <main className="min-h-screen bg-[#09090f] flex flex-col text-white">
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <span className="font-bold text-lg tracking-wide bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
            Color Analyzer
          </span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/40">{image.width} × {image.height}px</span>
            <button
              onClick={() => setImgFitHeight(f => !f)}
              className={['px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer',
                imgFitHeight
                  ? 'border-violet-500/60 bg-violet-600/20 text-violet-300'
                  : 'border-white/20 hover:border-white/40 hover:bg-white/5 text-white/50'].join(' ')}
            >
              {imgFitHeight ? 'Natural Size' : 'Fit Height'}
            </button>
            <button
              onClick={() => { setImage(null); setError(null); setUrlInput(''); setHoveredValue(null); setRangeSelection(null); setMultiRanges([]) }}
              className="px-4 py-1.5 text-sm rounded-lg border border-white/20 hover:border-white/40 hover:bg-white/5 transition-colors cursor-pointer"
            >
              New Image
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 65px)' }}>
          {/* Left: image */}
          <div className={['w-1/2 flex items-center justify-center p-6 border-r border-white/10',
            imgFitHeight ? 'overflow-auto' : 'overflow-hidden'].join(' ')}>
            <canvas
              ref={imageCanvasRef}
              width={image.width} height={image.height}
              className={['rounded-xl shadow-2xl shadow-black/60 cursor-crosshair touch-none',
                imgFitHeight ? '' : 'max-w-full max-h-full'].join(' ')}
              style={imgCanvasStyle}
              onPointerMove={onImgPointerMove}
              onPointerLeave={onImgPointerLeave}
              onPointerUp={onImgPointerUp}
            />
          </div>

          {/* Right: charts */}
          <div className="w-1/2 flex flex-col gap-6 p-6 overflow-y-auto">

            {/* Histogram */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/35">
                    Pixel Value Histogram
                    {rangeLabel && !wheelHovered && (
                      <span className="ml-2 normal-case font-normal tracking-normal text-white/50">— {rangeLabel}</span>
                    )}
                  </p>
                  {/* Channel toggles */}
                  <div className="flex items-center gap-3 border-l border-white/10 pl-3">
                    {([['r','R','rgb(255,80,80)'],['g','G','rgb(80,220,80)'],['b','B','rgb(80,140,255)']] as [keyof VisibleChannels,string,string][]).map(([ch, lbl, col]) => (
                      <div key={ch} className="flex items-center gap-2 select-none">
                        <button
                          onClick={() => toggleChannel(ch)}
                          className="w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer"
                          style={{
                            borderColor: visibleChannels[ch] ? col : 'rgba(255,255,255,0.25)',
                            background: visibleChannels[ch] ? col : 'transparent',
                          }}
                          title={`Toggle ${lbl} channel`}
                        >
                          {visibleChannels[ch] && (
                            <svg viewBox="0 0 8 8" className="w-3 h-3" fill="none">
                              <path d="M1.5 4L3.5 6L6.5 2" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                        <span
                          className="text-xs font-bold font-mono transition-colors"
                          style={{ color: visibleChannels[ch] ? col : 'rgba(255,255,255,0.2)' }}
                        >
                          {lbl}
                        </span>
                      </div>
                    ))}
                    {(!visibleChannels.r || !visibleChannels.g || !visibleChannels.b) && (
                      <button
                        onClick={enableAllChannels}
                        className="text-xs px-2 py-0.5 rounded border border-white/20 text-white/40 hover:text-white/70 hover:border-white/40 transition-colors cursor-pointer"
                      >
                        all
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {histMode === 'hover' && (
                    <label className="flex items-center gap-1 text-xs text-white/40">
                      <span>±</span>
                      <input
                        type="number" min={1} max={127}
                        value={hoverRadius}
                        onChange={e => setHoverRadius(Math.max(1, Math.min(127, Number(e.target.value) || 1)))}
                        className="w-11 bg-white/5 border border-white/15 rounded px-1.5 py-0.5 text-white/70 text-center text-xs focus:outline-none focus:border-violet-500/60 [appearance:textfield]"
                      />
                    </label>
                  )}
                  {(['hover','range','multi'] as HistMode[]).map(m => (
                    <button key={m} onClick={() => switchMode(m)}
                      className={['px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer',
                        histMode === m ? 'bg-violet-600 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'].join(' ')}>
                      {m === 'hover' ? 'Hover' : m === 'range' ? 'Range' : 'Multi'}
                    </button>
                  ))}
                </div>
              </div>

              <div className={['rounded-xl overflow-hidden border border-white/10',
                histMode !== 'hover' ? 'cursor-crosshair' : ''].join(' ')}>
                <canvas ref={histRef} width={560} height={230} className="w-full block touch-none"
                  onPointerMove={onHistPointerMove} onPointerLeave={onHistPointerLeave}
                  onPointerDown={onHistPointerDown} onPointerUp={onHistPointerUp} />
              </div>

              {histMode === 'range' && (
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-xs text-white/25">
                    Drag to select · click to clear
                    {rangeSelection && (
                      <button onClick={() => setRangeSelection(null)} className="ml-2 underline hover:text-white/50 cursor-pointer">clear</button>
                    )}
                  </p>
                  {rangeSelection && (
                    <button
                      onClick={() => generateAndDownloadMask(image.pixels, image.width, image.height, [rangeSelection])}
                      className="text-xs px-2.5 py-1 rounded-md bg-violet-600/25 hover:bg-violet-600/45 text-violet-300 border border-violet-500/30 transition-colors cursor-pointer"
                    >
                      ↓ mask
                    </button>
                  )}
                </div>
              )}
              {histMode === 'multi' && (
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-xs text-white/25">
                    Drag to add ranges · click anywhere to reset
                    {multiRanges.length > 0 && (
                      <><span className="ml-2 text-white/40">{multiRanges.length} range{multiRanges.length>1?'s':''} selected</span>
                      <button onClick={() => setMultiRanges([])} className="ml-2 underline hover:text-white/50 cursor-pointer">clear all</button></>
                    )}
                  </p>
                  {multiRanges.length > 0 && !activeDrag && (
                    <button
                      onClick={() => generateAndDownloadMask(image.pixels, image.width, image.height, multiRanges)}
                      className="text-xs px-2.5 py-1 rounded-md bg-violet-600/25 hover:bg-violet-600/45 text-violet-300 border border-violet-500/30 transition-colors cursor-pointer"
                    >
                      ↓ mask
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Color wheel */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/35">
                  Hue · Saturation Color Wheel
                  {wheelHovered && (
                    <span className="ml-2 normal-case font-normal tracking-normal text-white/50">
                      — {rangeLabel}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-3 text-xs text-white/35">
                  <label className="flex items-center gap-1">
                    <span>cursor r</span>
                    <input
                      type="number" min={5} max={100}
                      value={wheelCursorR}
                      onChange={e => setWheelCursorR(Math.max(5, Math.min(100, Number(e.target.value) || 20)))}
                      className="w-12 bg-white/5 border border-white/15 rounded px-1.5 py-0.5 text-white/70 text-center text-xs focus:outline-none focus:border-violet-500/60 [appearance:textfield]"
                    />
                  </label>
                  <span className="text-white/20">
                    {wheelSize}px · ↑↓ to resize
                  </span>
                </div>
              </div>
              <div className="flex justify-center rounded-xl overflow-hidden border border-white/10 bg-[rgb(60,60,60)]">
                <canvas ref={wheelRef} width={wheelSize} height={wheelSize}
                  className="w-full max-w-sm block cursor-crosshair touch-none"
                  onPointerMove={onWheelPointerMove} onPointerLeave={onWheelPointerLeave} />
              </div>
            </div>

          </div>
        </div>

        {/* Pixel inspector tooltip */}
        {pixelInfo && (() => {
          const { r, g, b, clientX, clientY } = pixelInfo
          const brightness = Math.round(0.299*r + 0.587*g + 0.114*b)
          const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
          const flipX = clientX > window.innerWidth * 0.45
          const flipY = clientY > window.innerHeight * 0.75
          return (
            <div
              className="fixed z-50 pointer-events-none select-none"
              style={{ left: flipX ? clientX - 168 : clientX + 14, top: flipY ? clientY - 110 : clientY + 14 }}
            >
              <div className="bg-black/85 border border-white/15 rounded-xl px-3 py-2.5 text-xs font-mono text-white backdrop-blur-sm shadow-xl w-40">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-md border border-white/20 shrink-0" style={{ background: hex }} />
                  <span className="text-white/90 font-semibold tracking-wider">{hex.toUpperCase()}</span>
                </div>
                <div className="space-y-0.5 text-white/60">
                  <div className="flex justify-between"><span className="text-red-400">R</span><span>{r}</span></div>
                  <div className="flex justify-between"><span className="text-green-400">G</span><span>{g}</span></div>
                  <div className="flex justify-between"><span className="text-blue-400">B</span><span>{b}</span></div>
                  <div className="flex justify-between border-t border-white/10 pt-0.5 mt-1"><span className="text-white/40">lum</span><span>{brightness}</span></div>
                </div>
              </div>
            </div>
          )
        })()}
      </main>
    )
  }

  // ── Landing view ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#09090f] flex flex-col items-center justify-center p-6 text-white">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-900/20 blur-[120px]" />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-2 bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Color Analyzer</h1>
        <p className="text-white/40 text-sm text-center mb-10">Explore pixel distribution, histograms &amp; color space</p>

        <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={() => fileRef.current?.click()}
          className={['cursor-pointer rounded-2xl border-2 border-dashed p-12 flex flex-col items-center justify-center gap-3 transition-all duration-200',
            dragging ? 'border-violet-400 bg-violet-500/10 scale-[1.01]' : 'border-white/20 hover:border-white/35 hover:bg-white/[0.03]'].join(' ')}>
          <svg className="w-10 h-10 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <div className="text-center">
            <p className="text-white/70 font-medium">Drop image here</p>
            <p className="text-white/30 text-sm">or click to browse</p>
          </div>
          <p className="text-white/20 text-xs">Max {MAX_DIM}×{MAX_DIM}px · JPEG, PNG, WebP, GIF</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => { const f=e.target.files?.[0]; if(f) loadFile(f) }} />
        </div>

        <div className="flex items-center gap-4 my-5">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-white/25 text-xs uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <div className="flex gap-2">
          <input type="url" value={urlInput} onChange={e=>setUrlInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&fetchUrl()} placeholder="https://example.com/image.jpg"
            className="flex-1 bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-violet-500/60 focus:bg-white/[0.07] transition-all" />
          <button onClick={fetchUrl} disabled={loading||!urlInput.trim()}
            className="px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors cursor-pointer">
            {loading ? '…' : 'Fetch'}
          </button>
        </div>

        {error && <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      </div>
    </main>
  )
}
