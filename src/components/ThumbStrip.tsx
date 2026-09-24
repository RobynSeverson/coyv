import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductImage } from "../lib/api";
import "./ThumbStrip.css";

/* How many thumbnails fit across the strip. Below this there is nothing to
   scroll and the strip is a plain row instead. */
const ACROSS = 3;

/* The scroller holds three runs of the images back to back and keeps the
   middle one under the reader, so there is always a full run of thumbnails
   waiting on either side and the strip can be carried past either end. */
const RUNS = 3;

/* Long enough that iOS momentum has stopped: the silent jump back to the
   middle run has to happen while the scroller is still, or the browser
   fights it. */
const SETTLE_MS = 140;

function blockCapture(event: React.SyntheticEvent) {
  event.preventDefault();
}

type Props = {
  images: ProductImage[];
  /* Which image the card is showing. */
  index: number;
  onSelect: (position: number) => void;
};

export default function ThumbStrip({ images, index, onSelect }: Props) {
  const total = images.length;
  /* Only worth carrying round once there are more images than the strip can
     show at once; below that every thumbnail is already on screen. */
  const carousel = total > ACROSS;
  const scrollerRef = useRef<HTMLUListElement>(null);
  const settleRef = useRef<number | undefined>(undefined);
  const frameRef = useRef(0);
  /* The slot the reader is parked on, counted across all three runs rather
     than within one, so it survives the jump back to the middle. */
  const [slot, setSlot] = useState(() => (carousel ? total + index : index));

  const slotOffset = useCallback((target: number) => {
    const scroller = scrollerRef.current;
    const item = scroller?.children[target] as HTMLElement | undefined;
    if (!scroller || !item) return 0;
    return item.offsetLeft - (scroller.clientWidth - item.offsetWidth) / 2;
  }, []);

  /* Each thumbnail is told how near the middle it is and sizes itself in CSS,
     the way the memories list does. Reading it off scrollLeft rather than
     getBoundingClientRect keeps the measurement clear of the scale it is
     about to write, which would otherwise feed back on itself. */
  const paint = useCallback(() => {
    frameRef.current = 0;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const middle = scroller.clientWidth / 2;
    const reach = Math.max(middle, 1);

    for (const child of scroller.children) {
      const item = child as HTMLElement;
      const centre = item.offsetLeft - scroller.scrollLeft + item.offsetWidth / 2;
      const away = Math.abs(centre - middle);
      item.style.setProperty("--thumb-focus", String(1 - Math.min(away / reach, 1)));
    }
  }, []);

  const schedulePaint = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  const scrollToSlot = useCallback(
    (target: number, smooth: boolean) => {
      scrollerRef.current?.scrollTo({ left: slotOffset(target), behavior: smooth ? "smooth" : "auto" });
    },
    [slotOffset],
  );

  /* Park on the opening image without animating: on first paint there is
     nothing to animate from. */
  useEffect(() => {
    if (!carousel) return;
    scrollToSlot(total + index, false);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carousel, total]);

  const settle = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    /* Whichever thumbnail the scroller came to rest against. */
    const middle = scroller.scrollLeft + scroller.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < scroller.children.length; i++) {
      const item = scroller.children[i] as HTMLElement;
      const away = Math.abs(item.offsetLeft + item.offsetWidth / 2 - middle);
      if (away < best) {
        best = away;
        nearest = i;
      }
    }

    setSlot(nearest);
    onSelect(nearest % total);

    /* Drifted out of the middle run, so put the reader back on the matching
       thumbnail in it. The runs are identical, so the same picture stays under
       the same pixel and the jump cannot be seen. */
    if (nearest < total || nearest >= total * 2) {
      const home = total + (nearest % total);
      scroller.scrollTo({ left: slotOffset(home), behavior: "auto" });
      setSlot(home);
      paint();
    }
  }, [onSelect, paint, slotOffset, total]);

  const handleScroll = useCallback(() => {
    schedulePaint();
    window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(settle, SETTLE_MS);
  }, [schedulePaint, settle]);

  useEffect(() => {
    const frame = frameRef;
    const timer = settleRef;
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.clearTimeout(timer.current);
    };
  }, []);

  const choose = useCallback(
    (target: number) => {
      if (!carousel) {
        onSelect(target);
        return;
      }
      setSlot(target);
      onSelect(target % total);
      /* Reduced motion still wants the thumbnail centred, just without the
         glide. The scale is a position, not a movement, so it is left alone. */
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scrollToSlot(target, !still);
      if (still) paint();
    },
    [carousel, onSelect, paint, scrollToSlot, total],
  );

  const slots = carousel ? total * RUNS : total;

  return (
    <ul
      ref={scrollerRef}
      className={carousel ? "thumbStrip thumbStrip--carousel" : "thumbStrip"}
      onScroll={carousel ? handleScroll : undefined}
    >
      {Array.from({ length: slots }, (_, target) => {
        const position = target % total;
        const image = images[position];
        const current = carousel ? target === slot : position === index;

        return (
          <li className="thumbStrip__item" key={target}>
            <button
              type="button"
              className="thumbStrip__thumb"
              aria-label={`view image ${position + 1} of ${total}`}
              aria-current={current}
              /* The copies either side are the same pictures again, so they
                 are duplicates to a screen reader however they look. */
              aria-hidden={carousel && (target < total || target >= total * 2)}
              tabIndex={carousel && (target < total || target >= total * 2) ? -1 : undefined}
              onClick={() => choose(target)}
            >
              <img
                className="thumbStrip__image"
                src={image.url}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onContextMenu={blockCapture}
                onDragStart={blockCapture}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
