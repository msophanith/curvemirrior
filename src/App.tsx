import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

type MirrorType = "convex" | "concave" | "funhouse" | "fisheye";

interface MirrorOption {
  id: MirrorType;
  label: string;
  icon: string;
  desc: string;
}

interface TouchPoint {
  x: number;
  y: number;
  pressure: number;
  vx: number;
  vy: number;
  age: number;
}

const MIRROR_TYPES: MirrorOption[] = [
  { id: "convex", label: "Convex", icon: "⌒", desc: "Bulges outward" },
  { id: "concave", label: "Concave", icon: "⌣", desc: "Curves inward" },
  { id: "funhouse", label: "Fun House", icon: "〜", desc: "Wavy distortion" },
  { id: "fisheye", label: "Fish Eye", icon: "◉", desc: "Ultra wide" },
];

function applyDistortion(
  imgData: ImageData,
  type: MirrorType,
  str: number,
  frame: number,
  touches: TouchPoint[],
): ImageData {
  const { data, width: w, height: h } = imgData;
  const out = new ImageData(w, h);
  const od = out.data;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(cx, cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const r = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);
      let nx = x;
      let ny = y;

      const rdx = (x - cx) / cx;
      const rdy = (y - cy) / cy;

      if (type === "convex") {
        const k = str * 0.8;
        nx = cx + rdx * (1 + k * (rdx * rdx + rdy * rdy)) * cx;
        ny = cy + rdy * (1 + k * (rdx * rdx + rdy * rdy)) * cy;
      } else if (type === "concave" && r < 1) {
        const nr = r * Math.pow(r, str * 1.5);
        nx = cx + nr * Math.cos(theta) * maxR;
        ny = cy + nr * Math.sin(theta) * maxR;
      } else if (type === "concave" && r >= 1) {
        const rRect = Math.max(Math.abs(rdx), Math.abs(rdy));
        const edgeFade = Math.max(0, 1 - (rRect - 1) * 2);
        const nr = r * Math.pow(Math.min(r, 1), str * 1.5 * edgeFade);
        nx = cx + nr * Math.cos(theta) * maxR;
        ny = cy + nr * Math.sin(theta) * maxR;
      } else if (type === "funhouse") {
        nx = x + str * 38 * Math.sin(y * 0.045 + frame * 0.05);
        ny = y + str * 28 * Math.cos(x * 0.04 + frame * 0.04);
      } else if (type === "fisheye") {
        const k = str * 1.1;
        const fx = Math.sin(rdx * Math.PI * 0.5 * k) / Math.max(k, 0.01);
        const fy = Math.sin(rdy * Math.PI * 0.5 * k) / Math.max(k, 0.01);
        nx = cx + fx * cx * 1.55;
        ny = cy + fy * cy * 1.55;
      }

      for (const tp of touches) {
        if (tp.pressure < 0.005) continue;
        const tcx = tp.x * w;
        const tcy = tp.y * h;
        const tdx = nx - tcx;
        const tdy = ny - tcy;
        const td = Math.sqrt(tdx * tdx + tdy * tdy);
        const rippleRadius = 40 + tp.age * 2.5;
        const falloff = Math.exp(-td / rippleRadius);
        const pushMag = tp.pressure * 55 * falloff;
        const rippleMag =
          tp.pressure *
          28 *
          Math.sin((td / rippleRadius) * Math.PI * 2) *
          falloff;
        if (td > 0.5) {
          const ndx = tdx / td;
          const ndy = tdy / td;
          nx += ndx * (pushMag + rippleMag);
          ny += ndy * (pushMag + rippleMag);
        }
      }

      const sx = Math.round(nx);
      const sy = Math.round(ny);
      const di = (y * w + x) * 4;
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        const si = (sy * w + sx) * 4;
        od[di] = data[si];
        od[di + 1] = data[si + 1];
        od[di + 2] = data[si + 2];
        od[di + 3] = data[si + 3];
      }
    }
  }
  return out;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const hasCamRef = useRef(false);
  const typeRef = useRef<MirrorType>("convex");
  const strengthRef = useRef(0.6);
  const touchesRef = useRef<Map<number, TouchPoint>>(new Map());

  const [mirrorType, setMirrorType] = useState<MirrorType>("convex");
  const [strength, setStrength] = useState(0.6);
  const [hasCamera, setHasCamera] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPoking, setIsPoking] = useState(false);

  useEffect(() => {
    typeRef.current = mirrorType;
  }, [mirrorType]);
  useEffect(() => {
    strengthRef.current = strength;
  }, [strength]);

  const toCanvasNorm = useCallback((clientX: number, clientY: number) => {
    const canvas = outputRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const pos = toCanvasNorm(e.clientX, e.clientY);
      touchesRef.current.set(e.pointerId, {
        ...pos,
        pressure: 1,
        vx: 0,
        vy: 0,
        age: 0,
      });
      setIsPoking(true);
    },
    [toCanvasNorm],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const tp = touchesRef.current.get(e.pointerId);
      if (!tp) return;
      const pos = toCanvasNorm(e.clientX, e.clientY);
      tp.vx = pos.x - tp.x;
      tp.vy = pos.y - tp.y;
      tp.x = pos.x;
      tp.y = pos.y;
      tp.pressure = Math.min(1, tp.pressure + 0.15);
      tp.age = 0;
    },
    [toCanvasNorm],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const tp = touchesRef.current.get(e.pointerId);
      if (tp) tp.pressure = Math.min(tp.pressure, 0.6);
      if (touchesRef.current.size <= 1) setIsPoking(false);
    },
    [],
  );

  const startCamera = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Camera requires secure context (https or localhost)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API not available. Serve over https:// or localhost.");
      setLoading(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // play() may throw AbortError on fast unmount — ignore
      try {
        await video.play();
      } catch {
        /* ignore */
      }
      hasCamRef.current = true;
      setHasCamera(true);
      setError(null);
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      console.error("[CurveMirror] camera error:", err);

      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          'Permission denied — allow camera in your browser then tap "Enable Camera".',
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("No camera found on this device.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError("Camera is in use by another app — close it and retry.");
      } else if (name === "OverconstrainedError") {
        // Retry without facingMode constraint
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            try {
              await video.play();
            } catch {
              /* ignore */
            }
            hasCamRef.current = true;
            setHasCamera(true);
            setError(null);
            setLoading(false);
            return;
          }
        } catch {
          setError("Camera unavailable — showing demo mode.");
        }
      } else {
        setError(
          `Camera error: ${name || (err instanceof Error ? err.message : "unknown")}`,
        );
      }
      hasCamRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject)
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop());
      cancelAnimationFrame(animRef.current);
    };
  }, [startCamera]);

  useEffect(() => {
    const src = canvasRef.current;
    const dst = outputRef.current;
    const video = videoRef.current;
    if (!src || !dst || !video) return;

    const srcCtx = src.getContext("2d")!;
    const dstCtx = dst.getContext("2d")!;
    const W = 480,
      H = 480;
    src.width = dst.width = W;
    src.height = dst.height = H;

    let frame = 0;

    const drawDemo = () => {
      srcCtx.fillStyle = "#0d0d1f";
      srcCtx.fillRect(0, 0, W, H);
      srcCtx.strokeStyle = "rgba(120,60,220,0.2)";
      srcCtx.lineWidth = 1;
      for (let i = 0; i <= W; i += 40) {
        srcCtx.beginPath();
        srcCtx.moveTo(i, 0);
        srcCtx.lineTo(i, H);
        srcCtx.stroke();
        srcCtx.beginPath();
        srcCtx.moveTo(0, i);
        srcCtx.lineTo(W, i);
        srcCtx.stroke();
      }
      for (let i = 0; i < 5; i++) {
        const t = frame * 0.012 + i * 1.26;
        const x = W / 2 + Math.cos(t) * 130;
        const y = H / 2 + Math.sin(t * 0.7) * 100;
        const r = 28 + Math.sin(t * 1.3) * 10;
        srcCtx.beginPath();
        srcCtx.arc(x, y, r, 0, Math.PI * 2);
        srcCtx.fillStyle = `hsl(${(i * 72 + frame * 0.5) % 360},80%,62%)`;
        srcCtx.fill();
      }
      srcCtx.fillStyle = "rgba(255,255,255,0.55)";
      srcCtx.font = "bold 17px monospace";
      srcCtx.textAlign = "center";
      srcCtx.fillText("CURVE MIRROR", W / 2, H / 2 - 22);
      srcCtx.font = "12px monospace";
      srcCtx.fillStyle = "rgba(255,255,255,0.32)";
      srcCtx.fillText("touch & drag the mirror", W / 2, H / 2 + 2);
      srcCtx.fillText("to deform it", W / 2, H / 2 + 20);
    };

    const render = () => {
      frame++;

      for (const [id, tp] of touchesRef.current) {
        tp.age++;
        tp.pressure *= 0.92;
        if (tp.pressure < 0.004) touchesRef.current.delete(id);
      }

      if (hasCamRef.current && video.readyState >= 2) {
        srcCtx.save();
        srcCtx.scale(-1, 1);
        srcCtx.drawImage(video, -W, 0, W, H);
        srcCtx.restore();
      } else {
        drawDemo();
      }

      const imgData = srcCtx.getImageData(0, 0, W, H);
      const touches = Array.from(touchesRef.current.values());
      const distorted = applyDistortion(
        imgData,
        typeRef.current,
        strengthRef.current,
        frame,
        touches,
      );

      // Clip everything to a circle
      dstCtx.clearRect(0, 0, W, H);
      dstCtx.save();
      dstCtx.beginPath();
      dstCtx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
      dstCtx.clip();
      dstCtx.putImageData(distorted, 0, 0);

      // Glass shine — radial highlight top-left, darken bottom-right
      const shine = dstCtx.createRadialGradient(
        W * 0.32,
        H * 0.22,
        0,
        W / 2,
        H / 2,
        W / 2,
      );
      shine.addColorStop(0, "rgba(255,255,255,0.18)");
      shine.addColorStop(0.35, "rgba(255,255,255,0.04)");
      shine.addColorStop(0.7, "rgba(0,0,0,0.0)");
      shine.addColorStop(1, "rgba(0,0,0,0.28)");
      dstCtx.fillStyle = shine;
      dstCtx.fillRect(0, 0, W, H);

      // Touch ripple rings (clipped to circle already)
      for (const tp of touches) {
        if (tp.pressure < 0.02) continue;
        const tcx = tp.x * W;
        const tcy = tp.y * H;
        const ripR = 40 + tp.age * 2.5;
        dstCtx.beginPath();
        dstCtx.arc(tcx, tcy, ripR, 0, Math.PI * 2);
        dstCtx.strokeStyle = `rgba(255,255,255,${tp.pressure * 0.35})`;
        dstCtx.lineWidth = 1.5;
        dstCtx.stroke();
        dstCtx.beginPath();
        dstCtx.arc(tcx, tcy, 5 * tp.pressure, 0, Math.PI * 2);
        dstCtx.fillStyle = `rgba(255,255,255,${tp.pressure * 0.6})`;
        dstCtx.fill();
      }

      dstCtx.restore();

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const currentType = MIRROR_TYPES.find((m) => m.id === mirrorType)!;

  return (
    <div className="app">
      <video ref={videoRef} playsInline muted style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <header className="header">
        <h1>Curve Mirror</h1>
        <p className="subtitle">{currentType.desc} · touch to deform</p>
      </header>

      <div className="mirror-stage">
        <div className={`mirror-glow ${isPoking ? "poked" : ""}`} />
        <canvas
          ref={outputRef}
          className={`mirror-canvas ${isPoking ? "poked" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        {/* decorative frame ring rendered on top of canvas */}
        <div className="mirror-frame" />
        {loading && <div className="overlay-msg">Starting camera…</div>}
        {!loading && error && (
          <div className="overlay-msg error">
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="controls">
        <div className="type-grid">
          {MIRROR_TYPES.map((m) => (
            <button
              key={m.id}
              className={`type-btn ${mirrorType === m.id ? "active" : ""}`}
              onClick={() => setMirrorType(m.id)}
            >
              <span className="type-icon">{m.icon}</span>
              <span className="type-label">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="slider-row">
          <label htmlFor="strength">Strength</label>
          <input
            id="strength"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={strength}
            onChange={(e) => setStrength(parseFloat(e.target.value))}
          />
          <span className="slider-val">{Math.round(strength * 100)}%</span>
        </div>

        {!hasCamera && !loading && (
          <button className="cam-btn" onClick={startCamera}>
            Enable Camera
          </button>
        )}
      </div>
    </div>
  );
}
