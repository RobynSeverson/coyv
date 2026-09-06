import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import Home from "./Home";
import landingDesktop from "../assets/landingDesktop.jpg";
import landingMobile from "../assets/landingMobile.jpg";
import enterMark from "../assets/openGates.png";
import "./Landing.css";

const DISSOLVE_DURATION = 2000;
const EASING = "cubic-bezier(0.2, 0.7, 0.3, 1)";
const BLOB_GRADIENT =
  "radial-gradient(closest-side, rgb(0 0 0 / 1) 56%, rgb(0 0 0 / 0) 100%)";

/* Blobs bloom outward from the button in the centre. Delay roughly tracks
   distance from centre, but each patch is jittered so some areas open up
   noticeably faster than their neighbours. `size` is the blob's final
   diameter in vmax. The last entry is the sweep that closes over whatever
   the blobs missed. */
const BLOBS = [
  { x: 50, y: 50, size: 34, delay: 0, duration: 780 },
  { x: 42, y: 45, size: 37, delay: 115, duration: 930 },
  { x: 59, y: 56, size: 31, delay: 179, duration: 690 },
  { x: 56, y: 40, size: 40, delay: 346, duration: 1050 },
  { x: 39, y: 60, size: 32, delay: 269, duration: 780 },
  { x: 27, y: 37, size: 36, delay: 576, duration: 900 },
  { x: 72, y: 63, size: 42, delay: 499, duration: 1170 },
  { x: 67, y: 28, size: 31, delay: 768, duration: 720 },
  { x: 32, y: 73, size: 39, delay: 691, duration: 1080 },
  { x: 14, y: 55, size: 33, delay: 998, duration: 840 },
  { x: 86, y: 44, size: 38, delay: 922, duration: 1020 },
  { x: 47, y: 14, size: 32, delay: 1075, duration: 780 },
  { x: 54, y: 87, size: 41, delay: 1037, duration: 1140 },
  { x: 9, y: 15, size: 35, delay: 1344, duration: 810 },
  { x: 91, y: 83, size: 36, delay: 1267, duration: 900 },
  { x: 89, y: 9, size: 31, delay: 1459, duration: 720 },
  { x: 11, y: 89, size: 34, delay: 1421, duration: 840 },
  { x: 50, y: 50, size: 320, delay: 1240, duration: 760 },
];

/* Registered custom properties are what makes the per-blob mask sizes
   animatable; plain custom properties would jump rather than tween. */
const BLOB_CSS = BLOBS.map(
  (_, index) => `@property --landing-b${index} {
  syntax: "<number>";
  inherits: false;
  initial-value: 0;
}
@keyframes landingBlob${index} {
  from { --landing-b${index}: 0; }
  to { --landing-b${index}: 1; }
}`,
).join("\n");

const maskStyle = {
  maskImage: BLOBS.map(() => BLOB_GRADIENT).join(", "),
  WebkitMaskImage: BLOBS.map(() => BLOB_GRADIENT).join(", "),
  maskPosition: BLOBS.map((blob) => `${blob.x}% ${blob.y}%`).join(", "),
  WebkitMaskPosition: BLOBS.map((blob) => `${blob.x}% ${blob.y}%`).join(", "),
  maskSize: BLOBS.map(
    (blob, index) =>
      `calc(var(--landing-b${index}) * ${blob.size}vmax) calc(var(--landing-b${index}) * ${blob.size}vmax)`,
  ).join(", "),
  WebkitMaskSize: BLOBS.map(
    (blob, index) =>
      `calc(var(--landing-b${index}) * ${blob.size}vmax) calc(var(--landing-b${index}) * ${blob.size}vmax)`,
  ).join(", "),
  ["--landing-blob-animation" as string]: BLOBS.map(
    (blob, index) =>
      `landingBlob${index} ${blob.duration}ms ${EASING} ${blob.delay}ms both`,
  ).join(", "),
};

/* Older WebKit can't tween registered properties, so it falls back to a
   plain crossfade instead of showing nothing at all. */
const supportsBlobMask =
  typeof CSS !== "undefined" &&
  typeof CSS.registerProperty === "function" &&
  CSS.supports("mask-image", BLOB_GRADIENT);

export default function Landing() {
  const [isDissolving, setIsDissolving] = useState(false);
  const navigate = useNavigate();
  const timeoutRef = useRef<number | undefined>(undefined);
  const landingRef = useRef<HTMLElement>(null);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  /* Viewport units are unreliable here: iOS resolves them against whichever
     viewport it thinks is current, and keeps reporting the pre-toolbar value
     until something forces a reflow — which is why the button could sit low
     until it was tapped. Measure visualViewport instead, re-measuring on a
     few delays while the toolbar settles and on every resize. */
  useLayoutEffect(() => {
    const el = landingRef.current;
    if (!el) return;

    const vv = window.visualViewport;
    const measure = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      if (h > 0) el.style.setProperty("--landing-h", `${h}px`);
    };

    measure();
    const frame = requestAnimationFrame(measure);
    const timers = [120, 350, 800].map((ms) => window.setTimeout(measure, ms));

    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.addEventListener("pageshow", measure);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((t) => window.clearTimeout(t));
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.removeEventListener("pageshow", measure);
    };
  }, []);

  const dissolve = () => {
    if (isDissolving) return;
    setIsDissolving(true);
    timeoutRef.current = window.setTimeout(
      () => navigate("/home"),
      DISSOLVE_DURATION,
    );
  };

  const className = [
    "landing",
    isDissolving ? "is-dissolving" : "",
    supportsBlobMask ? "" : "is-plain",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={className}
      ref={landingRef}
      style={{
        ["--art-image-desktop" as string]: `url(${landingDesktop})`,
        ["--art-image-mobile" as string]: `url(${landingMobile})`,
      }}
    >
      {supportsBlobMask ? <style>{BLOB_CSS}</style> : null}

      <div className="landing__art" aria-hidden="true" />

      {/* The destination page, revealed through the blobs the dissolve opens. */}
      <div
        className="landing__reveal"
        style={supportsBlobMask ? maskStyle : undefined}
        aria-hidden="true"
        inert
      >
        <div className="landing__revealInner">
          <div className="siteLayout">
            <div className="siteLayout__content">
              <Home />
            </div>
            <BottomNav />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="landing__button"
        onClick={dissolve}
        disabled={isDissolving}
        aria-label="enter coyv"
      >
        <img className="landing__buttonMark" src={enterMark} alt="" />
      </button>
    </main>
  );
}
