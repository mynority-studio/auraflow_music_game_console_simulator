import React, { useEffect } from 'react';

const KEYBOARD_MAP: Record<string, {c: number, r: number}> = {
  // Bottom Row (r=2)
  'z': { c: 0, r: 2 }, 'x': { c: 1, r: 2 }, 'c': { c: 2, r: 2 }, 'v': { c: 3, r: 2 }, 'b': { c: 4, r: 2 },
  // Middle Row (r=1)
  'a': { c: 0, r: 1 }, 's': { c: 1, r: 1 }, 'd': { c: 2, r: 1 }, 'f': { c: 3, r: 1 }, 'g': { c: 4, r: 1 },
  // Top Row (r=0)
  'q': { c: 0, r: 0 }, 'w': { c: 1, r: 0 }, 'e': { c: 2, r: 0 }, 'r': { c: 3, r: 0 }, 't': { c: 4, r: 0 },
};

interface TapAreaProps {
  onKeyDown: (c: number, r: number) => void;
  onKeyUp: (c: number, r: number) => void;
}

export function TapArea({ onKeyDown, onKeyUp }: TapAreaProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mapped = KEYBOARD_MAP[key];
      if (mapped && !e.repeat) {
        onKeyDown(mapped.c, mapped.r);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mapped = KEYBOARD_MAP[key];
      if (mapped) {
        onKeyUp(mapped.c, mapped.r);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onKeyDown, onKeyUp]);

  const handlePointerDown = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch') {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      onKeyDown(c, r);
    }
  };

  const handlePointerUp = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch') {
      onKeyUp(c, r);
    }
  };

  const handlePointerEnter = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch' && e.buttons > 0) {
      onKeyDown(c, r);
    }
  };

  const handlePointerLeave = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch') {
      onKeyUp(c, r);
    }
  };

  const activeTouchesRefs = React.useRef<Map<number, string>>(new Map());

  const getPadFromPoint = (clientX: number, clientY: number): { c: number, r: number } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (el && el.id && el.id.startsWith('key-')) {
      const parts = el.id.split('-');
      if (parts.length === 3) {
        return { c: parseInt(parts[1], 10), r: parseInt(parts[2], 10) };
      }
    }
    return null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // We don't preventDefault here to allow AudioContext to resume on first tap
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pad = getPadFromPoint(touch.clientX, touch.clientY);
      if (pad) {
        const keyId = `${pad.c}-${pad.r}`;
        activeTouchesRefs.current.set(touch.identifier, keyId);
        onKeyDown(pad.c, pad.r);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // e.preventDefault(); // Removed to avoid passive event listener errors. touch-action: none handles scrolling.
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pad = getPadFromPoint(touch.clientX, touch.clientY);
      const currentKeyId = pad ? `${pad.c}-${pad.r}` : null;
      const previousKeyId = activeTouchesRefs.current.get(touch.identifier);

      if (currentKeyId !== previousKeyId) {
        if (previousKeyId) {
          const [pc, pr] = previousKeyId.split('-').map(Number);
          onKeyUp(pc, pr);
        }
        if (currentKeyId && pad) {
          activeTouchesRefs.current.set(touch.identifier, currentKeyId);
          onKeyDown(pad.c, pad.r);
        } else {
          activeTouchesRefs.current.delete(touch.identifier);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // e.preventDefault(); // Removed to avoid passive event listener errors.
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const previousKeyId = activeTouchesRefs.current.get(touch.identifier);
      if (previousKeyId) {
        const [pc, pr] = previousKeyId.split('-').map(Number);
        onKeyUp(pc, pr);
        activeTouchesRefs.current.delete(touch.identifier);
      }
    }
  };

  const keys = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      keys.push(
        <div
          key={`key-${c}-${r}`}
          id={`key-${c}-${r}`}
          className="w-full h-full touch-none cursor-pointer select-none outline-none"
          style={{ WebkitTapHighlightColor: 'transparent' }}
          onPointerDown={(e) => handlePointerDown(e, c, r)}
          onPointerUp={(e) => handlePointerUp(e, c, r)}
          onPointerEnter={(e) => handlePointerEnter(e, c, r)}
          onPointerLeave={(e) => handlePointerLeave(e, c, r)}
          onPointerCancel={(e) => handlePointerUp(e, c, r)}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        />
      );
    }
  }

  return (
    <div 
      className="absolute inset-0 z-50"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="w-full h-full grid" style={{
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 'calc(8.25 / 1358 * 100%) calc(8 / 811 * 100%)'
      }}>
        {keys}
      </div>
    </div>
  );
}
