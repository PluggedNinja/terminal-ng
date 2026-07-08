/**
 * overlayCard.jsx
 * Controles COMPARTILHADOS dos cards de overlay (parsers, storage, ping, trace,
 * mail, config helper):
 *   • DESPREGAR — solta o card do canto do terminal e o torna janela flutuante
 *     (portal no body, acima de tudo). Clicar de novo prega de volta.
 *   • MOVER — punho de arrasto (framer-motion drag) para posicionar o card
 *     livremente, pregado ou despregado.
 *
 * Uso num overlay:
 *   const card = useOverlayCard(floating);      // floating = prop global
 *   const isFloat = card.floating;              // usar no lugar de `floating`
 *   <motion.div {...card.dragProps} ...>        // raiz do card
 *     ... <CardControls card={card} /> ...      // junto aos botões do header
 *   return isFloat ? createPortal(body, document.body) : body;
 */
import React, { useState } from 'react';
import { useDragControls } from 'framer-motion';
import { Move, PictureInPicture2, PictureInPicture } from 'lucide-react';

export function useOverlayCard(floatingProp) {
  const [detached, setDetached] = useState(false);
  const dragControls = useDragControls();
  return {
    /** card deve renderizar em modo flutuante (prop global OU despregado) */
    floating: !!floatingProp || detached,
    detached,
    toggleDetach: () => setDetached((d) => !d),
    /** espalhar na motion.div raiz do card */
    dragProps: { drag: true, dragListener: false, dragControls, dragMomentum: false, dragElastic: 0 },
    /** onPointerDown do punho de arrasto */
    startDrag: (e) => { e.preventDefault(); dragControls.start(e); },
  };
}

/** Botões "mover" (punho de arrasto) e "despregar/pregar" para o header. */
export function CardControls({ card }) {
  return (
    <>
      <button onPointerDown={card.startDrag} title="Mover (arraste)"
        className="p-1 rounded hover:bg-theme-soft text-theme-soft"
        style={{ cursor: 'grab', touchAction: 'none' }}>
        <Move className="w-3.5 h-3.5" />
      </button>
      <button onClick={card.toggleDetach}
        title={card.detached ? 'Pregar de volta ao terminal' : 'Despregar (janela flutuante)'}
        className={`p-1 rounded hover:bg-theme-soft ${card.detached ? '' : 'text-theme-soft'}`}
        style={card.detached ? { color: 'var(--cyber-accent)' } : undefined}>
        {card.detached ? <PictureInPicture className="w-3.5 h-3.5" /> : <PictureInPicture2 className="w-3.5 h-3.5" />}
      </button>
    </>
  );
}
