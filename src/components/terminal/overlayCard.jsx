/**
 * overlayCard.jsx
 * Controles COMPARTILHADOS dos cards de overlay (parsers, storage, ping, trace,
 * mail, config helper, arquivos e editor):
 *   • DESPREGAR/PREGAR — alterna o card entre o terminal e o portal global.
 *   • MOVER — posiciona o card livremente.
 *   • REDIMENSIONAR — arraste pelo controle diagonal; duplo clique restaura.
 *
 * Uso num overlay:
 *   const card = useOverlayCard(floating);
 *   <motion.div ref={card.rootRef} {...card.dragProps}
 *     style={{ ...estilo, ...card.resizeStyle }}>
 *     <CardControls card={card} />
 *   return isFloat ? createPortal(body, document.body) : body;
 */
import React, { useEffect, useRef, useState } from 'react';
import { useDragControls } from 'framer-motion';
import { Move, PictureInPicture2, PictureInPicture, Scaling } from 'lucide-react';

export function useOverlayCard(floatingProp) {
  const [placementOverride, setPlacementOverride] = useState(null);
  const [size, setSize] = useState(null);
  const [resizing, setResizing] = useState(false);
  const dragControls = useDragControls();
  const rootRef = useRef(null);
  const resizeCleanupRef = useRef(null);
  const floating = placementOverride == null ? !!floatingProp : placementOverride;

  const stopResize = () => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
    setResizing(false);
  };

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const startResize = (event) => {
    const element = rootRef.current;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    stopResize();

    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement?.getBoundingClientRect();
    const viewportWidth = Math.max(240, window.innerWidth - 24);
    const viewportHeight = Math.max(160, window.innerHeight - 24);
    const maxWidth = floating || !parentRect ? viewportWidth : Math.max(240, parentRect.width - 16);
    const maxHeight = floating || !parentRect ? viewportHeight : Math.max(160, parentRect.height - 16);
    const minWidth = Math.min(320, maxWidth);
    const minHeight = Math.min(180, maxHeight);
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      setSize({
        width: Math.round(Math.max(minWidth, Math.min(maxWidth, start.width + moveEvent.clientX - start.x))),
        height: Math.round(Math.max(minHeight, Math.min(maxHeight, start.height + moveEvent.clientY - start.y))),
      });
    };
    const onUp = () => stopResize();

    window.addEventListener('pointermove', onMove);
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    resizeCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
    setResizing(true);
  };

  return {
    // O override permite alternar nos dois sentidos mesmo com preferência global.
    floating,
    detached: floating,
    toggleDetach: () => setPlacementOverride((value) => !(value == null ? !!floatingProp : value)),
    rootRef,
    resizing,
    resizeStyle: size ? { width: size.width, height: size.height } : {},
    resetSize: () => setSize(null),
    startResize,
    /** espalhar na motion.div raiz do card */
    dragProps: { drag: true, dragListener: false, dragControls, dragMomentum: false, dragElastic: 0 },
    /** onPointerDown do punho de arrasto */
    startDrag: (event) => { event.preventDefault(); dragControls.start(event); },
  };
}

/** Controles de mover, alternar dentro/fora e redimensionar. */
export function CardControls({ card }) {
  return (
    <>
      <button onPointerDown={card.startDrag} title="Mover (arraste)"
        aria-label="Mover modal"
        className="p-1 rounded hover:bg-theme-soft text-theme-soft"
        style={{ cursor: 'grab', touchAction: 'none' }}>
        <Move className="w-3.5 h-3.5" />
      </button>
      <button onClick={card.toggleDetach}
        title={card.detached ? 'Pregar de volta ao terminal' : 'Despregar (janela flutuante)'}
        aria-label={card.detached ? 'Mover modal para dentro do terminal' : 'Mover modal para fora do terminal'}
        className={`p-1 rounded hover:bg-theme-soft ${card.detached ? '' : 'text-theme-soft'}`}
        style={card.detached ? { color: 'var(--cyber-accent)' } : undefined}>
        {card.detached ? <PictureInPicture className="w-3.5 h-3.5" /> : <PictureInPicture2 className="w-3.5 h-3.5" />}
      </button>
      <button onPointerDown={card.startResize} onDoubleClick={card.resetSize}
        title="Redimensionar (arraste) · duplo clique restaura o tamanho"
        aria-label="Redimensionar modal"
        className="p-1 rounded hover:bg-theme-soft text-theme-soft"
        style={{ cursor: 'nwse-resize', touchAction: 'none', color: card.resizing ? 'var(--cyber-accent)' : undefined }}>
        <Scaling className="w-3.5 h-3.5" />
      </button>
    </>
  );
}
