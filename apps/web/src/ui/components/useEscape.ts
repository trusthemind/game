import { useEffect, useRef } from 'react';

/**
 * Close a modal with Escape. Listens in the capture phase and stops the event, so the key doesn't also
 * reach the game (where Escape would toggle the pause menu).
 */
export function useEscape(onClose: () => void, active = true): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  const on = useRef(active);
  on.current = active;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !on.current) return;
      e.stopPropagation();
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
}
