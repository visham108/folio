import type { DragEvent } from 'react'

/** Books dragged onto a pile or shelf (Library) carry their entry id under this type. */
export const BOOK_DRAG = 'application/x-folio-entry'

export function bookDragProps(entryId: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(BOOK_DRAG, entryId)
      e.dataTransfer.effectAllowed = 'copyMove'
      // Lets the pile row stay in view while a book is being dragged.
      document.body.classList.add('dragging-book')
    },
    onDragEnd: () => document.body.classList.remove('dragging-book'),
  }
}

export const isBookDrag = (e: DragEvent) => e.dataTransfer.types.includes(BOOK_DRAG)
